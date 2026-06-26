import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke, readSse, concatDeltas } from "./helpers/harness";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as chat } from "@/app/api/chat/route";
import { POST as regenerate } from "@/app/api/chat/regenerate/route";
import { GET as ledger } from "@/app/api/usage/ledger/route";
import { PATCH as patchModel } from "@/app/api/models/[id]/route";

/**
 * US3 — Multi-expert fusion. Drives the REAL chat / regenerate / ledger route
 * handlers against an isolated mock-mode DB. Each describe is one use case.
 *
 * Domain invariants under test (docs §2.2/§2.4, fusion.ts):
 *  - expert turn → 3 expert call.start + call.usage(role=expert) + reason.* + answer.delta + fusion call.usage(role=fusion, reasoningTokens>0)
 *  - turn.usage callCount=4, turnFeeMicro=200000 (4 × ¥0.05)
 *  - regenerate replaces the turn in place (same turnId/messageId path) and re-bills (4 fresh rows)
 *  - ledger reflects exactly that turn (4 calls, total = modelCost + fee)
 *
 * The default trio is ["deepseek-pro","gpt-55","claude-opus"], compiler = gpt-55,
 * and mode defaults to "expert" (preferences seeded at signup).
 */

const PLATFORM_FEE_MICRO = 50000; // ¥0.05 × 1e6
const EXPECTED_CALLS = 4; // 3 experts + 1 fusion
const EXPECTED_FEE = EXPECTED_CALLS * PLATFORM_FEE_MICRO; // 200000

// A valid 3-model trio + compiler that are all enabled by default and distinct
// from the models we disable in the error-path tests.
const TRIO = ["deepseek-pro", "claude-opus", "qwen"];
const COMPILER = "gpt-55";

/** Disable a model for the user (mirrors the US5 toggle UI). */
async function disableModel(cookie: string, id: string) {
  return invoke(patchModel, req("PATCH", `/api/models/${id}`, { cookie, body: { enabled: false } }), { id });
}

/** Run one expert turn and return the parsed SSE events. */
async function runExpertTurn(cookie: string, body: Record<string, unknown>) {
  const res = await chat(req("POST", "/api/chat", { cookie, body }));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
  return readSse(res);
}

let cookie: string;

beforeAll(async () => {
  await setupTestDb();
  const r = await invoke(signup, req("POST", "/api/auth/signup", {
    body: { name: "Mei", email: "mei@omnimind.dev", password: "supersecret" },
  }));
  expect(r.status).toBe(200);
  cookie = r.cookie!;
  expect(cookie).toBeTruthy();
});

