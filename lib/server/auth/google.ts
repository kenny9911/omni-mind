import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Google "Sign in with Google" — OAuth 2.0 Authorization Code flow with PKCE.
 *
 * Trust model: the id_token is fetched server-to-server from Google's token endpoint
 * over TLS, authenticated by our client_secret + PKCE verifier. Per OpenID Connect
 * §3.1.3.7, a code-flow client MAY skip id_token signature verification when the token
 * is obtained directly from the token endpoint. We still validate aud/iss/exp and
 * require email_verified as defense-in-depth.
 *
 * CSRF + PKCE are carried in a short-lived, HMAC-signed, HttpOnly cookie (omni_oauth)
 * issued by the start route and consumed by the callback — no server-side store needed.
 * Configuration is gated by googleConfigured(); the feature stays dark until both
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
 */

const STATE_TTL_SEC = 600; // 10 minutes to complete the round-trip
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const VALID_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

/** True only when both client id and secret are configured. */
export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function appSecret(): string {
  return process.env.APP_SECRET || "dev-only-insecure-secret-change-me";
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Cookie name. In production we use the `__Host-` prefix (browser-enforced: requires Secure
 * + Path=/ + no Domain — all satisfied here), which blocks same-site/subdomain cookie
 * injection. Dev keeps the plain name because `__Host-` requires Secure, which we drop locally.
 */
function stateCookieName(): string {
  return isProd() ? "__Host-omni_oauth" : "omni_oauth";
}

// ---- PKCE ------------------------------------------------------------------

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** A random opaque token, used for both `state` (CSRF) and `nonce` (id_token binding). */
export function createToken(): string {
  return randomBytes(16).toString("base64url");
}

// ---- Signed state cookie (carries {state, verifier, nonce}) ----------------

export interface OAuthState {
  state: string; // CSRF token echoed back as ?state
  verifier: string; // PKCE code_verifier
  nonce: string; // bound into the id_token (OIDC) and re-checked on the way back
  iat: number; // epoch-ms, for freshness
}

function sign(body: string): string {
  return createHmac("sha256", appSecret()).update(body).digest("base64url");
}

export function buildStateCookie(payload: OAuthState): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const value = `${body}.${sign(body)}`;
  const secure = isProd() ? "; Secure" : "";
  return `${stateCookieName()}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${STATE_TTL_SEC}${secure}`;
}

export function clearStateCookie(): string {
  const secure = isProd() ? "; Secure" : "";
  return `${stateCookieName()}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

/** Read + verify (HMAC + freshness) the oauth state cookie; null if absent/tampered/stale. */
export function readStateCookie(req: Request): OAuthState | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const name = stateCookieName();
  let raw: string | null = null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      raw = v.join("=");
      break;
    }
  }
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (!payload || typeof payload.state !== "string" || typeof payload.verifier !== "string") return null;
    if (typeof payload.nonce !== "string") return null;
    if (typeof payload.iat !== "number" || Date.now() - payload.iat > STATE_TTL_SEC * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- Authorize URL + redirect URI ------------------------------------------

/**
 * The redirect URI must EXACTLY match one registered in the Google Cloud console.
 * Precedence: explicit GOOGLE_REDIRECT_URI → APP_URL origin → the request origin.
 */
export function resolveRedirectUri(req: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const base = process.env.APP_URL || new URL(req.url).origin;
  return new URL("/api/auth/google/callback", base).toString();
}

export function buildAuthUrl(opts: { redirectUri: string; state: string; challenge: string; nonce: string }): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---- Token exchange + id_token decode --------------------------------------

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

interface IdTokenClaims {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  nonce?: string;
}

function decodeIdToken(jwt: string): IdTokenClaims {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new Error("malformed id_token");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as IdTokenClaims;
}

/**
 * Exchange the authorization code for tokens and return the verified Google identity.
 * Throws on any failure (network, bad code, claim mismatch) — callers map to a redirect.
 */
export async function fetchGoogleIdentity(
  code: string,
  verifier: string,
  redirectUri: string,
  nonce: string,
): Promise<GoogleIdentity> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`google token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const tok = (await res.json()) as { id_token?: string };
  if (!tok.id_token) throw new Error("google token response missing id_token");

  const claims = decodeIdToken(tok.id_token);
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error("id_token aud mismatch");
  if (!VALID_ISSUERS.has(String(claims.iss))) throw new Error("id_token iss mismatch");
  // `exp` is REQUIRED per OIDC — a missing/non-numeric exp must fail, not skip the check.
  if (typeof claims.exp !== "number") throw new Error("id_token missing exp");
  if (claims.exp * 1000 < Date.now() - 60_000) throw new Error("id_token expired"); // 60s skew
  // Bind the id_token to THIS authorization request (defeats id_token replay/injection).
  if (claims.nonce !== nonce) throw new Error("id_token nonce mismatch");
  if (!claims.sub || !claims.email) throw new Error("id_token missing sub/email");

  return {
    sub: String(claims.sub),
    email: String(claims.email),
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: claims.name ? String(claims.name) : null,
    picture: claims.picture ? String(claims.picture) : null,
  };
}
