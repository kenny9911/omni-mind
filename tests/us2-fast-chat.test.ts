import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb, req, invoke, readSse, concatDeltas } from "./helpers/harness";
import { getDb } from "@/lib/server/db/client";
import { usageRecords } from "@/lib/server/db/schema";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as chat } from "@/app/api/chat/route";
import { POST as activityPing } from "@/app/api/activity/route";
import { GET as ledger } from "@/app/api/usage/ledger/route";

/**
 * US2 — Fast-mode single-model chat.
 * Tests the REAL POST /api/chat handler in fast mode against runTurn()'s SSE
 * emission, the intent router, the MODEL_NOT_AVAILABLE guard, the copy ping
 * (POST /api/activity), and per-turn usage exactness.
 *
 * Defaults (seeded at signup): mode="expert", auto=true, mainModel="gpt-55".
 * Every fast send therefore passes mode:"fast" explicitly; manual sends also
 * pass auto:false so the body override wins over the seeded auto=true.
 */

let cookie: string;

/** Read all usage_records for a given turnId from the process-global test DB. */
async function usageRowsForTurn(turnId: string) {
  const { db } = await getDb();
  return db.select().from(usageRecords).where(eq(usageRecords.turnId, turnId));
}

/** Drive a fast-mode chat send and parse the SSE stream. */
async function fastSend(body: Record<string, unknown>) {
  const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "fast", ...body } }));
  const events = await readSse(res);
  return { res, events };
}

beforeAll(async () => {
  await setupTestDb();
  const r = await invoke(
    signup,
    req("POST", "/api/auth/signup", {
      body: { name: "Fang", email: "fang@omnimind.dev", password: "supersecret" },
    }),
  );
  expect(r.status).toBe(200);
  cookie = r.cookie!;
  expect(cookie).toBeTruthy();
});

describe("US2.UC1: Send a Fast-mode prompt and stream the answer", () => {
  it("streams a fast single-model turn and persists exactly one role=single usage row", async () => {
    const { res, events } = await fastSend({
      auto: false,
      mainModel: "gpt-55",
      prompt: "Give me a quick hello.",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const names = events.map((e) => e.event);
    // Fast lifecycle: start -> single call -> usage rollup -> done.
    expect(names).toContain("turn.start");
    expect(names).toContain("call.start");
    expect(names).toContain("call.delta");
    expect(names).toContain("call.usage");
    expect(names).toContain("turn.usage");
    expect(names).toContain("turn.done");
    // No error event on the happy path.
    expect(names).not.toContain("error");

    // The answer text is non-empty (streamed via call.delta).
    const answer = concatDeltas(events, "call.delta");
    expect(answer.length).toBeGreaterThan(0);

    const done = events.find((e) => e.event === "turn.done")!.data;
    expect(done.status).toBe("done");
    expect(done.turnId).toBeTruthy();

    // Exactly ONE usage_records row, role="single", for this turn (US2.UC1 AC).
    const rows = await usageRowsForTurn(done.turnId);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("single");
    expect(rows[0].outputTokens).toBeGreaterThan(0);
    expect(rows[0].platformFeeMicro).toBe(50000); // one ¥0.05 unit
  });

  it("rejects an empty/whitespace prompt with 400 VALIDATION_ERROR and streams nothing", async () => {
    const r = await invoke(
      chat,
      req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: false, mainModel: "gpt-55", prompt: "   " } }),
    );
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error!.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unauthenticated send with 401 AUTH_REQUIRED", async () => {
    const r = await invoke(
      chat,
      req("POST", "/api/chat", { body: { mode: "fast", auto: false, mainModel: "gpt-55", prompt: "hi" } }),
    );
    expect(r.status).toBe(401);
    expect(r.body.error!.code).toBe("AUTH_REQUIRED");
  });
});

