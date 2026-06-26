import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke } from "./helpers/harness";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as chat } from "@/app/api/chat/route";
import { POST as chatRoute } from "@/app/api/chat/route/route";
import { POST as createConversation, GET as listConversations } from "@/app/api/conversations/route";
import { PATCH as renameConversation } from "@/app/api/conversations/[id]/route";
import { GET as adminUsers } from "@/app/api/admin/users/route";
import { PATCH as adminUserPatch } from "@/app/api/admin/users/[id]/route";

describe("Runtime-hunt fixes", () => {
  let cookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    await setupTestDb();
    const r = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "H", email: "h@x.io", password: "supersecret" } }));
    cookie = r.cookie!;
    const a = await invoke(login, req("POST", "/api/auth/login", { body: { email: "admin@robohire.io", password: "Lightark@1" } }));
    adminCookie = a.cookie!;
  });

  it("P2: whitespace-only conversation title is rejected (trim before min(1))", async () => {
    const c = await invoke(createConversation, req("POST", "/api/conversations", { cookie, body: { title: "real" } }));
    const id = c.body.data.conversation.id;
    const bad = await invoke(renameConversation, req("PATCH", `/api/conversations/${id}`, { cookie, body: { title: "   " } }), { id });
    expect(bad.status).toBe(400);
  });

  it("P2: /api/chat/route rejects a whitespace-only prompt (matches /api/chat)", async () => {
    const r = await invoke(chatRoute, req("POST", "/api/chat/route", { cookie, body: { prompt: "   " } }));
    expect(r.status).toBe(400);
  });

  it("P2: posting to another user's conversation → 404 NOT_FOUND (no leak)", async () => {
    // user A creates a conversation; user B must not be able to chat into it.
    const a = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "A", email: "a2@x.io", password: "supersecret" } }));
    const ac = a.cookie!;
    const conv = await invoke(createConversation, req("POST", "/api/conversations", { cookie: ac, body: { title: "A's" } }));
    const aConvId = conv.body.data.conversation.id;
    const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: true, prompt: "intrude", conversationId: aConvId } }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("hardening: admin cannot mutate a system account via PATCH (demo stays a demo user)", async () => {
    const list = await invoke(adminUsers, req("GET", "/api/admin/users", { cookie: adminCookie }));
    const demo = (list.body.data.users as any[]).find((u) => u.email === "demo");
    expect(demo).toBeTruthy();
    const r = await invoke(adminUserPatch, req("PATCH", `/api/admin/users/${demo.id}`, { cookie: adminCookie, body: { role: "admin", planId: "team" } }), { id: demo.id });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("CANNOT_MODIFY_SYSTEM");
  });
});
