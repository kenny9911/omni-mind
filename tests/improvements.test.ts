import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";
import { getDb } from "@/lib/server/db/client";
import { users, turns } from "@/lib/server/db/schema";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as chat } from "@/app/api/chat/route";
import { POST as regenerate } from "@/app/api/chat/regenerate/route";
import { GET as getMessages } from "@/app/api/conversations/[id]/messages/route";
import { PATCH as patchPrefs } from "@/app/api/preferences/route";
import { GET as usageSummary } from "@/app/api/usage/summary/route";
import { GET as adminMetrics } from "@/app/api/admin/metrics/route";
import { PUT as putPaymentMethod } from "@/app/api/billing/payment-method/route";

async function streamChat(cookie: string, body: Record<string, unknown>) {
  const res = await chat(req("POST", "/api/chat", { cookie, body }));
  return { res, events: await readSse(res) };
}

describe("PO improvement round — regression coverage", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await setupTestDb();
    const r = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Imp", email: "imp@omnimind.dev", password: "supersecret" } }));
    cookie = r.cookie!;
    userId = r.body.data.user.id;
  });

  afterEach(() => {
    delete process.env.MOCK_FAIL_MODELS;
  });

  it("G3: all experts fail → ALL_EXPERTS_FAILED, turn failed, no fusion billed", async () => {
    const before = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie }));
    const callsBefore = before.body.data.totals.callCount;
    process.env.MOCK_FAIL_MODELS = "deepseek-pro,gpt-55,claude-opus";
    const { events } = await streamChat(cookie, { mode: "expert", prompt: "this will all fail", trio: ["deepseek-pro", "gpt-55", "claude-opus"], mainModel: "gpt-55" });
    expect(events.some((e) => e.event === "error" && e.data?.code === "ALL_EXPERTS_FAILED")).toBe(true);
    expect(events.some((e) => e.event === "reason.start")).toBe(false); // fusion never ran
    const after = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie }));
    expect(after.body.data.totals.callCount).toBe(callsBefore); // nothing billed
    const { db } = await getDb();
    const [t] = await db.select().from(turns).where(eq(turns.userId, userId)).orderBy(turns.createdAt);
    const all = await db.select().from(turns).where(eq(turns.userId, userId));
    expect(all.some((x) => x.status === "failed")).toBe(true);
  });

  it("G1: a failed fast call is not billed at status ok + fee", async () => {
    const before = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie }));
    const callsBefore = before.body.data.totals.callCount;
    process.env.MOCK_FAIL_MODELS = "gpt-55";
    const { events } = await streamChat(cookie, { mode: "fast", auto: false, mainModel: "gpt-55", prompt: "fail me fast" });
    expect(events.some((e) => e.event === "call.error")).toBe(true);
    expect(events.some((e) => e.event === "error")).toBe(true);
    const after = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie }));
    expect(after.body.data.totals.callCount).toBe(callsBefore); // not billed
  });

  it("G4: regenerate replays the ORIGINAL turn's trio, not current preferences", async () => {
    const origTrio = ["deepseek-pro", "gpt-55", "claude-opus"];
    const { events } = await streamChat(cookie, { mode: "expert", prompt: "fidelity check", trio: origTrio, mainModel: "gpt-55" });
    const turnId = events.find((e) => e.event === "turn.start")!.data.turnId;
    const conversationId = events.find((e) => e.event === "turn.start")!.data.conversationId;

    // Change preferences trio to a completely different set.
    const newTrio = ["glm", "qwen", "gemini-pro"];
    const pr = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { trio: newTrio } }));
    expect(pr.status).toBe(200);

    // Regenerate the original turn.
    const rg = await regenerate(req("POST", "/api/chat/regenerate", { cookie, body: { conversationId, turnId } }));
    await readSse(rg);

    // History must show the ORIGINAL trio, not the new preferences trio.
    const msgs = await invoke(getMessages, req("GET", `/api/conversations/${conversationId}/messages`, { cookie }), { id: conversationId });
    const turn = (msgs.body.data.turns as any[]).find((t) => t.turnId === turnId);
    const usedModels = turn.assistant.experts.map((e: any) => e.modelId).sort();
    expect(usedModels).toEqual([...origTrio].sort());
  });

  it("G5: deepAgents inflates input tokens (observable effect, not inert)", async () => {
    const plain = await streamChat(cookie, { mode: "fast", auto: false, mainModel: "deepseek-flash", prompt: "same prompt text here" });
    const agents = await streamChat(cookie, { mode: "fast", auto: false, mainModel: "deepseek-flash", deepAgents: true, prompt: "same prompt text here" });
    const inPlain = plain.events.find((e) => e.event === "call.usage")!.data.inputTokens;
    const inAgents = agents.events.find((e) => e.event === "call.usage")!.data.inputTokens;
    expect(inAgents).toBeGreaterThan(inPlain);
  });

  it("G6: admin metrics happy path returns the full metrics shape", async () => {
    // Promote a fresh admin user directly via the test DB.
    const a = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Admin", email: "admin@omnimind.dev", password: "supersecret" } }));
    const adminCookie = a.cookie!;
    const adminId = a.body.data.user.id;
    const { db } = await getDb();
    await db.update(users).set({ role: "admin" }).where(eq(users.id, adminId));
    // Re-login so the session resolves the now-admin role (role read on each request from users row).
    const r = await invoke(adminMetrics, req("GET", "/api/admin/metrics?window=24h", { cookie: adminCookie }));
    expect(r.status).toBe(200);
    const m = r.body.data.metrics;
    expect(m).toHaveProperty("requests");
    expect(m).toHaveProperty("errorRate");
    expect(m).toHaveProperty("p50LatencyMs");
    expect(m).toHaveProperty("p95LatencyMs");
    expect(m).toHaveProperty("totalCostMicro");
    expect(Array.isArray(m.callsByModel)).toBe(true);
    expect(m.requests).toBeGreaterThan(0);
  });

  it("G12: unknown email and wrong password both return 401 AUTH_INVALID", async () => {
    const unknown = await invoke(login, req("POST", "/api/auth/login", { body: { email: "nobody@omnimind.dev", password: "whatever123" } }));
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("AUTH_INVALID");
    const wrong = await invoke(login, req("POST", "/api/auth/login", { body: { email: "imp@omnimind.dev", password: "wrongpassword" } }));
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("AUTH_INVALID");
  });

  it("G18: payment method rejects a non-numeric last4 and unknown brand", async () => {
    const bad = await invoke(putPaymentMethod, req("PUT", "/api/billing/payment-method", { cookie, body: { brand: "visa", last4: "abcd", expMonth: 8, expYear: 2030 } }));
    expect(bad.status).toBe(400);
    const badBrand = await invoke(putPaymentMethod, req("PUT", "/api/billing/payment-method", { cookie, body: { brand: "dinersclub", last4: "4242", expMonth: 8, expYear: 2030 } }));
    expect(badBrand.status).toBe(400);
    const ok = await invoke(putPaymentMethod, req("PUT", "/api/billing/payment-method", { cookie, body: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2030 } }));
    expect(ok.status).toBe(200);
  });
});
