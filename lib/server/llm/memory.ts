import { eq } from "drizzle-orm";
import type { Lang } from "@/lib/types";
import type { DB } from "../db/client";
import { userMemory } from "../db/schema";
import { log } from "../log/logger";
import { streamOne } from "./gateway";

/**
 * Compact context memory ("context engineering").
 *
 * Instead of stuffing whole histories into every prompt, we keep a BOUNDED list
 * of short, durable facts about the user (identity, role, preferences, recurring
 * goals, working language, style). A cheap model distills 0–3 new facts from each
 * real send and merges them in, deduped and capped. The distilled set is injected
 * as a tiny preamble — small enough not to pollute context or balloon token cost.
 */

const MAX_FACTS = 16; // hard cap on stored facts (keep newest beyond this)
const MAX_FACT_LEN = 120; // hard cap per fact (chars)
/** Cheap, reliable non-reasoning model for distillation (override via MEMORY_MODEL). */
const MEMORY_MODEL = process.env.MEMORY_MODEL || "deepseek-flash";

function memoryDisabled(): boolean {
  return process.env.MEMORY_DISABLED === "1";
}

/** Pull a JSON string array out of an LLM response (tolerant of markdown/prose). */
function parseStrings(s: string): string[] {
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const v = JSON.parse(m[0]);
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  } catch {
    /* not parseable */
  }
  return [];
}

/** Load the user's stored facts (empty if none / unparseable). */
export async function loadMemoryFacts(db: DB, userId: string): Promise<string[]> {
  const [row] = await db.select().from(userMemory).where(eq(userMemory.userId, userId)).limit(1);
  if (!row?.factsJson) return [];
  try {
    const v = JSON.parse(row.factsJson);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/** Load facts + last-updated timestamp (for the Profile view). */
export async function loadMemory(db: DB, userId: string): Promise<{ facts: string[]; updatedAt: number }> {
  const [row] = await db.select().from(userMemory).where(eq(userMemory.userId, userId)).limit(1);
  return { facts: await parseRow(row), updatedAt: row?.updatedAt ?? 0 };
}
async function parseRow(row?: { factsJson?: string }): Promise<string[]> {
  if (!row?.factsJson) return [];
  try {
    const v = JSON.parse(row.factsJson);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

async function saveMemoryFacts(db: DB, userId: string, facts: string[]): Promise<void> {
  const now = Date.now();
  const factsJson = JSON.stringify(facts);
  await db
    .insert(userMemory)
    .values({ userId, factsJson, updatedAt: now })
    .onConflictDoUpdate({ target: userMemory.userId, set: { factsJson, updatedAt: now } });
}

/** Wipe a user's memory (keeps the row, empties the facts). */
export async function clearMemory(db: DB, userId: string): Promise<void> {
  await saveMemoryFacts(db, userId, []);
}

/** Merge incoming facts into existing, normalized + deduped, capped to MAX_FACTS (newest kept). */
function mergeFacts(existing: string[], incoming: string[]): string[] {
  const out = existing.slice();
  const seen = new Set(existing.map((f) => f.toLowerCase()));
  for (const raw of incoming) {
    const f = String(raw).replace(/\s+/g, " ").trim().slice(0, MAX_FACT_LEN);
    if (f.length < 3) continue;
    const key = f.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out.slice(-MAX_FACTS);
}

/**
 * Format the stored facts as a compact prompt preamble, or undefined if empty.
 * Kept deliberately terse so it never dominates the prompt.
 */
export function formatMemoryForPrompt(facts: string[]): string | undefined {
  if (!facts.length) return undefined;
  return (
    "Context about this user (apply when relevant; never mention or repeat it verbatim):\n" +
    facts.map((f) => `- ${f}`).join("\n")
  );
}

async function extractFacts(lang: Lang, userPrompt: string, existing: string[], signal?: AbortSignal): Promise<string[]> {
  const known = existing.length ? existing.map((f) => `- ${f}`).join("\n") : "(none yet)";
  const instr =
    "You maintain a COMPACT long-term memory about a user of an AI assistant. Capture durable facts about the USER — their role, expertise, interests, preferences, recurring goals, domain, working language, or communication style.\n\n" +
    `Already known about the user:\n${known}\n\n` +
    `The user just wrote:\n"""${userPrompt.slice(0, 1200)}"""\n\n` +
    `Return 0-3 NEW facts that are not already known. Rules: each fact under ${MAX_FACT_LEN} characters; ONLY about the user (never about the assistant's reply, and never one-off task specifics like a particular file or number); skip anything ephemeral or already known. ` +
    `NEVER record sensitive personal data: contact details (email, phone, address), financial or payment info, health data, passwords/credentials, or government IDs. ` +
    `If nothing qualifies, return []. Write each fact in English. Return ONLY a compact JSON array of strings.`;
  let text = "";
  const r = await streamOne({
    role: "single",
    modelId: MEMORY_MODEL,
    prompt: instr,
    lang,
    maxOutputTokens: 220,
    onDelta: (d) => {
      text += d;
    },
    signal,
  });
  if (r.status !== "ok") return [];
  return parseStrings(r.text || text);
}

/**
 * Learn from one real send: distill new durable user facts and merge them in.
 * No-op when MEMORY_DISABLED=1. Never throws — memory
 * is best-effort and must not affect the chat turn.
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
    const existing = await loadMemoryFacts(db, userId);
    const fresh = await extractFacts(lang, prompt, existing, signal);
    if (!fresh.length) return;
    const merged = mergeFacts(existing, fresh);
    const changed = merged.length !== existing.length || merged.some((f, i) => f !== existing[i]);
    if (!changed) return;
    await saveMemoryFacts(db, userId, merged);
    log.info("memory.updated", { userId, total: merged.length, added: merged.length - existing.length });
  } catch (e) {
    log.warn("memory.learn_failed", { userId, error: e instanceof Error ? e.message : String(e) });
  }
}

export const MEMORY_LIMITS = { MAX_FACTS, MAX_FACT_LEN };
export { mergeFacts as _mergeFacts };