describe("US3.UC1: Run the expert trio in parallel", () => {
  it("emits 3 expert call.start + 3 expert call.usage tagged by modelId", async () => {
    const events = await runExpertTurn(cookie, {
      mode: "expert",
      prompt: "用 Python 写快速排序并解释复杂度",
      trio: TRIO,
      mainModel: COMPILER,
    });

    const callStarts = events.filter((e) => e.event === "call.start" && e.data.role === "expert");
    expect(callStarts).toHaveLength(3);
    // the three expert call.starts carry exactly the trio's distinct modelIds
    expect(new Set(callStarts.map((e) => e.data.modelId))).toEqual(new Set(TRIO));

    const expertUsage = events.filter((e) => e.event === "call.usage" && e.data.role === "expert");
    expect(expertUsage).toHaveLength(3);
    expect(new Set(expertUsage.map((e) => e.data.modelId))).toEqual(new Set(TRIO));
    // each expert is independently billed with its own ¥0.05 fee + non-zero model cost
    for (const u of expertUsage) {
      expect(u.data.status).toBe("ok");
      expect(u.data.platformFeeMicro).toBe(PLATFORM_FEE_MICRO);
      expect(u.data.reasoningTokens).toBe(0);
      expect(u.data.costMicro).toBeGreaterThan(0);
    }
    // each expert produced streamed token deltas
    const expertDeltas = events.filter((e) => e.event === "call.delta" && e.data.role === "expert");
    expect(expertDeltas.length).toBeGreaterThan(0);
  });

  it("rejects a trio containing a disabled model with 400 INVALID_TRIO", async () => {
    // gemini-pro is not part of TRIO/COMPILER, so disabling it is allowed.
    const d = await disableModel(cookie, "gemini-pro");
    expect(d.status).toBe(200);

    const r = await invoke(chat, req("POST", "/api/chat", {
      cookie,
      body: { mode: "expert", prompt: "hello", trio: ["deepseek-pro", "claude-opus", "gemini-pro"], mainModel: COMPILER },
    }));
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error!.code).toBe("INVALID_TRIO");

    // re-enable for later tests
    const re = await invoke(patchModel, req("PATCH", `/api/models/gemini-pro`, { cookie, body: { enabled: true } }), { id: "gemini-pro" });
    expect(re.status).toBe(200);
  });

  it("rejects a trio with a duplicate id (not 3 distinct) with 400", async () => {
    const r = await invoke(chat, req("POST", "/api/chat", {
      cookie,
      body: { mode: "expert", prompt: "hi", trio: ["deepseek-pro", "deepseek-pro", "claude-opus"], mainModel: COMPILER },
    }));
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    // zod refinement (VALIDATION_ERROR) or the handler's INVALID_TRIO — both are 400 rejections
    expect(["VALIDATION_ERROR", "INVALID_TRIO"]).toContain(r.body.error!.code);
  });
});

describe("US3.UC2: Stream the reasoning / thinking trace", () => {
  it("emits the reason phase before the final answer and records reasoningTokens>0", async () => {
    const events = await runExpertTurn(cookie, {
      mode: "expert",
      prompt: "解释 CAP 定理",
      trio: TRIO,
      mainModel: COMPILER,
    });

    const names = events.map((e) => e.event);
    expect(names).toContain("reason.start");
    expect(names).toContain("reason.done");
    expect(names).toContain("answer.delta");

    // ordering: reason.start ... reason.done come BEFORE the first answer.delta
    const firstReasonStart = names.indexOf("reason.start");
    const reasonDone = names.indexOf("reason.done");
    const firstAnswer = names.indexOf("answer.delta");
    expect(firstReasonStart).toBeGreaterThanOrEqual(0);
    expect(reasonDone).toBeGreaterThan(firstReasonStart);
    expect(firstAnswer).toBeGreaterThan(reasonDone);

    // reasoning tokens are tracked and non-empty
    const reasonDoneEvt = events.find((e) => e.event === "reason.done")!;
    expect(reasonDoneEvt.data.reasoningTokens).toBeGreaterThan(0);
    const reasonText = concatDeltas(events, "reason.delta");
    expect(reasonText.length).toBeGreaterThan(0);

    // the fusion usage row carries reasoningTokens > 0, separate from outputTokens
    const fusionUsage = events.find((e) => e.event === "call.usage" && e.data.role === "fusion")!;
    expect(fusionUsage).toBeTruthy();
    expect(fusionUsage.data.modelId).toBe(COMPILER);
    expect(fusionUsage.data.reasoningTokens).toBeGreaterThan(0);
    expect(fusionUsage.data.outputTokens).toBeGreaterThan(0);
    expect(fusionUsage.data.reasoningTokens).not.toBe(fusionUsage.data.outputTokens);
  });

  it("returns 409 COMPILER_UNAVAILABLE when the compiler model is disabled", async () => {
    // doubao is not in TRIO/COMPILER, so it can be disabled, then used as mainModel.
    const d = await disableModel(cookie, "doubao");
    expect(d.status).toBe(200);

    const r = await invoke(chat, req("POST", "/api/chat", {
      cookie,
      body: { mode: "expert", prompt: "anything", trio: TRIO, mainModel: "doubao" },
    }));
    expect(r.status).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(r.body.error!.code).toBe("COMPILER_UNAVAILABLE");

    const re = await invoke(patchModel, req("PATCH", `/api/models/doubao`, { cookie, body: { enabled: true } }), { id: "doubao" });
    expect(re.status).toBe(200);
  });
});

