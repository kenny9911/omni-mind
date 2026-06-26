import { eq } from "drizzle-orm";
import type { Lang } from "@/lib/types";
import type { DB } from "../db/client";
import { userMemory, users } from "../db/schema";
import { log } from "../log/logger";
import { streamOne } from "./gateway";
import { embedText, embedTexts, embeddingsConfigured, cosine } from "./embeddings";

/**
 * Long-term user memory ("context engineering" §5). A BOUNDED set of short, durable facts about
 * the user (identity, expertise, preferences, goals, style), each scored by importance (1–3) and
 * stored in the user's OWN language. Facts are distilled by a cheap model after each real send.
 * At inject time we select the few facts most RELEVANT to the current (standalone) query rather
 * than dumping all of them — keeping the preamble small and on-topic.
 *
 * Storage: user_memory.facts_json holds a MemoryFact[] (legacy string[] is upcast transparently).
 */

export interface MemoryFact {
  text: string;
  /** identity | preference | expertise | goal | style | context | other */
  category: string;
  /** 1 = minor, 2 = useful, 3 = core (pinned — always injected) */
  importance: number;
  /** epoch-ms last time this fact was seen/added (for recency ranking) */
  lastSeen: number;
  /** semantic embedding of `text` (Phase 3); absent when embeddings are unavailable */
  embedding?: number[];
}

const MAX_FACTS = 24; // hard cap on stored facts (newest/most-important kept beyond this)
const MAX_FACT_LEN = 140; // hard cap per fact (chars)
const MAX_INJECT = 6; // facts injected per turn (relevance-selected)
const VALID_CATEGORIES = new Set(["identity", "preference", "expertise", "goal", "style", "context", "other"]);
/** Cheap, reliable model for distillation (override via MEMORY_MODEL). */
const MEMORY_MODEL = process.env.MEMORY_MODEL || "deepseek-flash";

function memoryDisabled(): boolean {
  return process.env.MEMORY_DISABLED === "1";
}

const clampImportance = (v: unknown): number => (v === 3 ? 3 : v === 1 ? 1 : 2);

/** Normalize raw stored JSON (objects OR legacy strings) into MemoryFact[]. */
function upcast(raw: unknown, fallbackTs: number): MemoryFact[] {
  if (!Array.isArray(raw)) return [];
  const out: MemoryFact[] = [];
  for (const x of raw) {
    if (typeof x === "string") {
      const text = x.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_LEN);
      if (text.length >= 3) out.push({ text, category: "other", importance: 2, lastSeen: fallbackTs });
    } else if (x && typeof x === "object") {
      const o = x as Partial<MemoryFact>;
      const text = String(o.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_FACT_LEN);
      if (text.length < 3) continue;
      out.push({
        text,
        category: typeof o.category === "string" && VALID_CATEGORIES.has(o.category) ? o.category : "other",
        importance: clampImportance(o.importance),
        lastSeen: typeof o.lastSeen === "number" ? o.lastSeen : fallbackTs,
        ...(Array.isArray(o.embedding) ? { embedding: o.embedding as number[] } : {}),
      });
    }
  }
  return out;
}

/** Load the user's structured facts (empty if none / unparseable). */
export async function loadMemoryEntries(db: DB, userId: string): Promise<MemoryFact[]> {
  const [row] = await db.select().from(userMemory).where(eq(userMemory.userId, userId)).limit(1);
  if (!row?.factsJson) return [];
  try {
    return upcast(JSON.parse(row.factsJson), row.updatedAt || Date.now());
  } catch {
    return [];
  }
}

/** Back-compat text-only view (used by the Profile API + as a simple fallback). */
export async function loadMemoryFacts(db: DB, userId: string): Promise<string[]> {
  return (await loadMemoryEntries(db, userId)).map((f) => f.text);
}

