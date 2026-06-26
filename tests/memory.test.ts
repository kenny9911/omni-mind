import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, req, invoke } from "./helpers/harness";
import { getDb } from "@/lib/server/db/client";
import { userMemory } from "@/lib/server/db/schema";
import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as memGet, DELETE as memClear } from "@/app/api/memory/route";
import {
  _mergeFacts,
  formatMemoryForPrompt,
  loadMemoryFacts,
  learnFromTurn,
  MEMORY_LIMITS,
} from "@/lib/server/llm/memory";

describe("context memory — merge/format (pure)", () => {
  it("dedupes case-insensitively and trims/normalizes", () => {
    const out = _mergeFacts(
      ["Uses Python"],
      ["  uses   python ", "Prefers concise answers", "Prefers concise answers"],
    );
    expect(out).toEqual(["Uses Python", "Prefers concise answers"]);
  });

  it("caps to MAX_FACTS, keeping the newest", () => {
    const existing = Array.from({ length: MEMORY_LIMITS.MAX_FACTS }, (_, i) => `fact ${i}`);
    const out = _mergeFacts(existing, ["brand new fact"]);
    expect(out).toHaveLength(MEMORY_LIMITS.MAX_FACTS);
    expect(out[out.length - 1]).toBe("brand new fact");
    expect(out).not.toContain("fact 0"); // oldest dropped
  });

  it("truncates an over-long fact to MAX_FACT_LEN", () => {
    const long = "x".repeat(MEMORY_LIMITS.MAX_FACT_LEN + 50);
    const out = _mergeFacts([], [long]);
    expect(out[0].length).toBe(MEMORY_LIMITS.MAX_FACT_LEN);
  });

  it("formatMemoryForPrompt is undefined when empty, compact bullets otherwise", () => {
    expect(formatMemoryForPrompt([])).toBeUndefined();
    const p = formatMemoryForPrompt(["Uses Rust", "Lives in Tokyo"]);
    expect(p).toContain("- Uses Rust");
    expect(p).toContain("- Lives in Tokyo");
    expect(p!.split("\n")).toHaveLength(3); // header + 2 bullets
  });
});

describe("GET/DELETE /api/memory", () => {
  let cookie: string;
  let userId: string;
  beforeAll(async () => {
    await setupTestDb();
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", { body: { name: "Mem", email: "mem@omnimind.dev", password: "supersecret" } }),
    );
    cookie = r.cookie!;
    userId = r.body.data.user.id;
  });

  it("returns empty facts for a fresh user", async () => {
    const r = await invoke(memGet, req("GET", "/api/memory", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.data.facts).toEqual([]);
  });

  it("requires auth", async () => {
    const r = await invoke(memGet, req("GET", "/api/memory"));
    expect(r.status).toBe(401);
  });

  it("returns seeded facts, then DELETE clears them", async () => {
    const { db } = await getDb();
    const now = Date.now();
    await db
      .insert(userMemory)
      .values({ userId, factsJson: JSON.stringify(["Uses TypeScript", "Prefers terse replies"]), updatedAt: now })
      .onConflictDoUpdate({ target: userMemory.userId, set: { factsJson: JSON.stringify(["Uses TypeScript", "Prefers terse replies"]), updatedAt: now } });

    const got = await invoke(memGet, req("GET", "/api/memory", { cookie }));
    expect(got.body.data.facts).toEqual(["Uses TypeScript", "Prefers terse replies"]);
    expect(got.body.data.updatedAt).toBe(now);

    const del = await invoke(memClear, req("DELETE", "/api/memory", { cookie }));
    expect(del.status).toBe(200);
    expect(del.body.data.cleared).toBe(true);

    const after = await invoke(memGet, req("GET", "/api/memory", { cookie }));
    expect(after.body.data.facts).toEqual([]);
  });

  it("learnFromTurn is a no-op when MEMORY_DISABLED=1", async () => {
    const { db } = await getDb();
    process.env.MEMORY_DISABLED = "1";
    try {
      await learnFromTurn(db, userId, "en", "I am a senior Rust engineer in Berlin.");
      expect(await loadMemoryFacts(db, userId)).toEqual([]); // disabled → nothing learned
    } finally {
      delete process.env.MEMORY_DISABLED;
    }
  });
});
