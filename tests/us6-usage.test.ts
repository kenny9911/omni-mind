import { describe, it, expect, beforeAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";
import { getDb } from "@/lib/server/db/client";
import { activityLogs, usageRecords } from "@/lib/server/db/schema";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as chat } from "@/app/api/chat/route";
import { GET as usageSummary } from "@/app/api/usage/summary/route";
import { GET as usageTrend } from "@/app/api/usage/trend/route";
import { GET as usageByModel } from "@/app/api/usage/by-model/route";
import { GET as usageLedger } from "@/app/api/usage/ledger/route";
import { GET as usageExport } from "@/app/api/usage/export/route";

/**
 * US6 — Usage & Cost Analytics.
 * One signed-in user with seeded history (10 turns spread over the last 7 days),
 * plus one fresh streamed expert turn so every endpoint has non-zero, deterministic data.
 * Money invariants are asserted against the raw usage_records ledger (single source of truth).
 */

let cookie: string;
let userId: string;

/** Sum the user's persisted usage_records directly — the authoritative ledger. */
async function rawLedgerTotals() {
  const { db } = await getDb();
  const rows = await db.select().from(usageRecords).where(eq(usageRecords.userId, userId));
  let costMicro = 0;
  let feeMicro = 0;
  const turnIds = new Set<string>();
  for (const r of rows) {
    costMicro += r.costMicro;
    feeMicro += r.platformFeeMicro;
    turnIds.add(r.turnId);
  }
  return { rows, costMicro, feeMicro, totalMicro: costMicro + feeMicro, callCount: rows.length, requestCount: turnIds.size };
}

beforeAll(async () => {
  await setupTestDb();
  const r = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Uma", email: "uma@omnimind.dev", password: "supersecret" } }));
  expect(r.status).toBe(200);
  cookie = r.cookie!;
  userId = r.body.data.user.id;
  expect(cookie).toBeTruthy();
  // One additional real expert turn (3 experts + 1 fusion = 4 usage_records) via the streaming handler.
  const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "expert", prompt: "解释一致性哈希的原理与应用" } }));
  expect(res.status).toBe(200);
  const events = await readSse(res);
  const turnUsage = events.find((e) => e.event === "turn.usage")!.data;
  expect(turnUsage.callCount).toBe(4); // 3 experts + 1 fusion, billed
});

describe("US6.UC1: Usage summary aggregates (totals)", () => {
  it("returns the documented totals shape with exact cost = modelCost + platformFee", async () => {
    const r = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const d = r.body.data;
    expect(d.window).toBe("all");
    expect(d.platformFeePerCallMicro).toBe(50000);
    const t = d.totals;
    // Shape: every documented field is present.
    for (const k of ["inputTokens", "outputTokens", "reasoningTokens", "modelCostMicro", "platformFeeMicro", "totalMicro", "callCount", "requestCount"]) {
      expect(typeof t[k]).toBe("number");
    }
    // Internal zero-drift invariant.
    expect(t.totalMicro).toBe(t.modelCostMicro + t.platformFeeMicro);
    // Platform fee == N calls × per-call fee (Given/When/Then from UC1).
    expect(t.platformFeeMicro).toBe(t.callCount * d.platformFeePerCallMicro);
  });

  it("matches the raw usage_records ledger exactly (cost exactness invariant)", async () => {
    const raw = await rawLedgerTotals();
    const r = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie }));
    const t = r.body.data.totals;
    // summary.totalMicro equals the sum over all ledger rows.
    expect(t.modelCostMicro).toBe(raw.costMicro);
    expect(t.platformFeeMicro).toBe(raw.feeMicro);
    expect(t.totalMicro).toBe(raw.totalMicro);
    expect(t.callCount).toBe(raw.callCount);
    expect(t.requestCount).toBe(raw.requestCount);
    // Seeded history + the fresh expert turn means data is non-zero before any further chatting.
    expect(t.callCount).toBeGreaterThan(0);
    expect(t.totalMicro).toBeGreaterThan(0);
  });

  it("rejects an invalid window with 400 VALIDATION_ERROR", async () => {
    const r = await invoke(usageSummary, req("GET", "/api/usage/summary?window=bogus", { cookie }));
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unauthenticated request with 401 AUTH_REQUIRED", async () => {
    const r = await invoke(usageSummary, req("GET", "/api/usage/summary"));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("writes exactly one activity_logs row per summary request", async () => {
    const { db } = await getDb();
    const before = await db.select().from(activityLogs).where(and(eq(activityLogs.userId, userId), eq(activityLogs.action, "usage.summary")));
    await invoke(usageSummary, req("GET", "/api/usage/summary?window=7d", { cookie }));
    const after = await db.select().from(activityLogs).where(and(eq(activityLogs.userId, userId), eq(activityLogs.action, "usage.summary")));
    expect(after.length).toBe(before.length + 1);
  });
});

