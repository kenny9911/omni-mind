import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { route, ApiError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { sseResponse } from "@/lib/server/sse";
import { runTurn, type RunTurnCfg } from "@/lib/server/llm/fusion";
import { MODEL_MAP } from "@/lib/server/llm/registry";
import { llmConfigured } from "@/lib/server/llm/gateway";
import { selectAndFormatMemory, learnFromTurn, loadUserProfile, formatProfileForPrompt } from "@/lib/server/llm/memory";
import { classifyIntent } from "@/lib/server/llm/intent";
import {
  maybeRefreshConversationDigest,
  retrieveRelevantDigests,
  formatDigestsForPrompt,
  maybeRefreshConversationSummary,
  loadConversationSummary,
  formatSummaryForPrompt,
} from "@/lib/server/llm/summaries";
import { ChatBody } from "@/lib/server/contracts/chat";
import {
  resolveSettings,
  enabledSetFor,
  hasStreamingTurn,
  loadConversationHistory,
} from "@/lib/server/contracts/chat-helpers";
import { conversations, turns, messages } from "@/lib/server/db/schema";
import { isUniqueViolation } from "@/lib/server/db/errors";
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

    // 1. Resolve / create the conversation. A NEW conversation's row is NOT inserted here —
    // it is created inside the step-5 transaction together with its first turn + user message,
    // so a conversation never exists without its opening turn (all-or-nothing).
    let conversationId = body.conversationId;
    let newConversation: { title: string; color: string } | undefined;
    if (!conversationId) {
      conversationId = randomUUID();
      newConversation = { title: truncate(prompt, 40), color: colorFor(conversationId) };
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

    // 5. Persist (conversation, if new) + turn + user message BEFORE streaming — atomically.
    // The hasStreamingTurn check above is a TOCTOU fast-path; the ux_turns_one_streaming
    // partial unique index is the real guard. A concurrent double-submit that slips past the
    // check loses the insert race here with SQLSTATE 23505 → 409, same code as the check.
    const turnId = randomUUID();
    try {
      await ctx.db.transaction(async (tx) => {
        if (newConversation) {
          await tx.insert(conversations).values({
            id: conversationId,
            userId: user.id,
            title: newConversation.title,
            color: newConversation.color,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          });
        }
        await tx.insert(turns).values({
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
        await tx.insert(messages).values({
          id: randomUUID(),
          conversationId,
          turnId,
          role: "user",
          mode: null,
          payloadJson: JSON.stringify({ text: prompt }),
          seq: 0,
          createdAt: ctx.now,
        });
        // Existing conversation: bump updatedAt so it sorts to the top of recents.
        if (!newConversation) {
          await tx.update(conversations).set({ updatedAt: ctx.now }).where(eq(conversations.id, conversationId));
        }
      });
    } catch (e) {
      // Lost the single-flight race (ux_turns_one_streaming) → 409, mirroring hasStreamingTurn.
      if (isUniqueViolation(e)) {
        throw new ApiError(409, "STREAM_IN_PROGRESS", "A turn is already streaming");
      }
      throw e;
    }

    ctx.setMeta({ mode: settings.mode, conversationId });
    if (settings.mode === "fast" && settings.auto) {
      ctx.setMeta({ auto: true });
    }

    // Prior turns of THIS conversation → multi-turn context for the models. Exclude the
    // just-inserted current turn (createdAt === ctx.now) so it never occupies a slot in the
    // bounded window, which would otherwise drop the oldest real prior turn.
    const history = await loadConversationHistory(ctx.db, conversationId, { beforeCreatedAt: ctx.now, beforeTurnId: turnId });

    // Intent layer (context-engineering §6): one cheap classify call rewrites a terse follow-up
    // into a self-contained query and resolves intent. It drives fast-mode auto-routing AND the
    // relevance of injected memory. Best-effort + unbilled (like memory); falls back to regex.
    const intent = await classifyIntent(prompt, settings.lang, history);
    ctx.setMeta({ intent: intent.intent, intentConfidence: intent.confidence, intentFallback: intent.fallback });

    // User memory → inject only the facts most RELEVANT to the resolved (standalone) query
    // (semantic cosine when embeddings are available, else keyword overlap).
    const facts = await selectAndFormatMemory(ctx.db, user.id, intent.standaloneQuery);
    // Cross-session memory (L2): on a NEW conversation, prepend a "Previous sessions" block so the
    // assistant carries context across session boundaries (within an existing chat the history covers it).
    const digests = newConversation
      ? formatDigestsForPrompt(await retrieveRelevantDigests(ctx.db, user.id, conversationId, intent.standaloneQuery, 3))
      : undefined;
    // Rolling summary (Phase 2): on a CONTINUING long conversation, inject the compacted head
    // (turns that have aged out of the verbatim window) so the chat never loses its beginning.
    const summary = newConversation
      ? undefined
      : formatSummaryForPrompt(await loadConversationSummary(ctx.db, conversationId));
    // Core Profile (L0): a stable identity block injected FIRST (Letta "core memory" pattern).
    const profile = formatProfileForPrompt(await loadUserProfile(ctx.db, user.id));
    const memory = [profile, digests, summary, facts].filter(Boolean).join("\n\n") || undefined;

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
      history,
      intent,
      newConversation,
    };

    return sseResponse(ctx.requestId, async (emit, signal) => {
      const result = await runTurn(ctx.db, { ...cfg, signal }, emit);
      // Learn from this send AFTER the answer streams (non-blocking, best-effort).
      // Pass the signal so a mid-extraction client disconnect aborts the model call;
      // a normal stream close does NOT abort it, so extraction still completes.
      if (result.status !== "failed" && !signal.aborted) {
        void learnFromTurn(ctx.db, user.id, settings.lang, prompt, signal);
        // Refresh the conversation's cross-session digest + rolling summary as it grows
        // (best-effort, unbilled — platform context-engineering overhead).
        void maybeRefreshConversationDigest(ctx.db, conversationId, settings.lang, signal);
        void maybeRefreshConversationSummary(ctx.db, conversationId, settings.lang, signal);
      }
    });
  },
  { auth: "required" },
);
