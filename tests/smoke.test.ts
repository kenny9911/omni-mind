import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";

import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as chat } from "@/app/api/chat/route";
import { GET as usageSummary } from "@/app/api/usage/summary/route";
import { GET as models } from "@/app/api/models/route";
import { GET as subscription } from "@/app/api/billing/subscription/route";

describe("smoke: critical path", () => {
  let cookie: string;

  beforeAll(async () => {
    await setupTestDb();
    const r = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Zoe", email: "zoe@omnimind.dev", password: "supersecret" } }));
    expect(r.status).toBe(200);
    expect(r.body.data.user.email).toBe("zoe@omnimind.dev");
    cookie = r.cookie!;
    expect(cookie).toBeTruthy();
  });

  it("returns the session for a valid cookie", async () => {
    const r = await invoke(session, req("GET", "/api/auth/session", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.data.user.email).toBe("zoe@omnimind.dev");
    expect(r.body.data.preferences.lang).toBeDefined();
  });

  it("lists 12 models", async () => {
    const r = await invoke(models, req("GET", "/api/models", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.data.models).toHaveLength(12);
    expect(r.body.data.models.filter((m: any) => m.isMain)).toHaveLength(1);
  });

  it("streams a multi-expert turn and bills it", async () => {
    const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "expert", prompt: "用 Python 写快速排序并解释复杂度" } }));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const names = events.map((e) => e.event);
    expect(names).toContain("turn.start");
    expect(names).toContain("reason.done");
    expect(names).toContain("turn.usage");
    expect(names).toContain("turn.done");
    const turnUsage = events.find((e) => e.event === "turn.usage")!.data;
    expect(turnUsage.callCount).toBe(4); // 3 experts + 1 fusion
    expect(turnUsage.turnFeeMicro).toBe(200000); // 4 * 50000
  });

  it("reflects the new turn in usage summary", async () => {
    const r = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.data.totals.callCount).toBeGreaterThanOrEqual(4);
    // aggregate total equals model cost + platform fee (zero drift)
    const t = r.body.data.totals;
    expect(t.totalMicro).toBe(t.modelCostMicro + t.platformFeeMicro);
  });

  it("returns a billing subscription with usage", async () => {
    const r = await invoke(subscription, req("GET", "/api/billing/subscription", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.data.plan.id).toBe("free");
    expect(r.body.data.includedCreditMicro).toBe(0);
    expect(r.body.data.usedPct).toBeGreaterThanOrEqual(0);
  });

  it("rejects unauthenticated access", async () => {
    const r = await invoke(usageSummary, req("GET", "/api/usage/summary"));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("AUTH_REQUIRED");
  });
});
