import { log } from "../log/logger";

/**
 * Text embeddings for semantic memory retrieval (context-engineering Phase 3). Vectors are stored
 * as JSON alongside each memory fact and ranked by cosine similarity IN APPLICATION CODE — the
 * target Postgres lacks the pgvector extension, and for a bounded per-user fact set (≤ a few dozen)
 * in-app cosine is plenty. This module is a drop-in seam for native pgvector once it's installed.
 *
 * Tests set EMBEDDINGS_FAKE=1 → deterministic hashed bag-of-tokens vectors (no network), so the
 * cosine path is exercised without a real provider; production uses text-embedding-3-small.
 */

const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";
const EMBED_DIMS = Number(process.env.EMBED_DIMS || 512);
const FAKE_DIMS = 64;

function fakeMode(): boolean {
  return process.env.EMBEDDINGS_FAKE === "1";
}
export function embeddingsConfigured(): boolean {
  if (process.env.EMBEDDINGS_DISABLED === "1") return false;
  return fakeMode() || Boolean(process.env.OPENAI_API_KEY);
}

/** Deterministic, network-free embedding for tests: hashed bag of (CJK-aware) tokens, normalized. */
function fakeEmbed(text: string): number[] {
  const v = new Array(FAKE_DIMS).fill(0);
  const toks = (text.toLowerCase().match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu) || []);
  for (const t of toks) {
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    v[h % FAKE_DIMS] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

async function realEmbedMany(texts: string[]): Promise<number[][]> {
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { embedMany } = await import("ai");
  const model = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! }).textEmbeddingModel(EMBED_MODEL);
  const { embeddings } = await embedMany({
    model,
    values: texts.map((t) => t.slice(0, 8000)),
    providerOptions: { openai: { dimensions: EMBED_DIMS } },
  });
  return embeddings;
}

/** Embed one text → vector (or null if embeddings are unavailable / the call fails). Never throws. */
export async function embedText(text: string): Promise<number[] | null> {
  const t = (text || "").trim();
  if (!embeddingsConfigured() || !t) return null;
  if (fakeMode()) return fakeEmbed(t);
  try {
    const [e] = await realEmbedMany([t]);
    return e ?? null;
  } catch (e) {
    log.warn("embeddings.embed_failed", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Embed many texts → vectors (nulls on failure, preserving order). Never throws. */
export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  const nonEmpty = texts.map((t) => (t || "").trim());
  if (!embeddingsConfigured() || nonEmpty.every((t) => !t)) return texts.map(() => null);
  if (fakeMode()) return nonEmpty.map((t) => (t ? fakeEmbed(t) : null));
  try {
    const vecs = await realEmbedMany(nonEmpty.map((t) => t || " "));
    return nonEmpty.map((t, i) => (t ? vecs[i] ?? null : null));
  } catch (e) {
    log.warn("embeddings.embed_many_failed", { error: e instanceof Error ? e.message : String(e) });
    return texts.map(() => null);
  }
}

/** Cosine similarity in [-1, 1]; 0 when dimensions differ or either vector is zero. */
export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
