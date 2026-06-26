import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";
import { getDb } from "@/lib/server/db/client";
import { users, usageRecords } from "@/lib/server/db/schema";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as chat } from "@/app/api/chat/route";
import { GET as profileGet, PATCH as profilePatch } from "@/app/api/profile/route";
import { GET as adminUsers, POST as adminUserCreate } from "@/app/api/admin/users/route";
import { PATCH as adminUserPatch, DELETE as adminUserDelete } from "@/app/api/admin/users/[id]/route";

async function loginAs(email: string, password: string) {
  const r = await invoke(login, req("POST", "/api/auth/login", { body: { email, password } }));
  return r;
}

describe("System accounts, per-account LLM mode, profile & admin", () => {
  beforeAll(async () => {
    await setupTestDb(); // auto-seeds the demo + admin system accounts
  });
  afterEach(() => {
    process.env.AI_GATEWAY_API_KEY = "test-gateway-key"; // restore (the 503 test deletes it)
    delete process.env.MOCK_FAIL_MODELS;
  });

  it("seeds the demo and admin system accounts, both clean (no seeded data)", async () => {
    const { db } = await getDb();
    const all = await db.select().from(users);
    const demo = all.find((u) => u.email === "demo")!;
    const admin = all.find((u) => u.email === "admin@robohire.io")!;
    expect(demo).toBeTruthy();
    expect(demo.isDemo).toBe(true); // shared-showcase marker (read-only, no-delete)
    expect(admin.role).toBe("admin");
    expect(admin.isDemo).toBe(false);
    const demoUsage = await db.select().from(usageRecords).where(eq(usageRecords.userId, demo.id));
    const adminUsage = await db.select().from(usageRecords).where(eq(usageRecords.userId, admin.id));
    expect(demoUsage.length).toBe(0); // no seeded history — demo is a clean real account
    expect(adminUsage.length).toBe(0);
  });

  it("demo / demo123 logs in and chats on real models (provider configured)", async () => {
    const r = await loginAs("demo", "demo123");
    expect(r.status).toBe(200);
    const cookie = r.cookie!;
    const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "expert", prompt: "演示一下" } }));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.some((e) => e.event === "turn.done")).toBe(true);
  });

  it("any account without a configured provider gets 503 GATEWAY_NOT_CONFIGURED", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const s = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Real", email: "real@x.io", password: "supersecret" } }));
    const cookie = s.cookie!;
    const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: false, mainModel: "gpt-55", prompt: "real please" } }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("GATEWAY_NOT_CONFIGURED");
  });

  it("admin@robohire.io logs in with admin role", async () => {
    const r = await loginAs("admin@robohire.io", "Lightark@1");
    expect(r.status).toBe(200);
    const sess = await invoke(session, req("GET", "/api/auth/session", { cookie: r.cookie! }));
    expect(sess.body.data.user.role).toBe("admin");
  });

  it("profile: GET own profile + stats, PATCH name, change password, wrong current → 400", async () => {
    const s = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Pat", email: "pat@x.io", password: "supersecret" } }));
    const cookie = s.cookie!;
    const g = await invoke(profileGet, req("GET", "/api/profile", { cookie }));
    expect(g.status).toBe(200);
    expect(g.body.data.profile.email).toBe("pat@x.io");
    expect(g.body.data.profile.stats).toHaveProperty("totalMicro");

    const rename = await invoke(profilePatch, req("PATCH", "/api/profile", { cookie, body: { name: "Patricia" } }));
    expect(rename.body.data.profile.name).toBe("Patricia");

    const badPw = await invoke(profilePatch, req("PATCH", "/api/profile", { cookie, body: { currentPassword: "wrong", newPassword: "newsecret9" } }));
    expect(badPw.status).toBe(400);

    const okPw = await invoke(profilePatch, req("PATCH", "/api/profile", { cookie, body: { currentPassword: "supersecret", newPassword: "newsecret9" } }));
    expect(okPw.status).toBe(200);
    // the new password works
    const relog = await loginAs("pat@x.io", "newsecret9");
    expect(relog.status).toBe(200);
  });

  it("profile is read-only for the demo account (403 DEMO_READONLY)", async () => {
    const r = await loginAs("demo", "demo123");
    const patch = await invoke(profilePatch, req("PATCH", "/api/profile", { cookie: r.cookie!, body: { name: "Hacker" } }));
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe("DEMO_READONLY");
  });

  it("admin user management: list, change role/plan, delete; non-admin and guards", async () => {
    const admin = await loginAs("admin@robohire.io", "Lightark@1");
    const adminCookie = admin.cookie!;
    const adminId = (await invoke(session, req("GET", "/api/auth/session", { cookie: adminCookie }))).body.data.user.id;

    // a victim user to manage
    const v = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Victim", email: "victim@x.io", password: "supersecret" } }));
    const victimId = v.body.data.user.id;

    // non-admin cannot list
    const forbidden = await invoke(adminUsers, req("GET", "/api/admin/users", { cookie: v.cookie! }));
    expect(forbidden.status).toBe(403);

    // admin lists everyone (incl. demo + admin + victim)
    const list = await invoke(adminUsers, req("GET", "/api/admin/users", { cookie: adminCookie }));
    expect(list.status).toBe(200);
    expect(list.body.data.users.length).toBeGreaterThanOrEqual(3);

    // promote victim to admin + change plan
    const promote = await invoke(adminUserPatch, req("PATCH", `/api/admin/users/${victimId}`, { cookie: adminCookie, body: { role: "admin", planId: "team" } }), { id: victimId });
    expect(promote.status).toBe(200);
    expect(promote.body.data.user.role).toBe("admin");
    expect(promote.body.data.user.plan).toBe("team");

    // admin cannot demote self
    const selfDemote = await invoke(adminUserPatch, req("PATCH", `/api/admin/users/${adminId}`, { cookie: adminCookie, body: { role: "user" } }), { id: adminId });
    expect(selfDemote.status).toBe(400);

    // admin cannot delete self or a system account
    const delSelf = await invoke(adminUserDelete, req("DELETE", `/api/admin/users/${adminId}`, { cookie: adminCookie }), { id: adminId });
    expect(delSelf.status).toBe(400);

    // delete the victim → ok
    const del = await invoke(adminUserDelete, req("DELETE", `/api/admin/users/${victimId}`, { cookie: adminCookie }), { id: victimId });
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);
    // the victim's login no longer works
    const gone = await loginAs("victim@x.io", "supersecret");
    expect(gone.status).toBe(401);
  });

  it("admin creates accounts; provisioned user logs in; duplicate + non-admin guarded", async () => {
    const admin = await loginAs("admin@robohire.io", "Lightark@1");
    const adminCookie = admin.cookie!;

    const created = await invoke(
      adminUserCreate,
      req("POST", "/api/admin/users", {
        cookie: adminCookie,
        body: { name: "Provisioned", email: "prov@x.io", password: "supersecret", role: "user", planId: "pro" },
      }),
    );
    expect(created.status).toBe(201);
    expect(created.body.data.user.email).toBe("prov@x.io");
    expect(created.body.data.user.plan).toBe("pro");
    expect(created.body.data.user.status).toBe("active");

    // the provisioned account works immediately (real password + seeded prefs)
    const login1 = await loginAs("prov@x.io", "supersecret");
    expect(login1.status).toBe(200);

    // duplicate email → 409
    const dup = await invoke(
      adminUserCreate,
      req("POST", "/api/admin/users", { cookie: adminCookie, body: { name: "Dup", email: "prov@x.io", password: "supersecret" } }),
    );
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("EMAIL_TAKEN");

    // non-admin cannot create
    const forbidden = await invoke(
      adminUserCreate,
      req("POST", "/api/admin/users", { cookie: login1.cookie!, body: { name: "X", email: "x2@x.io", password: "supersecret" } }),
    );
    expect(forbidden.status).toBe(403);

    // short password is rejected by validation
    const weak = await invoke(
      adminUserCreate,
      req("POST", "/api/admin/users", { cookie: adminCookie, body: { name: "Weak", email: "weak@x.io", password: "short" } }),
    );
    expect(weak.status).toBe(400);
  });

  it("admin resets a password: old fails, new works, existing sessions die", async () => {
    const admin = await loginAs("admin@robohire.io", "Lightark@1");
    const adminCookie = admin.cookie!;
    const v = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Reset", email: "reset@x.io", password: "originalpw1" } }));
    const id = v.body.data.user.id;
    const userCookie = v.cookie!;

    expect((await invoke(session, req("GET", "/api/auth/session", { cookie: userCookie }))).status).toBe(200);

    const reset = await invoke(
      adminUserPatch,
      req("PATCH", `/api/admin/users/${id}`, { cookie: adminCookie, body: { newPassword: "brandnewpw9" } }),
      { id },
    );
    expect(reset.status).toBe(200);

    // the reset boots the target's existing sessions
    expect((await invoke(session, req("GET", "/api/auth/session", { cookie: userCookie }))).status).toBe(401);
    // old password fails, new one works
    expect((await loginAs("reset@x.io", "originalpw1")).status).toBe(401);
    expect((await loginAs("reset@x.io", "brandnewpw9")).status).toBe(200);
  });

  it("admin suspends/reactivates an account; self-suspend + system guarded", async () => {
    const admin = await loginAs("admin@robohire.io", "Lightark@1");
    const adminCookie = admin.cookie!;
    const adminId = (await invoke(session, req("GET", "/api/auth/session", { cookie: adminCookie }))).body.data.user.id;

    const v = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Susp", email: "susp@x.io", password: "supersecret" } }));
    const id = v.body.data.user.id;
    const userCookie = v.cookie!;

    const susp = await invoke(adminUserPatch, req("PATCH", `/api/admin/users/${id}`, { cookie: adminCookie, body: { status: "suspended" } }), { id });
    expect(susp.status).toBe(200);
    expect(susp.body.data.user.status).toBe("suspended");

    // the suspended user's live session is invalidated, and a fresh login is blocked with a clear reason
    expect((await invoke(session, req("GET", "/api/auth/session", { cookie: userCookie }))).status).toBe(401);
    const blocked = await loginAs("susp@x.io", "supersecret");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("ACCOUNT_SUSPENDED");

    // reactivate → login works again
    const react = await invoke(adminUserPatch, req("PATCH", `/api/admin/users/${id}`, { cookie: adminCookie, body: { status: "active" } }), { id });
    expect(react.status).toBe(200);
    expect((await loginAs("susp@x.io", "supersecret")).status).toBe(200);

    // a (non-system) admin cannot suspend themselves
    const boss = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Boss", email: "boss@x.io", password: "supersecret" } }));
    const bossId = boss.body.data.user.id;
    await invoke(adminUserPatch, req("PATCH", `/api/admin/users/${bossId}`, { cookie: adminCookie, body: { role: "admin" } }), { id: bossId });
    const bossLogin = await loginAs("boss@x.io", "supersecret");
    const selfSusp = await invoke(adminUserPatch, req("PATCH", `/api/admin/users/${bossId}`, { cookie: bossLogin.cookie!, body: { status: "suspended" } }), { id: bossId });
    expect(selfSusp.status).toBe(400);
    expect(selfSusp.body.error.code).toBe("CANNOT_SUSPEND_SELF");

    // the fixed admin system account cannot be suspended at all
    const sysSusp = await invoke(adminUserPatch, req("PATCH", `/api/admin/users/${adminId}`, { cookie: adminCookie, body: { status: "suspended" } }), { id: adminId });
    expect(sysSusp.status).toBe(400);
    expect(sysSusp.body.error.code).toBe("CANNOT_MODIFY_SYSTEM");
  });
});