describe("US2.UC2: Auto-route picks the model from intent (emits a route event)", () => {
  it("routes a code prompt to deepseek-pro and emits a route event labelled Code", async () => {
    const { res, events } = await fastSend({ auto: true, prompt: "用 Python 写一个排序算法" });
    expect(res.status).toBe(200);

    const route = events.find((e) => e.event === "route");
    expect(route).toBeDefined();
    expect(route!.data.modelId).toBe("deepseek-pro");
    expect(route!.data.fallback).toBe(false);

    // The single usage row must reflect the routed model, not the seeded main.
    const turnId = events.find((e) => e.event === "turn.done")!.data.turnId;
    const rows = await usageRowsForTurn(turnId);
    expect(rows).toHaveLength(1);
    expect(rows[0].modelId).toBe("deepseek-pro");
    expect(rows[0].role).toBe("single");
  });

  it("routes a translation prompt to qwen", async () => {
    const { events } = await fastSend({ auto: true, prompt: "请帮我翻译这段话 translate it" });
    const route = events.find((e) => e.event === "route");
    expect(route).toBeDefined();
    expect(route!.data.modelId).toBe("qwen");
  });

  it("defaults an intent-less prompt to gpt-55", async () => {
    const { events } = await fastSend({ auto: true, prompt: "Tell me something nice." });
    const route = events.find((e) => e.event === "route");
    expect(route).toBeDefined();
    expect(route!.data.modelId).toBe("gpt-55");
  });
});

describe("US2.UC3: Manually pick the main model (auto off, NO route event)", () => {
  it("emits NO route event and bills the manually chosen model", async () => {
    const { res, events } = await fastSend({
      auto: false,
      mainModel: "claude-opus",
      prompt: "Write me a short poem.",
    });
    expect(res.status).toBe(200);

    // With auto off there must be NO route event.
    expect(events.some((e) => e.event === "route")).toBe(false);

    const turnId = events.find((e) => e.event === "turn.done")!.data.turnId;
    const rows = await usageRowsForTurn(turnId);
    expect(rows).toHaveLength(1);
    expect(rows[0].modelId).toBe("claude-opus");
    expect(rows[0].role).toBe("single");
  });

  it("rejects an unknown/disabled mainModel with 400 MODEL_NOT_AVAILABLE and streams nothing", async () => {
    const r = await invoke(
      chat,
      req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: false, mainModel: "not-a-real-model", prompt: "hi" } }),
    );
    // Guard throws BEFORE the SSE stream opens, so this is a JSON error envelope.
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error!.code).toBe("MODEL_NOT_AVAILABLE");
    expect(r.res.headers.get("content-type")).not.toContain("text/event-stream");
  });

  it("attributes two manual sends to their respective chosen models", async () => {
    const a = await fastSend({ auto: false, mainModel: "gpt-55", prompt: "first manual send" });
    const b = await fastSend({ auto: false, mainModel: "qwen", prompt: "second manual send" });

    const turnA = a.events.find((e) => e.event === "turn.done")!.data.turnId;
    const turnB = b.events.find((e) => e.event === "turn.done")!.data.turnId;
    expect(turnA).not.toBe(turnB);

    const rowsA = await usageRowsForTurn(turnA);
    const rowsB = await usageRowsForTurn(turnB);
    expect(rowsA[0].modelId).toBe("gpt-55");
    expect(rowsB[0].modelId).toBe("qwen");
  });
});