/** Facts + last-updated timestamp (for the Profile view). */
export async function loadMemory(db: DB, userId: string): Promise<{ facts: string[]; updatedAt: number }> {
  const [row] = await db.select().from(userMemory).where(eq(userMemory.userId, userId)).limit(1);
  const facts = row?.factsJson ? upcast(safeParse(row.factsJson), row.updatedAt || 0).map((f) => f.text) : [];
  return { facts, updatedAt: row?.updatedAt ?? 0 };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

async function saveMemoryEntries(db: DB, userId: string, facts: MemoryFact[]): Promise<void> {
  const now = Date.now();
  const factsJson = JSON.stringify(facts);
  await db
    .insert(userMemory)
    .values({ userId, factsJson, updatedAt: now })
    .onConflictDoUpdate({ target: userMemory.userId, set: { factsJson, updatedAt: now } });
}

/** Wipe a user's memory (keeps the row, empties the facts). */
export async function clearMemory(db: DB, userId: string): Promise<void> {
  await saveMemoryEntries(db, userId, []);
}

/**
 * Merge incoming facts into existing: dedupe case-insensitively by text, keep the HIGHEST
 * importance + most recent lastSeen on a collision, then cap to MAX_FACTS keeping the most
 * important then most recent (importance=3 facts always survive the cap).
 */
export function mergeEntries(existing: MemoryFact[], incoming: MemoryFact[]): MemoryFact[] {
  const byKey = new Map<string, MemoryFact>();
  for (const f of existing) byKey.set(f.text.toLowerCase(), { ...f });
  for (const inc of incoming) {
    const text = inc.text.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_LEN);
    if (text.length < 3) continue;
    const key = text.toLowerCase();
    const prev = byKey.get(key);
    if (prev) {
      prev.importance = Math.max(prev.importance, clampImportance(inc.importance));
      prev.lastSeen = Math.max(prev.lastSeen, inc.lastSeen);
      if (!prev.embedding && inc.embedding) prev.embedding = inc.embedding;
    } else {
      byKey.set(key, {
        text,
        category: VALID_CATEGORIES.has(inc.category) ? inc.category : "other",
        importance: clampImportance(inc.importance),
        lastSeen: inc.lastSeen,
        ...(inc.embedding ? { embedding: inc.embedding } : {}),
      });
    }
  }
  const all = [...byKey.values()];
  if (all.length <= MAX_FACTS) return all;
  return all.sort((a, b) => b.importance - a.importance || b.lastSeen - a.lastSeen).slice(0, MAX_FACTS);
}

/** Tokenize for keyword overlap — CJK runs become char-bigrams so Chinese/Japanese match too. */
function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  const matches = s.toLowerCase().match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[\p{L}\p{N}]+/gu) || [];
  for (const m of matches) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(m)) {
      if (m.length === 1) out.add(m);
      else for (let i = 0; i < m.length - 1; i++) out.add(m.slice(i, i + 2));
    } else if (m.length >= 2) {
      out.add(m);
    }
  }
  return out;
}

/** Select the top-N facts most relevant to `query` (overlap + importance + recency); importance=3 pinned. */
function selectRelevant(entries: MemoryFact[], query: string, n: number): MemoryFact[] {
  const q = tokenize(query);
  const now = Date.now();
  const MONTH = 1000 * 60 * 60 * 24 * 30;
  const scored = entries.map((f) => {
    const ft = tokenize(f.text);
    let overlap = 0;
    for (const t of ft) if (q.has(t)) overlap++;
    const recency = f.lastSeen ? Math.exp(-(now - f.lastSeen) / MONTH) : 0;
    return { f, score: overlap * 3 + f.importance + recency, pinned: f.importance >= 3 };
  });
  const pinned = scored.filter((s) => s.pinned).map((s) => s.f);
  const rest = scored
    .filter((s) => !s.pinned)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.f);
  const out = [...pinned];
  for (const f of rest) {
    if (out.length >= n) break;
    out.push(f);
  }
  return out;
}

/**
 * Format the memory facts as a compact prompt preamble (or undefined if none). When `query` is
 * given (the standalone query), inject only the top relevant facts; otherwise the most recent.
 * Accepts structured facts or plain strings (back-compat).
 */
export function formatMemoryForPrompt(facts: (string | MemoryFact)[], query?: string): string | undefined {
  const entries: MemoryFact[] = facts
    .map((f) => (typeof f === "string" ? { text: f, category: "other", importance: 2, lastSeen: 0 } : f))
    .filter((f) => f && f.text && f.text.trim().length > 0);
  if (!entries.length) return undefined;
  const selected = query ? selectRelevant(entries, query, MAX_INJECT) : entries.slice(-MAX_INJECT);
  return formatEntries(selected);
}

