import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as chat } from "@/app/api/chat/route";
import { GET as activity } from "@/app/api/activity/route";
import { GET as activityExport } from "@/app/api/activity/export/route";
import { GET as adminMetrics } from "@/app/api/admin/metrics/route";
import { GET as usage } from "@/app/api/usage/route";

/**
 * US10 — Activity Logging & Observability.
 * Covers UC1 (auto-log every request, incl. 4xx), UC2 (usage_records per model
 * call → /api/usage), UC3 (query own logs, non-admin force-scoping → 403),
 * UC4 (export csv/json), UC5 (admin metrics 403 for non-admin).
 *
 * One isolated DB for the whole file (single setupTestDb). The "activity.query"
 * row for a request is written by the route() wrapper AFTER the handler returns,
 * so a query never sees its own row — assertions account for this.
 *
 * Default signup users are role=user (non-admin), so the admin-positive paths
 * cannot be exercised; we assert the documented 403 guards for US10.UC5.
 */

// Shared users for the whole file.
let cookieA: string; // primary user (Ada)
let cookieB: string; // second user, for cross-user scoping (Grace)
let userIdB: string;

// Drive a real chat turn end-to-end so usage_records get written. The handler
// only persists usage once the SSE stream is fully consumed, so we read it.
async function runChatTurn(cookie: string): Promise<{ event: string; data: any }[]> {
  const res = await chat(
    req("POST", "/api/chat", {
      cookie,
      body: { mode: "fast", auto: true, prompt: "Say hello in one short sentence." },
    }),
  );
  expect(res.status).toBe(200);
  return readSse(res);
}

beforeAll(async () => {
  await setupTestDb();
  const a = await invoke(
    signup,
    req("POST", "/api/auth/signup", {
      body: { name: "Ada", email: "ada@omnimind.dev", password: "supersecret" },
    }),
  );
  expect(a.status).toBe(200);
  cookieA = a.cookie!;
  expect(cookieA).toBeTruthy();

  const b = await invoke(
    signup,
    req("POST", "/api/auth/signup", {
      body: { name: "Grace", email: "grace@omnimind.dev", password: "supersecret" },
    }),
  );
  expect(b.status).toBe(200);
  cookieB = b.cookie!;
  userIdB = b.body.data.user.id;
});

describe("US10.UC1: every request writes exactly one activity_logs row (incl. 4xx)", () => {
  it("returns x-request-id on the response, and the row is queryable afterwards", async () => {
    const first = await invoke(activity, req("GET", "/api/activity", { cookie: cookieA }));
    expect(first.status).toBe(200);
    expect(first.requestId).toBeTruthy();
    // The wrapper logs activity.query AFTER returning, so a follow-up query sees it.
    const second = await invoke(activity, req("GET", "/api/activity?limit=200", { cookie: cookieA }));
    const logged = second.body.data.logs.find((l: any) => l.requestId === first.requestId);
    expect(logged).toBeDefined();
    expect(logged.requestId).toBe(first.requestId); // header == logged requestId
    expect(logged.action).toBe("activity.query");
  });

  it("logs a measured latencyMs >= 0 and a populated action for every row", async () => {
    const r = await invoke(activity, req("GET", "/api/activity?limit=50", { cookie: cookieA }));
    expect(r.status).toBe(200);
    expect(r.body.data.logs.length).toBeGreaterThan(0);
    for (const l of r.body.data.logs) {
      expect(typeof l.action).toBe("string");
      expect(l.action.length).toBeGreaterThan(0);
      expect(l.latencyMs).toBeGreaterThanOrEqual(0);
      expect(l.method).toBe("GET");
    }
  });

  it("logs are returned newest-first", async () => {
    const r = await invoke(activity, req("GET", "/api/activity?limit=50", { cookie: cookieA }));
    const ts = r.body.data.logs.map((l: any) => l.createdAt);
    expect(ts).toEqual([...ts].sort((a, b) => b - a));
  });

  it("a validation 400 while authed still creates an activity_logs row", async () => {
    // status must be an int; a non-numeric value fails zod coercion → 400.
    const bad = await invoke(activity, req("GET", "/api/activity?status=notanumber", { cookie: cookieA }));
    expect(bad.status).toBe(400);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect(bad.requestId).toBeTruthy();

    // That failed request must itself have produced a status:400 activity row.
    const after = await invoke(activity, req("GET", "/api/activity?limit=200", { cookie: cookieA }));
    const row400 = after.body.data.logs.find((l: any) => l.requestId === bad.requestId);
    expect(row400).toBeDefined();
    expect(row400.status).toBe(400);
    expect(row400.action).toBe("activity.query");
  });

  it("a 401 (no session) is not visible when later querying as the authed user", async () => {
    // Unauthenticated request → logged with userId:null, scoped out of the user's view.
    const unauth = await invoke(activity, req("GET", "/api/activity"));
    expect(unauth.status).toBe(401);
    expect(unauth.body.error.code).toBe("AUTH_REQUIRED");
    expect(unauth.requestId).toBeTruthy();

    const after = await invoke(activity, req("GET", "/api/activity?limit=200", { cookie: cookieA }));
    const leaked = after.body.data.logs.find((l: any) => l.requestId === unauth.requestId);
    expect(leaked).toBeUndefined();
    // And no 401 rows leak into the caller's own scoped view at all.
    expect(after.body.data.logs.some((l: any) => l.status === 401)).toBe(false);
  });
});

