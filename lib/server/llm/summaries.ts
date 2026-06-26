import { eq, and, desc, isNotNull, ne } from "drizzle-orm";
import type { Lang } from "@/lib/types";
import type { DB } from "../db/client";
import { conversations } from "../db/schema";
import { loadConversationHistory, MAX_HISTORY_TURNS } from "../contracts/chat-helpers";
import { log } from "../log/logger";
import { streamOne } from "./gateway";
import { embedText, cosine, embeddingsConfigured } from "./embeddings";

/**
 * Cross-session memory (context-engineering L2). Each conversation keeps a short DIGEST — refreshed
 * as it grows — and the most recent few are injected as "Previous sessions" when a NEW conversation
 * starts, so the assistant carries context across session boundaries. Generation is a cheap
 * best-effort call (like user-memory learning); it is unbilled and never affects the chat turn.
 */

const SUMMARY_MODEL = process.env.SUMMARY_MODEL || "deepseek-flash";
const summariesDisabled = (): boolean => process.env.SUMMARIES_DISABLED === "1";

const MAX_DIGEST_CHARS = 800; // stored digest cap
const MIN_TURNS_TO_DIGEST = 2; // don't digest a one-turn chat
const REFRESH_EVERY = 2; // re-digest after this many new completed turns

/**
 * Refresh a conversation's digest if it has grown enough since the last one. Best-effort; no-op
 * when SUMMARIES_DISABLED=1 or the conversation is too short. Never throws.
 */
export async function maybeRefreshConversationDigest(
  db: DB,
  conversationId: string,
  lang: Lang,
  signal?: AbortSignal,
): Promise<void> {
  if (summariesDisabled()) return;
  try {
    const history = await loadConversationHistory(db, conversationId, { maxTurns: 30 });
    const completed = Math.floor(history.length / 2); // user+assistant pairs
    if (completed < MIN_TURNS_TO_DIGEST) return;

    const [conv] = await db
      .select({ digest: conversations.conversationDigest, at: conversations.digestTurnCount })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!conv) return;
    if (conv.digest && completed - conv.at < REFRESH_EVERY) return; // throttle: not enough new content

    const convoText = history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n")
      .slice(0, 6000);
    const instr =
      "SUMMARIZE_CONVERSATION. Write a SHORT digest (2-3 sentences, ~120 words max) of the conversation below so it can serve as cross-session memory: capture the topic, the user's goal/intent, and any key conclusions or decisions. Write in the user's language. Output ONLY the digest text.\n\n" +
      `Conversation:\n${convoText}\n\nDigest:`;
    let text = "";
    const r = await streamOne({
      role: "single",
      modelId: SUMMARY_MODEL,
      prompt: instr,
      lang,
      maxOutputTokens: 240,
      onDelta: (d) => {
        text += d;
      },
      signal,
    });
    const digest = (r.text || text).trim().slice(0, MAX_DIGEST_CHARS);
    if (r.status !== "ok" || digest.length < 8) return;
    // Embed the digest so past sessions can be retrieved by MEANING (best-effort).
    const emb = await embedText(digest);
    await db
      .update(conversations)
      .set({ conversationDigest: digest, digestTurnCount: completed, ...(emb ? { digestEmbedding: JSON.stringify(emb) } : {}) })
      .where(eq(conversations.id, conversationId));
    log.info("digest.updated", { conversationId, completed });
  } catch (e) {
    log.warn("digest.refresh_failed", { conversationId, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Load the most recent non-empty digests for this user, excluding the current conversation. */
export async function loadRecentDigests(
  db: DB,
  userId: string,
  excludeConversationId: string,
  limit = 3,
): Promise<string[]> {
  const rows = await db
    .select({ digest: conversations.conversationDigest })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        ne(conversations.id, excludeConversationId),
        isNotNull(conversations.conversationDigest),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
  return rows.map((r) => (r.digest || "").trim()).filter((d) => d.length > 0);
}

function parseEmb(s?: string | null): number[] | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as number[]) : null;
  } catch {
    return null;
  }
}

/**
 * Retrieve the past sessions most RELEVANT to `query` by digest embedding cosine (semantic recall),
 * falling back to most-recent when embeddings are unavailable. Excludes the current conversation.
 */
