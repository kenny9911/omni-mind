import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, req, invoke } from "./helpers/harness";
import { getDb } from "@/lib/server/db/client";
import { userMemory } from "@/lib/server/db/schema";
import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as memGet, DELETE as memClear } from "@/app/api/memory/route";
import {
  mergeEntries,
  formatMemoryForPrompt,
  loadMemoryFacts,
  learnFromTurn,
  MEMORY_LIMITS,
  type MemoryFact,
} from "@/lib/server/llm/memory";

const f = (text: string, importance = 2, lastSeen = 1000, category = "other"): MemoryFact => ({ text, category, importance, lastSeen });

describe("context memory — structured merge/format (pure)", () => {
  it("dedupes case-insensitively, trims, and keeps the higher importance on collision", () => {
    const out = mergeEntries(
      [f("Uses Python", 2)],
      [f("  uses   python ", 3), f("Prefers concise answers", 1), f("Prefers concise answers", 1)],
    );
    expect(out.map((x) => x.text)).toEqual(["Uses Python", "Prefers concise answers"]);
    expect(out[0].importance).toBe(3); // collision kept the higher importance
  });

  it("caps to MAX_FACTS, keeping most-important then most-recent", () => {
    const existing = Array.from({ length: MEMORY_LIMITS.MAX_FACTS }, (_, i) => f(`fact ${i}`, 2, i + 1));
    const out = mergeEntries(existing, [f("brand new fact", 2, 999999)]);
    expect(out).toHaveLength(MEMORY_LIMITS.MAX_FACTS);
    expect(out.map((x) => x.text)).toContain("brand new fact");
    expect(out.map((x) => x.text)).not.toContain("fact 0"); // oldest (lowest lastSeen) dropped
  });

  it("an importance=3 (pinned) fact always survives the cap", () => {
    const existing = [f("CORE: user is a doctor", 3, 1), ...Array.from({ length: MEMORY_LIMITS.MAX_FACTS }, (_, i) => f(`minor ${i}`, 1, i + 10))];
    const out = mergeEntries(existing, []);
    expect(out).toHaveLength(MEMORY_LIMITS.MAX_FACTS);
    expect(out.map((x) => x.text)).toContain("CORE: user is a doctor");
  });

  it("truncates an over-long fact to MAX_FACT_LEN", () => {
    const long = "x".repeat(MEMORY_LIMITS.MAX_FACT_LEN + 50);
    const out = mergeEntries([], [f(long)]);
    expect(out[0].text.length).toBe(MEMORY_LIMITS.MAX_FACT_LEN);
  });

  it("formatMemoryForPrompt: undefined when empty; compact bullets; accepts plain strings", () => {
    expect(formatMemoryForPrompt([])).toBeUndefined();
    const p = formatMemoryForPrompt(["Uses Rust", "Lives in Tokyo"]); // back-compat string[]
    expect(p).toContain("- Uses Rust");
    expect(p).toContain("- Lives in Tokyo");
    expect(p!.split("\n")).toHaveLength(3); // header + 2 bullets
  });

  it("formatMemoryForPrompt with a query injects only the most RELEVANT facts (≤ MAX_INJECT)", () => {
    const many = [
      ...Array.from({ length: 8 }, (_, i) => f(`unrelated note number ${i}`, 1)),
      f("the user loves kubernetes and helm", 2),
    ];
    const p = formatMemoryForPrompt(many, "help me debug a kubernetes pod");
    const bullets = p!.split("\n").length - 1; // minus header
    expect(bullets).toBeLessThanOrEqual(MEMORY_LIMITS.MAX_INJECT);
    expect(p).toContain("kubernetes and helm"); // the query-relevant fact is selected
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
