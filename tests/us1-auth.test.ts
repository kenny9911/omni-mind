import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { setupTestDb, req, invoke } from "./helpers/harness";
import { getDb } from "@/lib/server/db/client";
import { sessions } from "@/lib/server/db/schema";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as sso } from "@/app/api/auth/sso/route";

/**
 * US1 — Account & Authentication.
 * Tests the real route handlers against the documented contract in
 * docs/technical-design.md §2.1 + §5 and the US1 acceptance criteria.
 */

beforeAll(async () => {
  await setupTestDb();
});

// ---------------------------------------------------------------------------
// US1.UC1 — Sign up with email & password
// ---------------------------------------------------------------------------
describe("US1.UC1: signup with email & password", () => {
  it("creates a user, sets an httpOnly SameSite=Lax cookie, seeds plan + preferences", async () => {
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", {
        body: { name: "Ada", email: "ada@omnimind.dev", password: "supersecret" },
      }),
    );

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    // user DTO never exposes password/salt
    expect(r.body.data.user).toEqual({
      id: expect.any(String),
      name: "Ada",
      email: "ada@omnimind.dev",
    });
    expect((r.body.data.user as any).passwordHash).toBeUndefined();
    expect((r.body.data.user as any).salt).toBeUndefined();

    // plan seeded (default Free)
    expect(r.body.data.plan).toBe("free");

    // preferences seeded with FR-40 defaults
    const p = r.body.data.preferences;
    expect(p.theme).toBe("dark");
    expect(p.mode).toBe("expert");
    expect(p.auto).toBe(true);
    expect(p.mainModel).toBe("gpt-55");
    expect(p.trio).toEqual(["deepseek-pro", "gpt-55", "claude-opus"]);
    expect(p.lang).toBeDefined();
    expect(p.platformFeePerCallMicro).toBe(50000);

    // session cookie set + correct attributes
    expect(r.cookie).toBeTruthy();
    expect(r.setCookie).toMatch(/^omni_session=/);
    expect(r.setCookie!).toMatch(/HttpOnly/i);
    expect(r.setCookie!).toMatch(/SameSite=Lax/i);
    expect(r.setCookie!).toMatch(/Path=\//);
  });

  it("normalizes email (lowercase) before storing", async () => {
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", {
        body: { name: "Case", email: "MixedCase@Omni.DEV", password: "supersecret" },
      }),
    );
    expect(r.status).toBe(200);
    expect(r.body.data.user.email).toBe("mixedcase@omni.dev");
  });

  it("returns 409 AUTH_EMAIL_TAKEN on duplicate email and creates no second user", async () => {
    const body = { name: "Bo", email: "dupe@omnimind.dev", password: "supersecret" };
    const first = await invoke(signup, req("POST", "/api/auth/signup", { body }));
    expect(first.status).toBe(200);

    const second = await invoke(signup, req("POST", "/api/auth/signup", { body }));
    expect(second.status).toBe(409);
    expect(second.body.ok).toBe(false);
    expect(second.body.error!.code).toBe("AUTH_EMAIL_TAKEN");
    expect(second.setCookie).toBeNull();
  });

  it("returns 400 VALIDATION_ERROR with password field detail for a short (<8) password", async () => {
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", {
        body: { name: "Shorty", email: "shorty@omnimind.dev", password: "abc123" },
      }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error!.code).toBe("VALIDATION_ERROR");
    expect((r.body.error!.details as any).fieldErrors.password).toBeDefined();
  });

  it("returns 400 VALIDATION_ERROR with email field detail for an invalid email", async () => {
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", {
        body: { name: "NoMail", email: "not-an-email", password: "supersecret" },
      }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error!.code).toBe("VALIDATION_ERROR");
    expect((r.body.error!.details as any).fieldErrors.email).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// US1.UC2 — Log in with existing credentials
