import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { route } from "@/lib/server/http";
import { createSession } from "@/lib/server/auth/session";
import { seedNewUser } from "@/lib/server/db/seed";
import { users } from "@/lib/server/db/schema";
import { normalizeEmail, resolveLang } from "@/lib/server/contracts/auth";
import {
  googleConfigured,
  readStateCookie,
  clearStateCookie,
  resolveRedirectUri,
  fetchGoogleIdentity,
} from "@/lib/server/auth/google";

/** 302 redirect, setting any number of cookies. */
function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

/** Failure path: clear the oauth state cookie and bounce to /login with a code. */
function loginError(code: string): Response {
  return redirect(`/login?sso_error=${code}`, [clearStateCookie()]);
}

/**
 * GET /api/auth/google/callback — Google redirects here with ?code & ?state.
 * Validates state (CSRF) against the signed cookie, exchanges the code for the
 * verified identity, then find-or-creates the account by verified email and mints a
 * session — mirroring signup. All expected failures redirect to /login?sso_error=…;
 * the session cookie + state-cookie clear ride along on the success redirect to /.
 */
export const GET = route(
  "auth.google.callback",
  async (ctx) => {
    if (!googleConfigured()) return redirect("/login?sso_error=not_configured");

    const params = ctx.url.searchParams;

    // The user denied consent (or Google returned an error). Truncate the attacker-controlled
    // value before it lands in activity_logs.
    const oauthErr = params.get("error");
    if (oauthErr) {
      ctx.setMeta({ oauthError: String(oauthErr).slice(0, 64) });
      return loginError("denied");
    }

    const code = params.get("code");
    const state = params.get("state");
    const saved = readStateCookie(ctx.req);
    // Missing/forged/expired state, or a mismatch, is a CSRF failure — refuse.
    if (!code || !state || !saved || state !== saved.state) {
      ctx.setMeta({ stateOk: false });
      return loginError("state");
    }

    let identity;
    try {
      identity = await fetchGoogleIdentity(code, saved.verifier, resolveRedirectUri(ctx.req), saved.nonce);
    } catch (e) {
      ctx.setMeta({ exchangeError: String((e as Error)?.message || e).slice(0, 120) });
      return loginError("exchange");
    }

    // Only trust a Google-verified email (prevents linking to an address the user doesn't own).
    if (!identity.emailVerified) {
      ctx.setMeta({ emailVerified: false });
      return loginError("unverified");
    }

    const email = normalizeEmail(identity.email);
    const now = ctx.now;

    const existing = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
    let userId: string;

    if (existing[0]) {
      const u = existing[0];
      userId = u.id;
      if (u.status === "suspended") return loginError("suspended");

      if (u.googleSub) {
        // Already linked to a Google identity — it MUST be the same subject. A different sub
        // for the same email (e.g. a recycled Workspace address) is rejected, not auto-merged.
        if (u.googleSub !== identity.sub) {
          ctx.setMeta({ outcome: "sub_mismatch", userId });
          return loginError("account_conflict");
        }
        // Linked + matching: opportunistically backfill the avatar only.
        if (!u.avatarUrl && identity.picture) {
          await ctx.db.update(users).set({ avatarUrl: identity.picture, updatedAt: now }).where(eq(users.id, userId));
        }
      } else if (u.passwordHash) {
        // A pre-existing PASSWORD account that isn't linked yet. Do NOT silently merge an SSO
        // identity into it — that would let anyone holding a Google-verified token for this
        // address take it over. Require a password login first (linking is a deliberate act).
        ctx.setMeta({ outcome: "needs_password_link", userId });
        return loginError("use_password");
      } else {
        // Credential-less, unlinked row → safe to link this Google identity now.
        await ctx.db
          .update(users)
          .set({ oauthProvider: "google", googleSub: identity.sub, avatarUrl: u.avatarUrl || identity.picture, updatedAt: now })
          .where(eq(users.id, userId));
      }
      ctx.setMeta({ outcome: "login", userId });
    } else {
      // New account — same shape as signup (empty password, free plan), plus OAuth identity.
      userId = randomUUID();
      const lang = resolveLang(undefined, ctx.req);
      const name = identity.name || email.split("@")[0];
      try {
        await ctx.db.insert(users).values({
          id: userId,
          email,
          name,
          passwordHash: "",
          salt: "",
          planId: "free",
          role: "user",
          oauthProvider: "google",
          googleSub: identity.sub,
          avatarUrl: identity.picture,
          createdAt: now,
          updatedAt: now,
        });
      } catch (e) {
        // Concurrent first sign-in raced us to the unique email/google_sub index. Re-resolve by
        // email and fall through to a normal login rather than 500-ing.
        ctx.setMeta({ insertRace: String((e as Error)?.message || e).slice(0, 80) });
        const again = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!again[0] || (again[0].googleSub && again[0].googleSub !== identity.sub)) return loginError("exchange");
        if (again[0].status === "suspended") return loginError("suspended");
        userId = again[0].id;
        ctx.setMeta({ outcome: "login_raced", userId });
        const { cookie } = await createSession(ctx.db, userId, true, ctx.req.headers.get("user-agent"));
        return redirect("/", [cookie, clearStateCookie()]);
      }
      await seedNewUser(ctx.db, userId, { lang });
      ctx.setMeta({ outcome: "signup", userId });
    }

    // OAuth logins get a 30-day session (remember=true).
    const { cookie } = await createSession(ctx.db, userId, true, ctx.req.headers.get("user-agent"));
    return redirect("/", [cookie, clearStateCookie()]);
  },
  { auth: "public" },
);
