import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { setupTestDb, req, invoke } from "./helpers/harness";
import { getDb } from "@/lib/server/db/client";
import { users, sessions } from "@/lib/server/db/schema";

import { GET as start } from "@/app/api/auth/google/route";
import { GET as callback } from "@/app/api/auth/google/callback/route";
import { GET as providers } from "@/app/api/auth/providers/route";

/**
 * Google OAuth (Sign in with Google) — start route, callback find-or-create, CSRF/state,
 * and the providers gate. The Google token exchange is stubbed at the fetch boundary;
 * everything else (state cookie signing, id_token decode, user creation, session mint)
 * runs for real against an isolated temp DB.
 */

const CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";

/** A Google id_token is `header.payload.sig`; we decode the payload without verifying the sig. */
function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

function googleClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: "google-sub-123",
    email: "newperson@gmail.com",
    email_verified: true,
    name: "New Person",
    picture: "https://lh3.googleusercontent.com/a/pic",
    aud: CLIENT_ID,
    iss: "https://accounts.google.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...over,
  };
}

/** Decode the {state, verifier, nonce, iat} payload from the (signed) omni_oauth cookie pair. */
function decodeOauthCookie(pair: string): { state: string; nonce: string } {
  const value = pair.slice(pair.indexOf("=") + 1);
  const body = value.slice(0, value.lastIndexOf("."));
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

/** Mock the Google token endpoint to return an id_token carrying `claims`. */
function stubTokenExchange(claims: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id_token: fakeIdToken(claims), access_token: "at", token_type: "Bearer" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** Begin the flow and capture the issued state + nonce + signed oauth cookie pair. */
async function begin(): Promise<{ state: string; nonce: string; oauthPair: string }> {
  const s = await invoke(start, req("GET", "/api/auth/google"));
  expect(s.status).toBe(302);
  const loc = s.res.headers.get("location")!;
  const state = new URL(loc).searchParams.get("state")!;
  const setCookie = s.res.headers.get("set-cookie")!;
  const oauthPair = setCookie.split(";")[0]; // omni_oauth=<value>
  expect(oauthPair.startsWith("omni_oauth=")).toBe(true);
  const { nonce } = decodeOauthCookie(oauthPair);
  expect(nonce).toBeTruthy();
  return { state, nonce, oauthPair };
}

beforeAll(async () => {
  await setupTestDb();
  process.env.APP_SECRET = "test-app-secret-for-oauth-state";
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/auth/providers", () => {
  it("reports google enabled when configured", async () => {
    const r = await invoke(providers, req("GET", "/api/auth/providers"));
    expect(r.status).toBe(200);
    expect(r.body.data.providers.google).toBe(true);
    expect(r.body.data.providers.github).toBe(false);
  });
});

describe("GET /api/auth/google (start)", () => {
  it("302-redirects to Google with state + PKCE and sets a signed oauth cookie", async () => {
    const r = await invoke(start, req("GET", "/api/auth/google"));
    expect(r.status).toBe(302);
    const loc = new URL(r.res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(loc.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("scope")).toContain("openid");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("code_challenge")).toBeTruthy();
    expect(loc.searchParams.get("state")).toBeTruthy();
    expect(loc.searchParams.get("nonce")).toBeTruthy();
    expect(loc.searchParams.get("redirect_uri")).toContain("/api/auth/google/callback");
    const setCookie = r.res.headers.get("set-cookie") || "";
    expect(setCookie).toContain("omni_oauth=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("bounces to /login?sso_error=not_configured when OAuth env is absent", async () => {
    const id = process.env.GOOGLE_CLIENT_ID;
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      const r = await invoke(start, req("GET", "/api/auth/google"));
      expect(r.status).toBe(302);
      expect(r.res.headers.get("location")).toBe("/login?sso_error=not_configured");
    } finally {
      process.env.GOOGLE_CLIENT_ID = id;
      process.env.GOOGLE_CLIENT_SECRET = secret;
    }
  });
});

describe("GET /api/auth/google/callback", () => {
  it("creates a new account from a verified Google identity and mints a session", async () => {
    const { state, nonce, oauthPair } = await begin();
    stubTokenExchange(googleClaims({ email: "alice@gmail.com", sub: "sub-alice", nonce }));

    const r = await invoke(
      callback,
      req("GET", `/api/auth/google/callback?code=authcode&state=${state}`, { cookie: oauthPair }),
    );

    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/");
    expect(r.cookie).toMatch(/^omni_session=/); // session cookie set

    const { db } = await getDb();
    const rows = await db.select().from(users).where(eq(users.email, "alice@gmail.com")).limit(1);
    expect(rows[0]).toBeTruthy();
    expect(rows[0].oauthProvider).toBe("google");
    expect(rows[0].googleSub).toBe("sub-alice");
    expect(rows[0].passwordHash).toBe(""); // OAuth-only account
    expect(rows[0].planId).toBe("free");
    expect(rows[0].avatarUrl).toContain("googleusercontent.com");

    // The minted session resolves to that user.
    const sess = await db.select().from(sessions).where(eq(sessions.userId, rows[0].id)).limit(1);
    expect(sess[0]).toBeTruthy();
  });

  it("refuses to auto-merge into a pre-existing PASSWORD account (no takeover)", async () => {
    const { db } = await getDb();
    const userId = randomUUID();
    const now = Date.now();
    await db.insert(users).values({
      id: userId,
      email: "bob@gmail.com",
      name: "Bob",
      passwordHash: "deadbeef", // a real password account
      salt: "abc",
      planId: "pro",
      role: "user",
      createdAt: now,
      updatedAt: now,
    });

    const { state, nonce, oauthPair } = await begin();
    stubTokenExchange(googleClaims({ email: "bob@gmail.com", sub: "sub-bob", nonce }));
    const r = await invoke(
      callback,
      req("GET", `/api/auth/google/callback?code=authcode&state=${state}`, { cookie: oauthPair }),
    );

    // No session is minted; the user is told to sign in with their password first.
    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/login?sso_error=use_password");
    expect(r.cookie).toBeNull();

    const rows = await db.select().from(users).where(eq(users.email, "bob@gmail.com"));
    expect(rows.length).toBe(1);
    expect(rows[0].googleSub).toBeNull(); // NOT linked
    expect(rows[0].passwordHash).toBe("deadbeef"); // untouched
  });

  it("logs in a credential-less account already linked to the same Google sub", async () => {
    const { db } = await getDb();
    const userId = randomUUID();
    const now = Date.now();
    await db.insert(users).values({
      id: userId,
      email: "carol@gmail.com",
      name: "Carol",
      passwordHash: "", // SSO-only account
      salt: "",
      planId: "free",
      role: "user",
      oauthProvider: "google",
      googleSub: "sub-carol",
      createdAt: now,
      updatedAt: now,
    });

    const { state, nonce, oauthPair } = await begin();
    stubTokenExchange(googleClaims({ email: "carol@gmail.com", sub: "sub-carol", nonce }));
    const r = await invoke(
      callback,
      req("GET", `/api/auth/google/callback?code=authcode&state=${state}`, { cookie: oauthPair }),
    );

    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/");
    expect(r.cookie).toMatch(/^omni_session=/);
    const rows = await db.select().from(users).where(eq(users.email, "carol@gmail.com"));
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(userId);
  });

  it("rejects a DIFFERENT Google sub for an already-linked email (recycled-address guard)", async () => {
    const { db } = await getDb();
    const userId = randomUUID();
    const now = Date.now();
    await db.insert(users).values({
      id: userId,
      email: "dave@workspace.example",
      name: "Dave",
      passwordHash: "",
      salt: "",
      planId: "free",
      role: "user",
      oauthProvider: "google",
      googleSub: "sub-dave-original",
      createdAt: now,
      updatedAt: now,
    });

    const { state, nonce, oauthPair } = await begin();
    stubTokenExchange(googleClaims({ email: "dave@workspace.example", sub: "sub-dave-IMPOSTOR", nonce }));
    const r = await invoke(
      callback,
      req("GET", `/api/auth/google/callback?code=authcode&state=${state}`, { cookie: oauthPair }),
    );

    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/login?sso_error=account_conflict");
    expect(r.cookie).toBeNull();
    const rows = await db.select().from(users).where(eq(users.email, "dave@workspace.example"));
    expect(rows[0].googleSub).toBe("sub-dave-original"); // unchanged
  });

  it("rejects an id_token whose nonce does not match the request (replay/injection guard)", async () => {
    const { state, oauthPair } = await begin();
    stubTokenExchange(googleClaims({ email: "mallory@gmail.com", nonce: "a-different-nonce" }));
    const r = await invoke(
      callback,
      req("GET", `/api/auth/google/callback?code=authcode&state=${state}`, { cookie: oauthPair }),
    );
    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/login?sso_error=exchange");
    const { db } = await getDb();
    const rows = await db.select().from(users).where(eq(users.email, "mallory@gmail.com"));
    expect(rows.length).toBe(0);
  });

  it("rejects a forged/mismatched state (CSRF) and clears the oauth cookie", async () => {
    const { oauthPair } = await begin();
    const r = await invoke(
      callback,
      req("GET", `/api/auth/google/callback?code=authcode&state=not-the-real-state`, { cookie: oauthPair }),
    );
    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/login?sso_error=state");
    expect(r.res.headers.get("set-cookie") || "").toContain("omni_oauth=;");
  });

  it("refuses when there is no oauth state cookie at all", async () => {
    const r = await invoke(callback, req("GET", `/api/auth/google/callback?code=x&state=y`));
    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/login?sso_error=state");
  });

  it("refuses an unverified Google email", async () => {
    const { state, nonce, oauthPair } = await begin();
    stubTokenExchange(googleClaims({ email: "spoof@gmail.com", email_verified: false, nonce }));
    const r = await invoke(
      callback,
      req("GET", `/api/auth/google/callback?code=authcode&state=${state}`, { cookie: oauthPair }),
    );
    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/login?sso_error=unverified");

    const { db } = await getDb();
    const rows = await db.select().from(users).where(eq(users.email, "spoof@gmail.com"));
    expect(rows.length).toBe(0); // never created
  });

  it("redirects to sso_error=denied when Google returns ?error", async () => {
    const { oauthPair } = await begin();
    const r = await invoke(
      callback,
      req("GET", `/api/auth/google/callback?error=access_denied`, { cookie: oauthPair }),
    );
    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/login?sso_error=denied");
  });

  it("rejects an id_token whose audience is not our client id", async () => {
    const { state, nonce, oauthPair } = await begin();
    stubTokenExchange(googleClaims({ email: "evil@gmail.com", aud: "someone-elses-client-id", nonce }));
    const r = await invoke(
      callback,
      req("GET", `/api/auth/google/callback?code=authcode&state=${state}`, { cookie: oauthPair }),
    );
    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/login?sso_error=exchange");
    const { db } = await getDb();
    const rows = await db.select().from(users).where(eq(users.email, "evil@gmail.com"));
    expect(rows.length).toBe(0);
  });
});
