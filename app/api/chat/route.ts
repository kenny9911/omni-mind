import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { route, ApiError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { sseResponse } from "@/lib/server/sse";
import { runTurn, type RunTurnCfg } from "@/lib/server/llm/fusion";
import { MODEL_MAP } from "@/lib/server/llm/registry";
import { llmConfigured } from "@/lib/server/llm/gateway";
import { loadMemoryFacts, formatMemoryForPrompt, learnFromTurn } from "@/lib/server/llm/memory";
import { ChatBody } from "@/lib/server/contracts/chat";
import {
  resolveSettings,
  enabledSetFor,
  hasStreamingTurn,
} from "@/lib/server/contracts/chat-helpers";
import { conversations, turns, messages } from "@/lib/server/db/schema";
import { colorFor, truncate } from "@/lib/server/util";
import { regenerateStream } from "./regenerate/run";

export const POST = route(
  "chat.send",
  async (ctx) => {
    const user = requireUser(ctx);
    const body = await parseBody(ctx.req, ChatBody);

    // Regenerate alias: POST /api/chat { regenerateTurnId } → in-place replace.
    if (body.regenerateTurnId) {
      return regenerateStream(ctx, user.id, {
        conversationId: body.conversationId ?? "",
        turnId: body.regenerateTurnId,
      });
    }

    // Past the regenerate branch a prompt is guaranteed (ChatBody refine), but narrow it
    // for the type system and as defense-in-depth.
    if (!body.prompt) throw new ApiError(400, "VALIDATION_ERROR", "prompt is required");
    const prompt = body.prompt;

    const settings = await resolveSettings(ctx.db, user.id, body);
    const enabledSet = await enabledSetFor(ctx.db, user.id);

    // 1. Resolve / create the conversation.
    let conversationId = body.conversationId;
    if (!conversationId) {
      conversationId = randomUUID();
      await ctx.db.insert(conversations).values({
        id: conversationId,
        userId: user.id,
        title: truncate(prompt, 40),
        color: colorFor(conversationId),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    } else {
      const [conv] = await ctx.db
        .select({ id: conversations.id, userId: conversations.userId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      if (!conv || conv.userId !== user.id) {
        throw new ApiError(404, "NOT_FOUND", "Conversation not found");
      }
    }

    // 2. Single-flight: reject a second concurrent stream in this conversation.
    if (await hasStreamingTurn(ctx.db, conversationId)) {
      throw new ApiError(409, "STREAM_IN_PROGRESS", "A turn is already streaming");
    }

    // 3/4. Mode-specific guards.
    if (settings.mode === "fast") {
      if (!settings.auto) {
        const m = MODEL_MAP[settings.mainModel];
        if (!m || !enabledSet.has(settings.mainModel)) {
          throw new ApiError(400, "MODEL_NOT_AVAILABLE", "Main model unknown or disabled");
        }
      }
    } else {
      // expert
      const distinct = new Set(settings.trio);
      const allEnabled =
        settings.trio.length === 3 &&
        distinct.size === 3 &&
        settings.trio.every((id) => MODEL_MAP[id] && enabledSet.has(id));
      if (!allEnabled) {
        throw new ApiError(400, "INVALID_TRIO", "trio must be 3 distinct enabled ids");
      }
      // compiler = mainModel; must be enabled at fusion start.
      if (!MODEL_MAP[settings.mainModel] || !enabledSet.has(settings.mainModel)) {
        throw new ApiError(409, "COMPILER_UNAVAILABLE", "Compiler model is unavailable");
      }
    }

    // A configured provider is required — checked here, after the request is fully
    // validated and the conversation is owned, so the caller still gets 404/400/409 first.
    if (!llmConfigured()) {
      throw new ApiError(
        503,
        "GATEWAY_NOT_CONFIGURED",
        "Real models require an AI provider. Set AI_GATEWAY_API_KEY (Vercel AI Gateway) or a direct provider key (e.g. OPENAI_API_KEY).",
      );
    }

    // 5. Persist turn + user message BEFORE streaming.
    const turnId = randomUUID();
    await ctx.db.insert(turns).values({
      id: turnId,
      conversationId,
      userId: user.id,
      mode: settings.mode,
      promptText: prompt,
      routeText: null,
      mainModel: settings.mainModel,
      trioJson: JSON.stringify(settings.trio),
      auto: settings.auto,
      deepResearch: settings.deepResearch,
      deepAgents: settings.deepAgents,
      status: "streaming",
      createdAt: ctx.now,
    });
    await ctx.db.insert(messages).values({
      id: randomUUID(),
      conversationId,
      turnId,
      role: "user",
      mode: null,
      payloadJson: JSON.stringify({ text: prompt }),
      seq: 0,
      createdAt: ctx.now,
    });
    await ctx.db
      .update(conversations)
      .set({ updatedAt: ctx.now })
      .where(eq(conversations.id, conversationId));

    ctx.setMeta({ mode: settings.mode, conversationId });
    if (settings.mode === "fast" && settings.auto) {
      ctx.setMeta({ auto: true });
    }

    // Compact user-context memory → injected as a tiny preamble.
    const memory = formatMemoryForPrompt(await loadMemoryFacts(ctx.db, user.id));

    const cfg: Omit<RunTurnCfg, "signal"> = {
      requestId: ctx.requestId,
      userId: user.id,
      conversationId,
      turnId,
      mode: settings.mode,
      prompt: prompt,
      lang: settings.lang,
      auto: settings.auto,
      mainModel: settings.mainModel,
      trio: settings.trio,
      enabledSet,
      deepResearch: settings.deepResearch,
      deepAgents: settings.deepAgents,
      memory,
    };

    return sseResponse(ctx.requestId, async (emit, signal) => {
      const result = await runTurn(ctx.db, { ...cfg, signal }, emit);
      // Learn from this send AFTER the answer streams (non-blocking, best-effort).
      // Pass the signal so a mid-extraction client disconnect aborts the model call;
      // a normal stream close does NOT abort it, so extraction still completes.
      if (result.status !== "failed" && !signal.aborted) {
        void learnFromTurn(ctx.db, user.id, settings.lang, prompt, signal);
      }
    });
  },
  { auth: "required" },
);