describe("US3.UC3: Final Compiler synthesizes one answer", () => {
  it("delivers one consolidated answer distinct from any single expert text", async () => {
    const events = await runExpertTurn(cookie, {
      mode: "expert",
      prompt: "比较乐观锁与悲观锁",
      trio: TRIO,
      mainModel: COMPILER,
    });

    const names = events.map((e) => e.event);
    expect(names).toContain("turn.done");

    const fusionText = concatDeltas(events, "answer.delta");
    expect(fusionText.length).toBeGreaterThan(0);

    // fusion answer is NOT byte-identical to any single expert's streamed text
    const expertTexts = new Map<string, string>();
    for (const e of events.filter((x) => x.event === "call.delta" && x.data.role === "expert")) {
      const id = e.data.modelId as string;
      expertTexts.set(id, (expertTexts.get(id) ?? "") + (e.data.delta ?? ""));
    }
    expect(expertTexts.size).toBe(3);
    for (const t of expertTexts.values()) {
      expect(fusionText).not.toBe(t);
    }

    // exactly one fusion usage row, role=fusion, attributed to the compiler
    const fusionUsage = events.filter((e) => e.event === "call.usage" && e.data.role === "fusion");
    expect(fusionUsage).toHaveLength(1);
    expect(fusionUsage[0].data.modelId).toBe(COMPILER);
  });
});

