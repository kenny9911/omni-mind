import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke } from "./helpers/harness";
import { getDb } from "@/lib/server/db/client";
import { userMemory } from "@/lib/server/db/schema";
import { POST as signup } from "@/app/api/auth/signup/route";
import { selectAndFormatMemory, type MemoryFact } from "@/lib/server/llm/memory";
import { embedText, cosine } from "@/lib/server/llm/embeddings";

// setup.ts sets EMBEDDINGS_FAKE=1 → deterministic hashed bag-of-tokens vectors (no network),
// so the cosine retrieval path is exercised; the real text-embedding-3-small path is verified live.
let userId: string;

beforeAll(async () => {
  await setupTestDb();
  const r = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Sem", email: "sem@omnimind.dev", password: "supersecret" } }));
  userId = r.body.data.user.id;
});

async function fact(text: string, importance = 2): Promise<MemoryFact> {
  return { text, category: "other", importance, lastSeen: Date.now(), embedding: (await embedText(text)) || undefined };
}

describe("Semantic memory retrieval (Phase 3 · in-app cosine)", () => {
  it("retrieves the semantically related fact for a query over unrelated ones", async () => {
    const { db } = await getDb();
    const facts = [
      await fact("the user is deploying kubernetes clusters with helm charts"),
      await fact("the user enjoys hiking in the mountains on weekends"),
      await fact("the user prefers tea over coffee"),
      await fact("the user is learning to play the violin"),
      await fact("the user lives in a coastal city"),
      await fact("the user reads science fiction novels"),
      await fact("the user has two pet cats"),
      await fact("the user practices yoga every morning"),
    ];
    expect(facts.every((f) => f.embedding && f.embedding.length > 0)).toBe(true); // embeddings attached
    const now = Date.now();
    const json = JSON.stringify(facts);
    await db
      .insert(userMemory)
      .values({ userId, factsJson: json, updatedAt: now })
      .onConflictDoUpdate({ target: userMemory.userId, set: { factsJson: json, updatedAt: now } });

    const block = await selectAndFormatMemory(db, userId, "help me debug my kubernetes deployment");
    expect(block).toBeTruthy();
    expect(block).toContain("kubernetes clusters with helm"); // selected by meaning, not keywords alone
    expect(block!.split("\n").length - 1).toBeLessThanOrEqual(6); // bounded to MAX_INJECT
  });

  it("cosine: semantically similar texts score higher than dissimilar ones", async () => {
    const a = (await embedText("python backend recommendation system"))!;
    const b = (await embedText("a recommendation system written in python"))!;
    const c = (await embedText("baking sourdough bread at home"))!;
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
    expect(cosine(a, a)).toBeCloseTo(1, 5); // self-similarity ≈ 1
  });
});