describe("US10.UC2: gateway usage_records written per model call", () => {
  it("a fast/auto turn produces a single usage record visible in /api/usage", async () => {
    // Capture the baseline (other describes may have seeded usage for this user).
    const before = await invoke(usage, req("GET", "/api/usage?window=all", { cookie: cookieA }));
    expect(before.status).toBe(200);
    const baseCalls = before.body.data.totals.callCount;
    const baseFee = before.body.data.totals.platformFeeMicro;

    const events = await runChatTurn(cookieA);
    expect(events.map((e) => e.event)).toContain("turn.done");

    const after = await invoke(usage, req("GET", "/api/usage?window=all", { cookie: cookieA }));
    expect(after.status).toBe(200);
    const t = after.body.data.totals;
    // Exactly one additional model call (role:"single") for a fast turn.
    expect(t.callCount).toBe(baseCalls + 1);
    // Platform fee = ¥0.05 in micro-cents per call (50000).
    expect(after.body.data.platformFeePerCallMicro).toBe(50000);
    expect(t.platformFeeMicro).toBe(baseFee + 50000);
    // Zero-drift invariant: aggregate total == model cost + platform fee.
    expect(t.totalMicro).toBe(t.modelCostMicro + t.platformFeeMicro);
    expect(t.inputTokens + t.outputTokens).toBeGreaterThan(0);
  });

  it("the turn recorded a chat.send activity row (status 200, route /api/chat)", async () => {
    const acts = await invoke(activity, req("GET", "/api/activity?action=chat.send&limit=50", { cookie: cookieA }));
    expect(acts.status).toBe(200);
    expect(acts.body.data.logs.length).toBeGreaterThanOrEqual(1);
    const last = acts.body.data.logs[0]; // newest-first
    expect(last.status).toBe(200);
    expect(last.route).toBe("/api/chat");
  });
});

describe("US10.UC3: query activity logs (non-admin force-scoped to self)", () => {
  it("returns only the caller's own rows — never another user's", async () => {
    // Generate a distinct request for user B.
    const bReq = await invoke(activity, req("GET", "/api/activity", { cookie: cookieB }));
    expect(bReq.status).toBe(200);

    const a = await invoke(activity, req("GET", "/api/activity?limit=200", { cookie: cookieA }));
    expect(a.status).toBe(200);
    expect(a.body.data.logs.length).toBeGreaterThan(0);
    // A non-admin can never see another user's request ids.
    const aHasBsRow = a.body.data.logs.some((l: any) => l.requestId === bReq.requestId);
    expect(aHasBsRow).toBe(false);
  });

  it("non-admin passing another user's ?userId is forbidden (403 FORBIDDEN)", async () => {
    const r = await invoke(
      activity,
      req("GET", `/api/activity?userId=${encodeURIComponent(userIdB)}`, { cookie: cookieA }),
    );
    expect(r.status).toBe(403);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("FORBIDDEN");
    expect(r.body.data).toBeUndefined();
  });

  it("action filter returns only matching rows, newest-first", async () => {
    const r = await invoke(
      activity,
      req("GET", "/api/activity?action=activity.query&limit=100", { cookie: cookieA }),
    );
    expect(r.status).toBe(200);
    expect(r.body.data.logs.length).toBeGreaterThan(0);
    for (const l of r.body.data.logs) expect(l.action).toBe("activity.query");
    const ts = r.body.data.logs.map((l: any) => l.createdAt);
    expect(ts).toEqual([...ts].sort((x, y) => y - x));
  });

  it("supports cursor paging (limit=1 → nextCursor advances to a different row)", async () => {
    const p1 = await invoke(activity, req("GET", "/api/activity?limit=1", { cookie: cookieA }));
    expect(p1.status).toBe(200);
    expect(p1.body.data.logs.length).toBe(1);
    expect(p1.body.data.nextCursor).toBeTruthy();
    const p2 = await invoke(
      activity,
      req("GET", `/api/activity?limit=1&cursor=${encodeURIComponent(p1.body.data.nextCursor)}`, {
        cookie: cookieA,
      }),
    );
    expect(p2.status).toBe(200);
    expect(p2.body.data.logs.length).toBe(1);
    expect(p2.body.data.logs[0].requestId).not.toBe(p1.body.data.logs[0].requestId);
  });
});

