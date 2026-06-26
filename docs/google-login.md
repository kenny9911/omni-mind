# Sign in with Google (OAuth 2.0 + PKCE)

OmniMind supports real "Sign in with Google" alongside email/password. It uses the OAuth 2.0
**Authorization Code flow with PKCE**, a signed CSRF/state cookie, and find-or-create by
verified email. The feature is **dark until configured** — the Google button shows a clear
"not configured" message until both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.

## Setup

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an
   **OAuth client ID** of type **Web application**.
2. Add an **Authorized redirect URI** that EXACTLY matches your callback:
   - Local dev: `http://localhost:3439/api/auth/google/callback`
   - Production: `https://your-domain.com/api/auth/google/callback`
3. Put the credentials in `.env.local` (never commit them):
   ```
   GOOGLE_CLIENT_ID="…apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="…"
   # Optional — otherwise derived from the request origin / APP_URL:
   # GOOGLE_REDIRECT_URI="https://your-domain.com/api/auth/google/callback"
   # APP_URL="https://your-domain.com"
   APP_SECRET="<a long random value>"   # signs the OAuth state cookie + sessions
   ```
4. **Restart** the dev/prod server so the new env is loaded. The additive DB migration
   (`oauth_provider`, `google_sub`, `avatar_url`) runs automatically on boot.

## Flow

```
Browser                    /api/auth/google            Google                /api/auth/google/callback
   │  click "Google"  ─────────▶  (GET, start)
   │                              • mint state + PKCE verifier
   │                              • Set-Cookie omni_oauth (signed, HttpOnly, 10 min)
   │  302 to Google  ◀───────────  302 + cookie
   │  ─────────────────────────────────────────▶ consent
   │  302 back with ?code&state ◀───────────────
   │  ─────────────────────────────────────────────────────────────────▶  (GET, callback)
   │                                                                       • verify state == cookie (CSRF)
   │                                                                       • exchange code (+secret +verifier)
   │                                                                       • decode id_token, check aud/iss/exp
   │                                                                       • require email_verified
   │                                                                       • find-or-create user by email
   │                                                                       • mint omni_session (30 days)
   │  302 to /  ◀──────────────────────────────────────────────────────────  302 + session, clear omni_oauth
   │  bootstrap() reads omni_session → logged in
```

## Security model

This implementation was adversarially security-reviewed (6 lenses, per-finding verification);
the hardening below reflects the confirmed findings that were fixed.

- **CSRF / state**: a random `state` + PKCE `code_verifier` + `nonce` are stored in a
  short-lived (10 min), `HttpOnly`, `SameSite=Lax` cookie (`omni_oauth`, `__Host-`-prefixed in
  production) that is **HMAC-signed with `APP_SECRET`** and carries an `iat` for freshness. The
  callback recomputes the HMAC (constant-time compare) and requires the returned `state` to
  match. A forged, tampered, expired, or missing cookie is rejected → `/login?sso_error=state`.
- **PKCE (S256)**: `code_challenge = base64url(sha256(verifier))` is sent on the authorize
  request; the `verifier` is sent on the token exchange. Protects the code in transit.
- **OIDC nonce**: a per-request `nonce` is sent on the authorize request and required to match
  the id_token's `nonce` claim — binding the token to this exact request (defeats id_token
  replay/injection) → mismatch is rejected as `exchange`.
- **id_token trust**: the token is fetched server-to-server from Google's token endpoint over
  TLS, authenticated by `client_secret` + the PKCE verifier. Per OIDC §3.1.3.7 a code-flow
  client may skip id_token signature verification in this case; we still **require** `aud` (==
  our client id), `iss` (accounts.google.com), `exp` (mandatory + 60 s skew), and the nonce.
- **Verified email only**: account match/creation requires `email_verified === true`.
- **No password-account auto-merge** (account-takeover guard): if the email already belongs to a
  **password** account that isn't yet linked to Google, the callback refuses to mint a session
  and returns `/login?sso_error=use_password` — the user must sign in with their password first
  (linking is a deliberate, authenticated action). Only brand-new emails are auto-created, and
  only credential-less rows are auto-linked.
- **Stable-subject linkage**: once an account is linked, sign-in requires `id_token.sub` to
  equal the stored `google_sub`; a different sub for the same email (e.g. a recycled Workspace
  address) is rejected as `account_conflict`, never silently merged.
- **Suspended accounts** are blocked here too (`/login?sso_error=suspended`), consistent with
  password login; `resolveSession` also treats suspended as logged-out.
- **No open redirect**: the post-login redirect is always the fixed relative path `/`; error
  redirects are fixed `/login?sso_error=<code>` paths. No redirect target is derived from
  user input (the Google authorize URL is the hardcoded endpoint; `redirect_uri` is validated
  by Google's exact-match allowlist).
- **Concurrency-safe**: a unique-index race on first sign-in is caught and re-resolved to a
  clean login instead of a 500.
- **No secret/token leakage**: codes, tokens, the client secret, the PKCE verifier, and the
  nonce are never logged. `activity_logs` records only the outcome, a `userId`, and truncated,
  secret-free reasons (the attacker-controllable `?error` value is length-capped).

## Data model

New `users` columns (additive, nullable; null for password-only accounts):

| column           | meaning                                            |
| ---------------- | -------------------------------------------------- |
| `oauth_provider` | `'google'` for Google sign-in, else null           |
| `google_sub`     | Google's stable subject id (unique among non-null) |
| `avatar_url`     | provider profile picture URL                       |

A first Google sign-in for a pre-existing email **backfills** these columns (never overwrites
the password). A brand-new Google account is created exactly like a signup: empty password,
**Free** plan, seeded preferences/model-state/subscription.

## Endpoints

| method | path                         | purpose                                                |
| ------ | ---------------------------- | ------------------------------------------------------ |
| `GET`  | `/api/auth/google`           | start — 302 to Google (sets the signed state cookie)   |
| `GET`  | `/api/auth/google/callback`  | callback — validate, find-or-create, mint session      |
| `GET`  | `/api/auth/providers`        | which SSO providers are configured (gates the button)  |

## `sso_error` codes (shown on `/login`)

`not_configured`, `denied`, `state`, `exchange`, `unverified`, `use_password`,
`account_conflict`, `suspended` — each mapped to a localized message in `AuthScreen.tsx`.

## Tests

`tests/google-oauth.test.ts` (13 cases) covers: providers gate; start redirect + state/PKCE/
nonce params + signed cookie; not-configured bounce; new-account creation; **password-account
auto-merge refusal** (no takeover, account untouched); linked-account login on matching sub;
**different-sub rejection** (recycled-address guard); **nonce mismatch** rejection; CSRF state
mismatch; missing state cookie; unverified-email refusal; `?error=denied`; and `aud` mismatch.
The Google token exchange is stubbed at the `fetch` boundary; everything else runs for real.