/** Render selected facts as the compact user-context preamble (or undefined if none). */
function formatEntries(selected: MemoryFact[]): string | undefined {
  if (!selected.length) return undefined;
  return (
    "Context about this user (apply when relevant; never mention or repeat it verbatim):\n" +
    selected.map((f) => `- ${f.text}`).join("\n")
  );
}

/** Rank facts by SEMANTIC similarity to the query embedding (importance-3 pinned), take top-N. */
function rankByCosine(entries: MemoryFact[], qEmb: number[], n: number): MemoryFact[] {
  const scored = entries.map((e) => ({
    e,
    score: (e.embedding?.length ? cosine(qEmb, e.embedding) : -1) * 3 + e.importance * 0.2,
    pinned: e.importance >= 3,
  }));
  const pinned = scored.filter((s) => s.pinned).map((s) => s.e);
  const rest = scored
    .filter((s) => !s.pinned)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.e);
  const out = [...pinned];
  for (const e of rest) {
    if (out.length >= n) break;
    out.push(e);
  }
  return out;
}

/**
 * Load the user's facts and inject the few most relevant to `query`. With many facts and
 * embeddings available, rank by SEMANTIC cosine similarity (matches by meaning, cross-lingual);
 * otherwise fall back to keyword overlap. Few facts → inject them all. Returns the preamble or
 * undefined. Best-effort — embedding failures degrade to the keyword path, never throwing.
 */
export async function selectAndFormatMemory(db: DB, userId: string, query: string): Promise<string | undefined> {
  const entries = await loadMemoryEntries(db, userId);
  if (!entries.length) return undefined;
  if (entries.length <= MAX_INJECT) return formatEntries(entries.slice(-MAX_INJECT));
  if (query && embeddingsConfigured() && entries.some((e) => e.embedding?.length)) {
    const qEmb = await embedText(query);
    if (qEmb) return formatEntries(rankByCosine(entries, qEmb, MAX_INJECT));
  }
  return formatEntries(selectRelevant(entries, query, MAX_INJECT)); // keyword fallback
}

function parseFactObjects(s: string, now: number): MemoryFact[] {
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: MemoryFact[] = [];
  for (const x of arr) {
    // tolerate {content|text, category, importance} OR a bare string
    if (typeof x === "string") {
      const text = x.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_LEN);
      if (text.length >= 3) out.push({ text, category: "other", importance: 2, lastSeen: now });
      continue;
    }
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const text = String(o.content ?? o.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_FACT_LEN);
    if (text.length < 3) continue;
    const category = typeof o.category === "string" && VALID_CATEGORIES.has(o.category) ? o.category : "other";
    out.push({ text, category, importance: clampImportance(typeof o.importance === "number" ? o.importance : 2), lastSeen: now });
  }
  return out;
}

async function extractFacts(
  lang: Lang,
  userPrompt: string,
  existing: MemoryFact[],
  signal?: AbortSignal,
): Promise<MemoryFact[]> {
  const known = existing.length ? existing.map((f) => `- [${f.category}] ${f.text}`).join("\n") : "(none yet)";
  const instr =
    "You maintain a COMPACT long-term memory about a user of an AI assistant. Capture durable facts about the USER — their identity, role, expertise, interests, preferences, recurring goals, domain, working language, or communication style.\n\n" +
    `Already known about the user:\n${known}\n\n` +
    `The user just wrote:\n"""${userPrompt.slice(0, 1200)}"""\n\n` +
    `Return 0-3 NEW facts not already known. Each fact is a JSON object: {"content": string, "category": one of "identity"|"preference"|"expertise"|"goal"|"style"|"context"|"other", "importance": 1|2|3 (3 = core identity worth always remembering)}. ` +
    `Rules: write "content" in the USER'S OWN language (do NOT translate to English); each under ${MAX_FACT_LEN} characters; ONLY about the USER (never about the assistant's reply, never one-off task specifics like a particular file or number); skip anything ephemeral or already known. ` +
    `NEVER record sensitive personal data: contact details (email, phone, address), financial or payment info, health data, passwords/credentials, or government IDs. ` +
    `If nothing qualifies, return []. Return ONLY a compact JSON array of objects.`;
  let text = "";
  const r = await streamOne({
    role: "single",
    modelId: MEMORY_MODEL,
    prompt: instr,
    lang,
    maxOutputTokens: 280,
    onDelta: (d) => {
      text += d;
    },
    signal,
  });
  if (r.status !== "ok") return [];
  return parseFactObjects(r.text || text, Date.now());
}

