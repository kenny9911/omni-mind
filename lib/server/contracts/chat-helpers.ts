import { eq, and, or, lt, desc, inArray } from "drizzle-orm";
import { MODEL_MAP } from "@/lib/models";
import type { Lang, Mode } from "@/lib/types";
import type { DB } from "../db/client";
import { preferences, modelState, turns, messages } from "../db/schema";
import { log } from "../log/logger";
import type { ChatBodyT } from "./chat";

/**
 * Compute the caller's effective set of enabled model ids (§1.4):
 * a `model_state` row with `enabled=0` disables that model; absence ⇒ enabled.
 * Starts from the full registry and removes any explicitly-disabled id.
 */
export async function enabledSetFor(db: DB, userId: string): Promise<Set<string>> {
  const set = new Set<string>(Object.keys(MODEL_MAP));
  const rows = await db
    .select({ modelId: modelState.modelId, enabled: modelState.enabled })
    .from(modelState)
    .where(eq(modelState.userId, userId));
  for (const r of rows) {
    if (!r.enabled) set.delete(r.modelId);
  }
  return set;
}

export interface EffectiveSettings {
  mode: Mode;
  auto: boolean;
  mainModel: string;
  trio: string[];
  deepResearch: boolean;
  deepAgents: boolean;
  lang: Lang;
}

/**
 * Resolve the caller's effective chat settings from `preferences` merged with
 * per-request `ChatBody` overrides (§2.2 resolution). Body wins when present.
 */
export async function resolveSettings(
  db: DB,
  userId: string,
  body: Partial<ChatBodyT>,
): Promise<EffectiveSettings> {
  const [pref] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);

  // Preferences are seeded at signup; fall back to schema defaults defensively.
  const prefMode = (pref?.mode ?? "expert") as Mode;
  const prefAuto = pref?.auto ?? true;
  const prefMain = pref?.mainModel ?? "gpt-55";
  const prefLang = (pref?.lang ?? "zh") as Lang;
  let prefTrio: string[];
  try {
    prefTrio = JSON.parse(pref?.trioJson ?? '["deepseek-pro","gpt-55","claude-opus"]');
  } catch {
    prefTrio = ["deepseek-pro", "gpt-55", "claude-opus"];
  }
  const prefDeepResearch = pref?.deepResearch ?? false;
  const prefDeepAgents = pref?.deepAgents ?? false;

  return {
    mode: body.mode ?? prefMode,
    auto: body.auto ?? prefAuto,
    mainModel: body.mainModel ?? prefMain,
    trio: body.trio ?? prefTrio,
    deepResearch: body.deepResearch ?? prefDeepResearch,
    deepAgents: body.deepAgents ?? prefDeepAgents,
    lang: prefLang,
  };
}

/** Resolve only the caller's preferred lang (used by /api/chat/route). */
export async function langFor(db: DB, userId: string): Promise<Lang> {
  const [pref] = await db
    .select({ lang: preferences.lang })
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);
  return (pref?.lang ?? "zh") as Lang;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Max prior turns of context fed to the models — keeps token cost bounded on long chats. */
export const MAX_HISTORY_TURNS = 10;
/** Per-message hard cap (chars) so one giant prior answer can't bloat the prompt. A future
 *  summarization layer will compress further; this is the immediate guardrail. */
export const MAX_HISTORY_MSG_CHARS = 4000;

/** Extract the final user-facing answer text from a stored assistant message payload. */
function finalAnswerText(payload: unknown): string {
  const p = payload as { single?: { text?: string }; fusion?: { answerText?: string } } | null;
  return p?.single?.text || p?.fusion?.answerText || "";
}

/** Cap a history message so a single huge turn can't dominate the context window. */
function capHistory(s: string): string {
  return s.length <= MAX_HISTORY_MSG_CHARS ? s : s.slice(0, MAX_HISTORY_MSG_CHARS) + " …[truncated]";
}

/**
 * Build the prior conversation as alternating user/assistant messages (oldest→newest) so the
 * models have multi-turn context — without this, a follow-up like "好" is sent with no history
 * and the models answer as if it were a brand-new chat. Only COMPLETE exchanges (a user prompt
 * AND a non-empty final answer) are included, which guarantees strict role alternation.
 *
 * The window is bounded in SQL (ORDER BY created_at DESC … LIMIT, on ix_turns_conv) so the read
 * stays O(maxTurns) regardless of conversation length. `beforeCreatedAt` (+ `beforeTurnId` to
 * break exact-timestamp ties) restricts to turns strictly before a given turn — used by
 * regenerate so a re-run sees only what preceded the turn being regenerated.
 */
export async function loadConversationHistory(
  db: DB,
  conversationId: string,
  opts: { beforeCreatedAt?: number; beforeTurnId?: string; maxTurns?: number } = {},
): Promise<HistoryMessage[]> {
  const maxTurns = opts.maxTurns ?? MAX_HISTORY_TURNS;
  const conds = [eq(turns.conversationId, conversationId)];
  if (opts.beforeCreatedAt != null) {
    conds.push(
      opts.beforeTurnId
        ? or(
            lt(turns.createdAt, opts.beforeCreatedAt),
            and(eq(turns.createdAt, opts.beforeCreatedAt), lt(turns.id, opts.beforeTurnId)),
          )!
        : lt(turns.createdAt, opts.beforeCreatedAt),
    );
  }

  // Newest maxTurns turns (index-backed), then reverse to oldest→newest for the prompt.
  const recent = (
    await db
      .select({ id: turns.id, promptText: turns.promptText, createdAt: turns.createdAt })
      .from(turns)
      .where(and(...conds))
      .orderBy(desc(turns.createdAt), desc(turns.id))
      .limit(maxTurns)
  ).reverse();
  if (recent.length === 0) return [];

  const ids = recent.map((t) => t.id);
  const asstRows = await db
    .select({ turnId: messages.turnId, payloadJson: messages.payloadJson })
    .from(messages)
    .where(and(inArray(messages.turnId, ids), eq(messages.seq, 1)));
  const answerByTurn = new Map<string, string>();
  for (const m of asstRows) {
    let payload: unknown = {};
    try {
      payload = JSON.parse(m.payloadJson);
    } catch {
      // Corrupt payload → this exchange is skipped below; log it so silent history gaps are visible.
      log.warn("history.payload_unparseable", { turnId: m.turnId });
    }
    answerByTurn.set(m.turnId, finalAnswerText(payload));
  }

  const history: HistoryMessage[] = [];
  for (const t of recent) {
    const answer = answerByTurn.get(t.id) ?? "";
    if (!t.promptText || !answer) continue; // complete exchanges only → roles stay alternating
    history.push({ role: "user", content: capHistory(t.promptText) });
    history.push({ role: "assistant", content: capHistory(answer) });
  }
  return history;
}

/** True iff a turn with status='streaming' exists in the conversation (single-flight). */
export async function hasStreamingTurn(
  db: DB,
  conversationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.conversationId, conversationId), eq(turns.status, "streaming")))
    .limit(1);
  return Boolean(row);
}