// ---------------------------------------------------------------------------
describe("US1.UC2: login with existing credentials", () => {
  const creds = { name: "Lina", email: "lina@omnimind.dev", password: "correcthorse" };

  beforeAll(async () => {
    await invoke(signup, req("POST", "/api/auth/signup", { body: creds }));
  });

  it("logs in with correct credentials and sets a fresh session cookie", async () => {
    const r = await invoke(
      login,
      req("POST", "/api/auth/login", { body: { email: creds.email, password: creds.password } }),
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.user.email).toBe(creds.email);
    expect(r.body.data.plan).toBe("free");
    expect(r.cookie).toBeTruthy();
    expect(r.setCookie!).toMatch(/HttpOnly/i);
  });

  it("normalizes email on login (uppercase input resolves the same user)", async () => {
    const r = await invoke(
      login,
      req("POST", "/api/auth/login", {
        body: { email: "LINA@OMNIMIND.DEV", password: creds.password },
      }),
    );
    expect(r.status).toBe(200);
    expect(r.body.data.user.email).toBe(creds.email);
  });

  it("returns 401 AUTH_INVALID with an identical message for wrong password vs unknown email", async () => {
    const wrongPw = await invoke(
      login,
      req("POST", "/api/auth/login", { body: { email: creds.email, password: "WRONGpass" } }),
    );
    const unknownEmail = await invoke(
      login,
      req("POST", "/api/auth/login", { body: { email: "ghost@omnimind.dev", password: "WRONGpass" } }),
    );

    expect(wrongPw.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPw.body.error!.code).toBe("AUTH_INVALID");
    expect(unknownEmail.body.error!.code).toBe("AUTH_INVALID");
    // No enumeration signal: identical message, and no session created in either case.
    expect(wrongPw.body.error!.message).toBe(unknownEmail.body.error!.message);
    expect(wrongPw.setCookie).toBeNull();
    expect(unknownEmail.setCookie).toBeNull();
  });

  it("returns 400 VALIDATION_ERROR for a malformed body (missing fields)", async () => {
    const r = await invoke(login, req("POST", "/api/auth/login", { body: { email: "x@y.z" } }));
    expect(r.status).toBe(400);
    expect(r.body.error!.code).toBe("VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------
// US1.UC3 — Resolve current session (/me)
// ---------------------------------------------------------------------------
describe("US1.UC3: resolve current session", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", {
        body: { name: "Mo", email: "mo@omnimind.dev", password: "supersecret" },
      }),
    );
    cookie = r.cookie!;
    userId = r.body.data.user.id;
  });

  it("returns 200 with user, plan, and preferences for a valid cookie", async () => {
    const r = await invoke(session, req("GET", "/api/auth/session", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.user.email).toBe("mo@omnimind.dev");
    expect(r.body.data.user.role).toBe("user"); // session DTO includes role
    expect(r.body.data.plan).toBe("free");
    expect(r.body.data.preferences.mainModel).toBe("gpt-55");
  });

  it("returns 401 AUTH_REQUIRED when no session cookie is present", async () => {
    const r = await invoke(session, req("GET", "/api/auth/session"));
    expect(r.status).toBe(401);
    expect(r.body.ok).toBe(false);
    expect(r.body.error!.code).toBe("AUTH_REQUIRED");
  });

  it("returns 401 for an unknown/garbage session token", async () => {
    const r = await invoke(
      session,
      req("GET", "/api/auth/session", { cookie: "omni_session=deadbeefnope" }),
    );
    expect(r.status).toBe(401);
    expect(r.body.error!.code).toBe("AUTH_REQUIRED");
  });

  it("returns 401 for an expired session and lazily deletes the expired row", async () => {
    const { db } = await getDb();
    const expiredId = randomBytes(32).toString("hex");
    const now = Date.now();
    await db.insert(sessions).values({
      id: expiredId,
      userId,
      expiresAt: now - 1000, // already expired
      createdAt: now - 10_000,
      userAgent: null,
    });

    const r = await invoke(
      session,
      req("GET", "/api/auth/session", { cookie: `omni_session=${expiredId}` }),
    );
    expect(r.status).toBe(401);
    expect(r.body.error!.code).toBe("AUTH_REQUIRED");

    // lazy GC: the expired session row is removed on read
    const rows = await db.select().from(sessions).where(eq(sessions.id, expiredId)).limit(1);
    expect(rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// US1.UC4 — Log out
// ---------------------------------------------------------------------------
describe("US1.UC4: log out", () => {
  it("deletes the session, clears the cookie, and a later session check returns 401", async () => {
    const su = await invoke(
      signup,
      req("POST", "/api/auth/signup", {
        body: { name: "Out", email: "out@omnimind.dev", password: "supersecret" },
      }),
    );
    const cookie = su.cookie!;

    const r = await invoke(logout, req("POST", "/api/auth/logout", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.loggedOut).toBe(true);
    // cookie cleared (Max-Age=0)
    expect(r.setCookie!).toMatch(/Max-Age=0/);

    const after = await invoke(session, req("GET", "/api/auth/session", { cookie }));
    expect(after.status).toBe(401);
    expect(after.body.error!.code).toBe("AUTH_REQUIRED");
  });

  it("is idempotent: logout with no session still returns 200", async () => {
    const r = await invoke(logout, req("POST", "/api/auth/logout"));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.loggedOut).toBe(true);
  });

  it("only affects the session that logged out (other devices stay logged in)", async () => {
    const creds = { email: "multi@omnimind.dev", password: "supersecret" };
    await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Multi", ...creds } }));

    const devA = await invoke(login, req("POST", "/api/auth/login", { body: creds }));
    const devB = await invoke(login, req("POST", "/api/auth/login", { body: creds }));
    expect(devA.cookie).toBeTruthy();
    expect(devB.cookie).toBeTruthy();
    expect(devA.cookie).not.toBe(devB.cookie);

    // Log out device A only.
    await invoke(logout, req("POST", "/api/auth/logout", { cookie: devA.cookie! }));

    const aAfter = await invoke(session, req("GET", "/api/auth/session", { cookie: devA.cookie! }));
    const bAfter = await invoke(session, req("GET", "/api/auth/session", { cookie: devB.cookie! }));
    expect(aAfter.status).toBe(401);
    expect(bAfter.status).toBe(200);
    expect(bAfter.body.data.user.email).toBe(creds.email);
  });
});

// ---------------------------------------------------------------------------
// US1.UC5 — SSO sign-in (stub) & input validation gate
// ---------------------------------------------------------------------------
describe("US1.UC5: SSO unavailable & validation gate", () => {
  it("returns 503 SSO_NOT_CONFIGURED for a valid provider and NEVER creates an account", async () => {
    const r = await invoke(sso, req("POST", "/api/auth/sso", { body: { provider: "google" } }));
    expect(r.status).toBe(503);
    expect(r.body.ok).toBe(false);
    expect(r.body.error!.code).toBe("SSO_NOT_CONFIGURED");
    expect(r.cookie ?? null).toBeNull(); // no session, no fake account
  });

  it("returns 400 VALIDATION_ERROR for a provider outside the allowlist", async () => {
    const r = await invoke(sso, req("POST", "/api/auth/sso", { body: { provider: "myspace" } }));
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error!.code).toBe("VALIDATION_ERROR");
    expect(r.setCookie).toBeNull();
  });
});