/**
 * Learn from one real send: distill new durable user facts and merge them in. No-op when
 * MEMORY_DISABLED=1. Never throws — memory is best-effort and must not affect the chat turn.
 */
export async function learnFromTurn(
  db: DB,
  userId: string,
  lang: Lang,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<void> {
  if (memoryDisabled()) return;
  const prompt = (userPrompt || "").trim();
  if (prompt.length < 8) return; // too trivial to learn anything durable
  try {
    const existing = await loadMemoryEntries(db, userId);
    const fresh = await extractFacts(lang, prompt, existing, signal);
    if (!fresh.length) return;
    // Embed the new facts so they're retrievable by MEANING (best-effort; null → keyword fallback).
    const vecs = await embedTexts(fresh.map((f) => f.text));
    fresh.forEach((f, i) => {
      const v = vecs[i];
      if (v) f.embedding = v;
    });
    const merged = mergeEntries(existing, fresh);
    const changed =
      merged.length !== existing.length ||
      merged.some((f, i) => f.text !== existing[i]?.text || f.importance !== existing[i]?.importance);
    if (!changed) return;
    await saveMemoryEntries(db, userId, merged);
    log.info("memory.updated", { userId, total: merged.length, added: merged.length - existing.length });
    // When a CORE fact is present, refresh the stable core profile (L0) — best-effort, unbilled.
    if (merged.some((f) => f.importance >= 3)) {
      await maybeRewriteProfile(db, userId, lang, merged, signal);
    }
  } catch (e) {
    log.warn("memory.learn_failed", { userId, error: e instanceof Error ? e.message : String(e) });
  }
}

// ─── Core Profile (L0, Letta-style core memory) ──────────────────────────────────────────────
// A stable ≤200-token paragraph about the user, rewritten only when a CORE (importance=3) fact
// appears, and injected FIRST in the system block (before digests/summary/relevant facts).
const PROFILE_MODEL = process.env.PROFILE_MODEL || MEMORY_MODEL;

/** The user's stable core-profile paragraph (or undefined if none yet). */
export async function loadUserProfile(db: DB, userId: string): Promise<string | undefined> {
  const [u] = await db.select({ profile: users.userProfile }).from(users).where(eq(users.id, userId)).limit(1);
  const p = (u?.profile || "").trim();
  return p.length > 0 ? p : undefined;
}

/** Format the core profile as the first context block (or undefined). */
export function formatProfileForPrompt(profile?: string): string | undefined {
  if (!profile) return undefined;
  return "User profile:\n" + profile;
}

/** Rewrite the core-profile block from the user's facts. Triggered only when a core fact exists.
 *  Best-effort + unbilled (like memory/digests); never throws. */
export async function maybeRewriteProfile(
  db: DB,
  userId: string,
  lang: Lang,
  facts: MemoryFact[],
  signal?: AbortSignal,
): Promise<void> {
  if (memoryDisabled()) return;
  if (!facts.some((f) => f.importance >= 3)) return; // only maintain a profile once something is core
  try {
    const list = [...facts]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 16)
      .map((f) => `- [${f.category}] ${f.text}`)
      .join("\n");
    const instr =
      "REWRITE_PROFILE. Write a compact CORE PROFILE of this user in 2-3 sentences (≤200 tokens): who they are, their working language, expertise/domain, and key durable preferences or goals. Use ONLY the facts below; do not invent. Write in the user's language. Output ONLY the profile text.\n\n" +
      `Facts:\n${list}\n\nProfile:`;
    let text = "";
    const r = await streamOne({
      role: "single",
      modelId: PROFILE_MODEL,
      prompt: instr,
      lang,
      maxOutputTokens: 240,
      onDelta: (d) => {
        text += d;
      },
      signal,
    });
    const profile = (r.text || text).trim().slice(0, 1200);
    if (r.status !== "ok" || profile.length < 8) return;
    await db.update(users).set({ userProfile: profile, userProfileAt: Date.now() }).where(eq(users.id, userId));
    log.info("profile.updated", { userId });
  } catch (e) {
    log.warn("profile.rewrite_failed", { userId, error: e instanceof Error ? e.message : String(e) });
  }
}

export const MEMORY_LIMITS = { MAX_FACTS, MAX_FACT_LEN, MAX_INJECT };