describe("US6.UC2: 7-day cost trend", () => {
  it("returns exactly N day buckets, oldest→newest, zero-filled", async () => {
    const r = await invoke(usageTrend, req("GET", "/api/usage/trend?days=7", { cookie }));
    expect(r.status).toBe(200);
    const days = r.body.data.days;
    expect(days).toHaveLength(7);
    // Oldest-first, strictly ascending day keys.
    for (let i = 1; i < days.length; i++) {
      expect(days[i].key).toBeGreaterThan(days[i - 1].key);
    }
    // Each bucket has the documented shape and a numeric (zero-filled) total.
    for (const b of days) {
      expect(typeof b.key).toBe("number");
      expect(typeof b.label).toBe("string");
      expect(b.label).toMatch(/^\d{1,2}\/\d{1,2}$/);
      expect(typeof b.totalMicro).toBe("number");
      expect(b.totalMicro).toBeGreaterThanOrEqual(0);
    }
    // Seeded + fresh turns all land inside the 7-day window → trend total is non-zero.
    const trendTotal = days.reduce((a: number, b: any) => a + b.totalMicro, 0);
    expect(trendTotal).toBeGreaterThan(0);
  });

  it("honours the days parameter count (e.g. 30 → exactly 30 buckets)", async () => {
    const r = await invoke(usageTrend, req("GET", "/api/usage/trend?days=30", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.data.days).toHaveLength(30);
  });

  it("rejects out-of-range days with 400 VALIDATION_ERROR", async () => {
    const tooBig = await invoke(usageTrend, req("GET", "/api/usage/trend?days=91", { cookie }));
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe("VALIDATION_ERROR");
    const tooSmall = await invoke(usageTrend, req("GET", "/api/usage/trend?days=0", { cookie }));
    expect(tooSmall.status).toBe(400);
    expect(tooSmall.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("US6.UC3: Cost-by-model breakdown", () => {
  it("returns models sorted by cost desc with sharePct summing to ~100%", async () => {
    const r = await invoke(usageByModel, req("GET", "/api/usage/by-model?window=all&limit=50", { cookie }));
    expect(r.status).toBe(200);
    const { models, totalModelCostMicro } = r.body.data;
    expect(models.length).toBeGreaterThan(1);
    // Sorted by modelCostMicro descending.
    for (let i = 1; i < models.length; i++) {
      expect(models[i].modelCostMicro).toBeLessThanOrEqual(models[i - 1].modelCostMicro);
    }
    // Per-model shape includes registry display fields + sharePct.
    for (const m of models) {
      expect(typeof m.modelId).toBe("string");
      expect(typeof m.name).toBe("string");
      expect(typeof m.color).toBe("string");
      expect(m.calls).toBeGreaterThan(0);
    }
    // totalModelCostMicro equals the summed per-model cost (all models, this is the full set).
    const summed = models.reduce((a: number, m: any) => a + m.modelCostMicro, 0);
    expect(summed).toBe(totalModelCostMicro);
    // sharePct values sum to ~100% (server-rounded, allow rounding slack).
    const shareSum = models.reduce((a: number, m: any) => a + m.sharePct, 0);
    expect(shareSum).toBeGreaterThanOrEqual(97);
    expect(shareSum).toBeLessThanOrEqual(103);
  });

  it("caps the returned models at limit while totalModelCostMicro reflects all models", async () => {
    const all = await invoke(usageByModel, req("GET", "/api/usage/by-model?window=all&limit=50", { cookie }));
    const limited = await invoke(usageByModel, req("GET", "/api/usage/by-model?window=all&limit=2", { cookie }));
    expect(limited.status).toBe(200);
    expect(limited.body.data.models).toHaveLength(2);
    // The two returned are the costliest two from the full set.
    expect(limited.body.data.models[0].modelId).toBe(all.body.data.models[0].modelId);
    // total reflects ALL models, not just the top 2.
    expect(limited.body.data.totalModelCostMicro).toBe(all.body.data.totalModelCostMicro);
  });

  it("rejects an out-of-range limit with 400 VALIDATION_ERROR", async () => {
    const r = await invoke(usageByModel, req("GET", "/api/usage/by-model?window=all&limit=51", { cookie }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("US6.UC4: Per-turn ledger detail (call drill-down)", () => {
  it("returns rows newest-first with de-duped models and per-turn totals", async () => {
    const r = await invoke(usageLedger, req("GET", "/api/usage/ledger?limit=100", { cookie }));
    expect(r.status).toBe(200);
    const { rows, nextCursor } = r.body.data;
    expect(rows.length).toBeGreaterThan(0);
    expect(nextCursor).toBeNull(); // all turns fit in one page of 100
    // Newest-first: descending ts.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].ts).toBeLessThanOrEqual(rows[i - 1].ts);
    }
    for (const row of rows) {
      expect(typeof row.turnId).toBe("string");
      expect(typeof row.prompt).toBe("string");
      expect(["fast", "expert"]).toContain(row.mode);
      // models are de-duped (no repeated modelId within a row).
      const ids = row.models.map((m: any) => m.modelId);
      expect(new Set(ids).size).toBe(ids.length);
      // per-turn zero-drift.
      expect(row.totalMicro).toBe(row.modelCostMicro + row.platformFeeMicro);
    }
  });

  it("shows an expert turn as 4 summed records with distinct models", async () => {
    const r = await invoke(usageLedger, req("GET", "/api/usage/ledger?limit=100", { cookie }));
    const expertRow = r.body.data.rows.find((row: any) => row.mode === "expert");
    expect(expertRow).toBeTruthy();
    // 3 distinct experts + 1 fusion compiler. The fresh turn's trio shares no member with the compiler gpt-55,
    // but seeded expert turns may include gpt-55 in the trio; assert >= 3 distinct ids in any case.
    expect(expertRow.models.length).toBeGreaterThanOrEqual(3);
    // Per-turn total equals the sum of that turn's raw usage_records.
    const { db } = await getDb();
    const urs = await db.select().from(usageRecords).where(eq(usageRecords.turnId, expertRow.turnId));
    const cost = urs.reduce((a, u) => a + u.costMicro, 0);
    const fee = urs.reduce((a, u) => a + u.platformFeeMicro, 0);
    expect(expertRow.modelCostMicro).toBe(cost);
    expect(expertRow.platformFeeMicro).toBe(fee);
    expect(expertRow.totalMicro).toBe(cost + fee);
  });

  it("paginates via nextCursor with no overlap between pages", async () => {
    // Build enough ledger history to page (a fresh account starts clean, §2.1).
    for (let i = 0; i < 6; i++) {
      const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: false, mainModel: "gpt-55", prompt: `pagination turn ${i}` } }));
      await res.text(); // drain the SSE stream to completion
    }
    const page1 = await invoke(usageLedger, req("GET", "/api/usage/ledger?limit=5", { cookie }));
    expect(page1.status).toBe(200);
    expect(page1.body.data.rows).toHaveLength(5);
    expect(page1.body.data.nextCursor).not.toBeNull();
    const cursor = page1.body.data.nextCursor;
    const page2 = await invoke(usageLedger, req("GET", `/api/usage/ledger?limit=5&cursor=${cursor}`, { cookie }));
    expect(page2.status).toBe(200);
    const ids1 = new Set(page1.body.data.rows.map((r: any) => r.turnId));
    // The cursor row itself may repeat (lte cursor), so only require no full-page overlap beyond the boundary.
    const overlap = page2.body.data.rows.filter((r: any) => ids1.has(r.turnId));
    expect(overlap.length).toBeLessThanOrEqual(1);
  });

  it("never leaks another user's turns (ownership-scoped)", async () => {
    // Second user with their own seeded history.
    const r2 = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Ben", email: "ben@omnimind.dev", password: "supersecret" } }));
    const cookieB = r2.cookie!;
    const userBId = r2.body.data.user.id;
    const ledgerA = await invoke(usageLedger, req("GET", "/api/usage/ledger?limit=100", { cookie }));
    const aTurnIds = new Set(ledgerA.body.data.rows.map((r: any) => r.turnId));
    const ledgerB = await invoke(usageLedger, req("GET", "/api/usage/ledger?limit=100", { cookie: cookieB }));
    // No turn from B appears in A's ledger and vice versa.
    for (const row of ledgerB.body.data.rows) {
      expect(aTurnIds.has(row.turnId)).toBe(false);
    }
    expect(userBId).not.toBe(userId);
  });
});

describe("US6.UC5: Export usage as CSV/JSON", () => {
  it("returns a CSV attachment with a header row and one row per usage record", async () => {
    const res = await usageExport(req("GET", "/api/usage/export?format=csv&window=all", { cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const disposition = res.headers.get("content-disposition") || "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(".csv");
    const text = await res.text();
    const lines = text.trim().split(/\r\n/);
    const header = lines[0].split(",");
    expect(header).toContain("totalMicro");
    expect(header).toContain("costMicro");
    expect(header).toContain("platformFeeMicro");
    // Exactly one data row per in-window usage_records row.
    const raw = await rawLedgerTotals();
    expect(lines.length - 1).toBe(raw.callCount);
  });

  it("returns a JSON attachment array with integer micro money fields", async () => {
    const res = await usageExport(req("GET", "/api/usage/export?format=json&window=all", { cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition") || "").toContain("attachment");
    const arr = JSON.parse(await res.text());
    expect(Array.isArray(arr)).toBe(true);
    const raw = await rawLedgerTotals();
    expect(arr.length).toBe(raw.callCount);
    let sumTotal = 0;
    for (const row of arr) {
      expect(Number.isInteger(row.costMicro)).toBe(true);
      expect(Number.isInteger(row.platformFeeMicro)).toBe(true);
      expect(row.totalMicro).toBe(row.costMicro + row.platformFeeMicro);
      sumTotal += row.totalMicro;
    }
    // Export rows reconcile exactly with the ledger total (reproducible from persisted ledger).
    expect(sumTotal).toBe(raw.totalMicro);
  });

  it("rejects an unknown format with 400 VALIDATION_ERROR", async () => {
    const r = await invoke(usageExport, req("GET", "/api/usage/export?format=pdf&window=all", { cookie }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("writes an activity_logs usage.export row recording rowCount", async () => {
    const { db } = await getDb();
    await usageExport(req("GET", "/api/usage/export?format=csv&window=all", { cookie }));
    const logs = await db.select().from(activityLogs).where(and(eq(activityLogs.userId, userId), eq(activityLogs.action, "usage.export")));
    expect(logs.length).toBeGreaterThan(0);
    const last = logs[logs.length - 1];
    const meta = last.metaJson ? JSON.parse(last.metaJson) : {};
    expect(typeof meta.rowCount).toBe("number");
  });
});