describe("US10.UC4: export logs & usage records (csv/json)", () => {
  beforeAll(async () => {
    // Ensure user A has at least one usage record to export.
    await runChatTurn(cookieA);
  });

  it("type=usage&format=csv streams an attachment with a header row + integer money columns", async () => {
    const res = await activityExport(req("GET", "/api/activity/export?type=usage&format=csv", { cookie: cookieA }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("usage-");

    const text = await res.text();
    const lines = text.trim().split(/\r\n/);
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + >=1 row
    const header = lines[0].split(",");
    expect(header).toContain("costMicro");
    expect(header).toContain("platformFeeMicro");
    expect(header).toContain("role");

    const feeIdx = header.indexOf("platformFeeMicro");
    const dataCols = lines[1].split(",");
    // Money is an integer micro-cent value (no decimal point).
    expect(dataCols[feeIdx]).toBe("50000");
    expect(Number.isInteger(Number(dataCols[feeIdx]))).toBe(true);
  });

  it("type=activity&format=json returns an attachment with rows + matching rowCount", async () => {
    const res = await activityExport(req("GET", "/api/activity/export?type=activity&format=json", { cookie: cookieA }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toContain("activity-");
    const body = await res.json();
    expect(body.type).toBe("activity");
    expect(body.rowCount).toBe(body.rows.length);
    expect(body.rowCount).toBeGreaterThan(0);
    // Non-admin export must only contain this caller's rows.
    const someUser = body.rows[0].userId;
    expect(someUser).toBeTruthy();
    for (const r of body.rows) expect(r.userId).toBe(someUser);
  });

  it("invalid type/format → 400 VALIDATION_ERROR", async () => {
    const r = await invoke(activityExport, req("GET", "/api/activity/export?type=bogus&format=csv", { cookie: cookieA }));
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("an export records an activity.export row (status 200)", async () => {
    await activityExport(req("GET", "/api/activity/export?type=usage&format=json", { cookie: cookieA }));
    const acts = await invoke(activity, req("GET", "/api/activity?action=activity.export&limit=10", { cookie: cookieA }));
    expect(acts.status).toBe(200);
    expect(acts.body.data.logs.length).toBeGreaterThan(0);
    expect(acts.body.data.logs[0].status).toBe(200);
  });
});

describe("US10.UC5: admin metrics dashboard (403 for non-admin)", () => {
  it("a default (role=user) caller is forbidden, leaking no metrics", async () => {
    const r = await invoke(adminMetrics, req("GET", "/api/admin/metrics?window=24h", { cookie: cookieA }));
    expect(r.status).toBe(403);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("FORBIDDEN");
    expect(r.body.data).toBeUndefined();
  });

  it("an unauthenticated caller is challenged (401 AUTH_REQUIRED)", async () => {
    const r = await invoke(adminMetrics, req("GET", "/api/admin/metrics?window=24h"));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("AUTH_REQUIRED");
    expect(r.body.data).toBeUndefined();
  });

  it("still carries x-request-id on the forbidden response", async () => {
    const r = await invoke(adminMetrics, req("GET", "/api/admin/metrics", { cookie: cookieA }));
    expect(r.status).toBe(403);
    expect(r.requestId).toBeTruthy();
  });
});