describe("US3.UC5: Per-call accounting across the whole Expert turn", () => {
  it("turn.usage reports callCount=4 and turnFeeMicro=200000 with zero-drift total", async () => {
    const events = await runExpertTurn(cookie, {
      mode: "expert",
      prompt: "什么是向量数据库",
      trio: TRIO,
      mainModel: COMPILER,
    });

    const turnUsage = events.find((e) => e.event === "turn.usage")!;
    expect(turnUsage).toBeTruthy();
    expect(turnUsage.data.callCount).toBe(EXPECTED_CALLS);
    expect(turnUsage.data.turnFeeMicro).toBe(EXPECTED_FEE); // 4 × ¥0.05 = 200000

    // total = model cost + platform fee, exactly (integer micro, no float drift)
    expect(turnUsage.data.turnTotalMicro).toBe(turnUsage.data.turnCostMicro + turnUsage.data.turnFeeMicro);

    // the per-call platform fees over the whole turn sum to the turn fee
    const callUsages = events.filter((e) => e.event === "call.usage");
    expect(callUsages).toHaveLength(EXPECTED_CALLS);
    const feeSum = callUsages.reduce((a, e) => a + e.data.platformFeeMicro, 0);
    expect(feeSum).toBe(EXPECTED_FEE);
    const costSum = callUsages.reduce((a, e) => a + e.data.costMicro, 0);
    expect(costSum).toBe(turnUsage.data.turnCostMicro);
  });

  it("the call ledger shows the turn with 4 calls and a self-consistent total", async () => {
    const r = await invoke(ledger, req("GET", "/api/usage/ledger?limit=50", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const rows = r.body.data.rows as any[];
    expect(rows.length).toBeGreaterThan(0);

    // every expert turn in the ledger reflects modelCost + fee exactly
    const expertRows = rows.filter((row) => row.mode === "expert");
    expect(expertRows.length).toBeGreaterThan(0);
    for (const row of expertRows) {
      expect(row.totalMicro).toBe(row.modelCostMicro + row.platformFeeMicro);
      // platform fee on an expert turn = 4 × ¥0.05 (3 experts + 1 fusion)
      expect(row.platformFeeMicro).toBe(EXPECTED_FEE);
      // distinct models on an expert turn: TRIO (3) + compiler may overlap; at least the 3 experts
      expect(row.models.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("US3.UC4: Regenerate an Expert turn", () => {
  let convId: string;
  let turnId: string;
  let firstFusion: string;
  let firstLedgerFee: number;

  it("seeds an expert turn to regenerate", async () => {
    const events = await runExpertTurn(cookie, {
      mode: "expert",
      prompt: "什么是 MVCC",
      trio: TRIO,
      mainModel: COMPILER,
    });
    const start = events.find((e) => e.event === "turn.start")!;
    convId = start.data.conversationId;
    turnId = start.data.turnId;
    expect(convId).toBeTruthy();
    expect(turnId).toBeTruthy();
    firstFusion = concatDeltas(events, "answer.delta");

    // capture the ledger fee/calls for this turn after the first run
    const lr = await invoke(ledger, req("GET", "/api/usage/ledger?limit=50", { cookie }));
    const row = (lr.body.data.rows as any[]).find((x) => x.turnId === turnId)!;
    expect(row).toBeTruthy();
    firstLedgerFee = row.platformFeeMicro;
    expect(firstLedgerFee).toBe(EXPECTED_FEE);
  });

  it("re-runs the same trio + compiler in place via POST /api/chat/regenerate and re-bills", async () => {
    const res = await regenerate(req("POST", "/api/chat/regenerate", {
      cookie,
      body: { conversationId: convId, turnId },
    }));
    expect(res.status).toBe(200);
    const events = await readSse(res);

    // same turnId is reused (in-place replace)
    const start = events.find((e) => e.event === "turn.start")!;
    expect(start.data.turnId).toBe(turnId);

    // re-ran the full expert→reason→fusion pipeline: 3 experts + reason + fusion
    expect(events.filter((e) => e.event === "call.start" && e.data.role === "expert")).toHaveLength(3);
    expect(events.map((e) => e.event)).toContain("reason.done");
    const turnUsage = events.find((e) => e.event === "turn.usage")!;
    expect(turnUsage.data.callCount).toBe(EXPECTED_CALLS);
    expect(turnUsage.data.turnFeeMicro).toBe(EXPECTED_FEE);

    // the regenerated turn replaces (not appends) usage: the ledger row still bills exactly 4 calls
    const lr = await invoke(ledger, req("GET", "/api/usage/ledger?limit=50", { cookie }));
    const row = (lr.body.data.rows as any[]).find((x) => x.turnId === turnId)!;
    expect(row).toBeTruthy();
    expect(row.platformFeeMicro).toBe(EXPECTED_FEE); // replaced in place, not doubled to 8 calls
    expect(row.totalMicro).toBe(row.modelCostMicro + row.platformFeeMicro);
  });

  it("returns 404 TURN_NOT_FOUND for an unknown turn id", async () => {
    const r = await invoke(regenerate, req("POST", "/api/chat/regenerate", {
      cookie,
      body: { conversationId: convId, turnId: "00000000-0000-0000-0000-000000000000" },
    }));
    expect(r.status).toBe(404);
    expect(r.body.ok).toBe(false);
    expect(r.body.error!.code).toBe("TURN_NOT_FOUND");
  });

  it("rejects regeneration by a different (non-owning) user with 404 TURN_NOT_FOUND", async () => {
    const other = await invoke(signup, req("POST", "/api/auth/signup", {
      body: { name: "Lee", email: "lee@omnimind.dev", password: "supersecret" },
    }));
    expect(other.status).toBe(200);
    const otherCookie = other.cookie!;

    const r = await invoke(regenerate, req("POST", "/api/chat/regenerate", {
      cookie: otherCookie,
      body: { conversationId: convId, turnId },
    }));
    expect(r.status).toBe(404);
    expect(r.body.error!.code).toBe("TURN_NOT_FOUND");
  });

  it("rejects an unauthenticated regenerate with 401 AUTH_REQUIRED", async () => {
    const r = await invoke(regenerate, req("POST", "/api/chat/regenerate", {
      body: { conversationId: convId, turnId },
    }));
    expect(r.status).toBe(401);
    expect(r.body.error!.code).toBe("AUTH_REQUIRED");
  });
});