describe("US2.UC4: Copy the answer (copy ping has no billing impact)", () => {
  it("accepts a result.copy ping and writes no usage row for the turn", async () => {
    // Complete a fast turn first.
    const { events } = await fastSend({ auto: false, mainModel: "gpt-55", prompt: "copy me please" });
    const turnId = events.find((e) => e.event === "turn.done")!.data.turnId;

    const before = await usageRowsForTurn(turnId);
    expect(before).toHaveLength(1); // the single call only

    // Fire the copy beacon (US2.UC4 / §2.8).
    const r = await invoke(
      activityPing,
      req("POST", "/api/activity", { cookie, body: { action: "result.copy", turnId } }),
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.logged).toBe(true);

    // The copy ping must NOT add any usage_records row (no model call).
    const after = await usageRowsForTurn(turnId);
    expect(after).toHaveLength(before.length);
  });

  it("accepts the chat.copy action variant too", async () => {
    const r = await invoke(
      activityPing,
      req("POST", "/api/activity", { cookie, body: { action: "chat.copy" } }),
    );
    expect(r.status).toBe(200);
    expect(r.body.data.logged).toBe(true);
  });

  it("rejects an invalid copy action with 400 VALIDATION_ERROR", async () => {
    const r = await invoke(
      activityPing,
      req("POST", "/api/activity", { cookie, body: { action: "bogus.copy" } }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error!.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unauthenticated copy ping with 401 AUTH_REQUIRED", async () => {
    const r = await invoke(
      activityPing,
      req("POST", "/api/activity", { body: { action: "result.copy" } }),
    );
    expect(r.status).toBe(401);
    expect(r.body.error!.code).toBe("AUTH_REQUIRED");
  });
});

describe("US2.UC5: See per-turn token usage and cost", () => {
  it("emits turn.usage with callCount 1 and turnFeeMicro 50000 for a single fast call", async () => {
    const { events } = await fastSend({ auto: false, mainModel: "gpt-55", prompt: "usage check" });
    const turnUsage = events.find((e) => e.event === "turn.usage")!.data;

    expect(turnUsage.callCount).toBe(1); // exactly one model call in fast mode
    expect(turnUsage.turnFeeMicro).toBe(50000); // one ¥0.05 platform fee unit
    expect(turnUsage.turnCostMicro).toBeGreaterThan(0);
    // Total is exactly model cost + platform fee (no float drift).
    expect(turnUsage.turnTotalMicro).toBe(turnUsage.turnCostMicro + turnUsage.turnFeeMicro);
  });

  it("computes gpt-55 cost as inputTokens*20 + outputTokens*80 (per-1M, micro-cents)", async () => {
    const { events } = await fastSend({ auto: false, mainModel: "gpt-55", prompt: "price exactness" });
    const turnId = events.find((e) => e.event === "turn.done")!.data.turnId;
    const rows = await usageRowsForTurn(turnId);
    expect(rows).toHaveLength(1);
    const u = rows[0];
    // gpt-55: pin=20, pout=80 per 1M tokens; reasoningTokens=0 for fast single.
    const expectedCost = u.inputTokens * 20 + u.outputTokens * 80;
    expect(u.costMicro).toBe(expectedCost);
    expect(u.platformFeeMicro).toBe(50000);

    // The call.usage SSE payload must agree with the persisted row.
    const callUsage = events.find((e) => e.event === "call.usage")!.data;
    expect(callUsage.costMicro).toBe(u.costMicro);
    expect(callUsage.platformFeeMicro).toBe(50000);
    expect(callUsage.outputTokens).toBe(u.outputTokens);
  });

  it("reflects the completed fast turn in the usage ledger with one model and one fee", async () => {
    const { events } = await fastSend({ auto: false, mainModel: "claude-opus", prompt: "ledger reflect" });
    const turnId = events.find((e) => e.event === "turn.done")!.data.turnId;

    const r = await invoke(ledger, req("GET", "/api/usage/ledger?limit=20", { cookie }));
    expect(r.status).toBe(200);
    const row = r.body.data.rows.find((x: any) => x.turnId === turnId);
    expect(row).toBeDefined();
    expect(row.mode).toBe("fast");
    // Single fast turn → exactly one platform fee unit and one model in the ledger row.
    expect(row.platformFeeMicro).toBe(50000);
    expect(row.models).toHaveLength(1);
    expect(row.models[0].modelId).toBe("claude-opus");
    expect(row.totalMicro).toBe(row.modelCostMicro + row.platformFeeMicro);
  });
});