export async function retrieveRelevantDigests(
  db: DB,
  userId: string,
  excludeConversationId: string,
  query: string,
  limit = 3,
): Promise<string[]> {
  const rows = await db
    .select({ digest: conversations.conversationDigest, emb: conversations.digestEmbedding, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        ne(conversations.id, excludeConversationId),
        isNotNull(conversations.conversationDigest),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(40);
  const items = rows
    .map((r) => ({ digest: (r.digest || "").trim(), emb: parseEmb(r.emb) }))
    .filter((x) => x.digest.length > 0);
  if (!items.length) return [];
  if (query && embeddingsConfigured() && items.some((x) => x.emb)) {
    const q = await embedText(query);
    if (q) {
      return items
        .map((x) => ({ d: x.digest, s: x.emb ? cosine(q, x.emb) : -1 }))
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map((x) => x.d);
    }
  }
  return items.slice(0, limit).map((x) => x.digest); // recency fallback
}

/** Format recent-session digests as a compact "Previous sessions" context block (or undefined). */
export function formatDigestsForPrompt(digests: string[]): string | undefined {
  if (!digests.length) return undefined;
  return (
    "Previous sessions with this user (background context; do not repeat verbatim):\n" +
    digests.map((d) => `- ${d}`).join("\n")
  );
}

// ─── Rolling summary / compaction (context-engineering Phase 2) ──────────────────────────────
// The last MAX_HISTORY_TURNS turns are sent verbatim (loadConversationHistory); everything OLDER
// is rolled into conversations.conversation_summary and injected into the system block, so a long
// conversation never loses its head while the per-turn token cost stays bounded.

/**
 * Refresh the rolling summary when the conversation has grown a new "head" beyond the recent
 * window. Incremental (folds the prior summary + the newly-aged-out turns). Best-effort; no-op
 * when SUMMARIES_DISABLED=1 or everything still fits in the recent window. Never throws.
 */
export async function maybeRefreshConversationSummary(
  db: DB,
  conversationId: string,
  lang: Lang,
  signal?: AbortSignal,
  recentWindow: number = MAX_HISTORY_TURNS,
): Promise<void> {
  if (summariesDisabled()) return;
  try {
    const all = await loadConversationHistory(db, conversationId, { maxTurns: 60 });
    const total = Math.floor(all.length / 2); // completed exchanges
    const headCount = total - recentWindow; // turns that have aged OUT of the verbatim window
    if (headCount <= 0) return; // everything still fits verbatim → no summary needed

    const [conv] = await db
      .select({ summary: conversations.conversationSummary, upTo: conversations.summaryUpToTurn })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!conv) return;
    if (headCount <= conv.upTo) return; // summary already covers the aged-out head

    const head = all.slice(0, headCount * 2); // the oldest `headCount` exchanges
    const headText = head
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n")
      .slice(0, 8000);
    const prior = conv.summary ? `Previous running summary:\n${conv.summary}\n\n` : "";
    const instr =
      "SUMMARIZE_HISTORY. Update a running summary of the EARLY part of an ongoing conversation into a compact paragraph (~150 words) that captures the topic, decisions made, and important facts/constraints so later turns retain the context. Fold the previous running summary together with the new earlier turns. Write in the user's language. Output ONLY the summary text.\n\n" +
      prior +
      `Earlier turns:\n${headText}\n\nUpdated running summary:`;
    let text = "";
    const r = await streamOne({
      role: "single",
      modelId: SUMMARY_MODEL,
      prompt: instr,
      lang,
      maxOutputTokens: 360,
      onDelta: (d) => {
        text += d;
      },
      signal,
    });
    const summary = (r.text || text).trim().slice(0, 2000);
    if (r.status !== "ok" || summary.length < 8) return;
    await db
      .update(conversations)
      .set({ conversationSummary: summary, summaryUpToTurn: headCount })
      .where(eq(conversations.id, conversationId));
    log.info("summary.updated", { conversationId, headCount, total });
  } catch (e) {
    log.warn("summary.refresh_failed", { conversationId, error: e instanceof Error ? e.message : String(e) });
  }
}

/** The conversation's rolling summary of aged-out turns (or undefined if none yet). */
export async function loadConversationSummary(db: DB, conversationId: string): Promise<string | undefined> {
  const [conv] = await db
    .select({ summary: conversations.conversationSummary })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const s = (conv?.summary || "").trim();
  return s.length > 0 ? s : undefined;
}

/** Format the rolling summary as a compact context block (or undefined). */
export function formatSummaryForPrompt(summary?: string): string | undefined {
  if (!summary) return undefined;
  return "Summary of earlier in this conversation (for context):\n" + summary;
}
