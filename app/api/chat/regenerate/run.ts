import { eq, and } from "drizzle-orm";
import { ApiError, type RouteCtx } from "@/lib/server/http";
import { sseResponse } from "@/lib/server/sse";
import { runTurn, type RunTurnCfg } from "@/lib/server/llm/fusion";
import { MODEL_MAP } from "@/lib/server/llm/registry";
import { llmConfigured } from "@/lib/server/llm/gateway";
import { selectAndFormatMemory } from "@/lib/server/llm/memory";
import { classifyIntent } from "@/lib/server/llm/intent";
import {
  resolveSettings,
  enabledSetFor,
  hasStreamingTurn,
  loadConversationHistory,
} from "@/lib/server/contracts/chat-helpers";
import { conversations, turns, messages, usageRecords } from "@/lib/server/db/schema";
import { isUniqueViolation } from "@/lib/server/db/errors";
import type { Mode } from "@/lib/types";

export interface RegenerateInput {
  conversationId: string;
  turnId: string;
}

/**
 * Re-run an existing turn in place (§2.2 US3.UC4): reuse the turn's stored
 * mode/prompt/route settings and the SAME turnId, replacing its old assistant
 * message + usage_records. Returns an SSE Response. Shared by both
 * `POST /api/chat/regenerate` and the `POST /api/chat { regenerateTurnId }` alias.
 */
export async function regenerateStream(
  ctx: RouteCtx,
  userId: string,
  input: RegenerateInput,
): Promise<Response> {
  // Load the turn; 404 TURN_NOT_FOUND if missing or not owned.
  const [turn] = await ctx.db
    .select()
    .from(turns)
    .where(eq(turns.id, input.turnId))
    .limit(1);
  if (!turn || turn.userId !== userId) {
    throw new ApiError(404, "TURN_NOT_FOUND", "Turn not found");
  }
  if (input.conversationId && turn.conversationId !== input.conversationId) {
    throw new ApiError(404, "TURN_NOT_FOUND", "Turn not found");
  }
  const conversationId = turn.conversationId;

  // Single-flight: another streaming turn in this conversation blocks regenerate.
  if (await hasStreamingTurn(ctx.db, conversationId)) {
    throw new ApiError(409, "STREAM_IN_PROGRESS", "A turn is already streaming");
  }

  // Replay the ORIGINAL turn's trio/compiler/auto (captured at send time), not the
  // user's CURRENT preferences (US3.UC4 fidelity). `lang` is not turn-scoped, so it
  // comes from preferences. Older turns without captured settings fall back to prefs.
  const settings = await resolveSettings(ctx.db, userId, {});
  const enabledSet = await enabledSetFor(ctx.db, userId);
  const mode = turn.mode as Mode;
  const mainModel = turn.mainModel ?? settings.mainModel;
  const trio = turn.trioJson ? (JSON.parse(turn.trioJson) as string[]) : settings.trio;
  const auto = turn.auto ?? settings.auto;

  if (!llmConfigured()) {
    throw new ApiError(
      503,
      "GATEWAY_NOT_CONFIGURED",
      "Real models require an AI provider. Set AI_GATEWAY_API_KEY (Vercel AI Gateway) or a direct provider key (e.g. OPENAI_API_KEY).",
    );
  }

  // Re-validate availability before re-running (models may have been toggled).
  if (mode === "expert") {
    if (!MODEL_MAP[mainModel] || !enabledSet.has(mainModel)) {
      throw new ApiError(409, "COMPILER_UNAVAILABLE", "Compiler model is unavailable");
    }
  }

  // Replace in place, atomically: drop the old assistant message (seq=1) + this turn's usage,
  // reset the turn to streaming, and bump the conversation. Wrapping these in one transaction
  // prevents a mid-cleanup failure from leaving orphaned usage_records (costs with no message).
  // The hasStreamingTurn check above is a TOCTOU fast-path; resetting this turn to streaming
  // can still collide with a concurrent stream via ux_turns_one_streaming → 409 (23505).
  try {
    await ctx.db.transaction(async (tx) => {
      await tx.delete(messages).where(and(eq(messages.turnId, input.turnId), eq(messages.seq, 1)));
      await tx.delete(usageRecords).where(eq(usageRecords.turnId, input.turnId));
      await tx.update(turns).set({ status: "streaming" }).where(eq(turns.id, input.turnId));
      await tx.update(conversations).set({ updatedAt: ctx.now }).where(eq(conversations.id, conversationId));
    });
  } catch (e) {
    // Lost the single-flight race (ux_turns_one_streaming) → 409, mirroring hasStreamingTurn.
    if (isUniqueViolation(e)) {
      throw new ApiError(409, "STREAM_IN_PROGRESS", "A turn is already streaming");
    }
    throw e;
  }

  ctx.setMeta({ mode, conversationId, regenerate: true });

  // Parity with POST /api/chat: resolve intent, then inject the memory most relevant to it.
  const history = await loadConversationHistory(ctx.db, conversationId, { beforeCreatedAt: turn.createdAt, beforeTurnId: turn.id });
  const intent = await classifyIntent(turn.promptText, settings.lang, history);
  const memory = await selectAndFormatMemory(ctx.db, userId, intent.standaloneQuery);

  const cfg: Omit<RunTurnCfg, "signal"> = {
    requestId: ctx.requestId,
    userId,
    conversationId,
    turnId: input.turnId,
    mode,
    prompt: turn.promptText,
    lang: settings.lang,
    auto,
    mainModel,
    trio,
    enabledSet,
    deepResearch: turn.deepResearch,
    deepAgents: turn.deepAgents,
    memory,
    history,
    intent,
  };

  return sseResponse(ctx.requestId, async (emit, signal) => {
    await runTurn(ctx.db, { ...cfg, signal }, emit);
  });
}
