import { route } from "@/lib/server/http";
import {
  googleConfigured,
  createToken,
  createPkce,
  buildStateCookie,
  buildAuthUrl,
  resolveRedirectUri,
} from "@/lib/server/auth/google";

/** 302 redirect, optionally setting a cookie. */
function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/**
 * GET /api/auth/google — begin Sign in with Google.
 * Issues PKCE + state in a signed, short-lived cookie and 302-redirects the browser to
 * Google's consent screen. A top-level navigation (the Google button does
 * window.location = '/api/auth/google'), so a redirect — not JSON — is the response.
 * If OAuth isn't configured, bounces back to /login with a friendly error code.
 */
export const GET = route(
  "auth.google.start",
  async (ctx) => {
    if (!googleConfigured()) {
      ctx.setMeta({ configured: false });
      return redirect("/login?sso_error=not_configured");
    }
    // Already signed in → straight to the app.
    if (ctx.user) return redirect("/");

    const state = createToken();
    const nonce = createToken();
    const { verifier, challenge } = createPkce();
    const redirectUri = resolveRedirectUri(ctx.req);
    const cookie = buildStateCookie({ state, verifier, nonce, iat: ctx.now });
    ctx.setMeta({ configured: true });
    return redirect(buildAuthUrl({ redirectUri, state, challenge, nonce }), cookie);
  },
  { auth: "public" },
);
