# Security & Data Integrity Review — OmniMind backend

Reviewer dimension: auth, authz/ownership scoping, input validation, error leakage,
injection surface, session lifecycle. Findings verified against the actual source,
not comments. File:line evidence is given for each.

## Summary

Counts by severity: **P0: 0 · P1: 4 · P2: 7**

The backend has a genuinely strong security posture for a prototype: a single
`route()` wrapper (`lib/server/http.ts`) centralizes the auth guard, zod validation,
error→envelope mapping, and per-request activity logging; ownership is consistently
enforced via `assertOwner()` returning `404` (no existence leak); all DB access goes
through Drizzle (fully parameterized — no raw SQL except the trusted DDL constant);
the IDOR-prone chat/regenerate paths re-check `turn.userId`/`conversation.userId`
server-side; admin endpoints are double-gated. No P0 blockers were found. The P1
findings are real but bounded (session fixation, login timing oracle, force-scope
inconsistency in export, unvalidated stored card field).

---

## P1 — Important

### P1-1. Session is not regenerated on login/SSO/signup (session fixation)

`createSession()` always mints a brand-new random id and the cookie is set fresh on
login (`app/api/auth/login/route.ts:22-32`), signup (`app/api/auth/signup/route.ts:55-68`)
and SSO (`app/api/auth/sso/route.ts:58-71`), so a *new* id is issued each time — that
part is fine. The gap is the **inverse**: there is no mechanism to invalidate a
pre-existing session for the same browser, and nothing rotates/forces a new cookie if
one is already present. More importantly, **no session is ever invalidated on password
context changes** because there is no password-change endpoint, and logout only deletes
the *current* session (`lib/server/auth/session.ts:69-72`). Combined with multi-device
"leave prior sessions valid" (technical-design §4.2), there is no "log out all devices"
/ global invalidation primitive. For a platform handling billing this is a real gap.

Recommendation: add a `sessions` bulk-delete by `userId` ("revoke all sessions") and
call it on any future password/credential change; document that login does not adopt a
caller-supplied session id (it does not — good), and add a test asserting a stale
cookie cannot be "promoted."

### P1-2. Login timing oracle enables user enumeration despite the no-enumeration claim

`app/api/auth/login/route.ts:18` short-circuits: `if (!user || !verifyPassword(...))`.
When the email is unknown, `user` is falsy and `verifyPassword` (and therefore the
expensive `scryptSync`, `lib/server/auth/password.ts:15`) **never runs**. A present
email with a wrong password runs full scrypt (N=16384). The response body/status are
identical (`401 AUTH_INVALID`), but the **latency differs by the scrypt cost** — a
classic timing side-channel that re-introduces the exact account enumeration the design
claims to prevent. `docs/technical-design.md:736-740` explicitly promises "equivalent
timing for unknown-email vs wrong-password (no enumeration)", so this is a
spec-violation, not just a hardening nit.

Recommendation: when `user` is null, run a dummy `verifyPassword` against a fixed
throwaway hash/salt (or `scryptSync` over a constant) before returning, so both paths
pay the same CPU cost. Add a coarse timing-parity assertion or at least a comment-backed
dummy-compare.

### P1-3. `GET /api/activity/export` returns every user's `userId` to non-admins is not the bug — but its force-scope is structurally inconsistent with `GET /api/activity`

`GET /api/activity` resolves scope with an explicit branch and **rejects** a non-admin
who passes `?userId=other` with `403` (`app/api/activity/route.ts:43-52`). The export
sibling does *not* accept/inspect `userId` at all and instead force-injects
`eq(...userId, user.id)` for non-admins (`app/api/activity/export/route.ts:31-33,43-44`).
Behaviorally the export is safe (non-admins only ever get their own rows), but the two
endpoints implement "force scoping" with **different shapes**, and the export's admin
branch applies **no `userId` filter and no `userId` query parameter** — an admin cannot
scope an export to one user, and there is no upper bound / row cap on the unfiltered
admin export (full-table dump of `activity_logs`/`usage_records` streamed). The asymmetry
is a maintenance hazard: a future edit that adds a `userId` param to export could easily
forget the non-admin guard that the query endpoint has.

Recommendation: factor the scope resolution into one shared helper used by both
`/activity` and `/activity/export`; honor `?userId` for admins on export; add a hard
`limit`/`from..to` requirement (or max row count) to bound the admin export.

### P1-4. `last4` and other card fields are stored without format validation

`PaymentMethodBody` validates `last4: z.string().length(4)`
(`lib/server/contracts/billing.ts:24`) — length only, **not digits**. A client may store
`last4: "<b>"` or `"';--"` etc. It is later rendered into a masked string
`"•••• " + body.last4` (`app/api/billing/payment-method/route.ts:38`) and returned to the
client/UI. `brand` is `z.string().trim().min(1)` (no allow-list), and `expYear` has no
upper bound (`z.number().int()`) so `expYear: 999999` is accepted. None of this is a
stored-XSS in the API itself (responses are JSON), but the un-sanitized `last4`/`brand`
flow straight into the frontend's billing view and is a stored-data-integrity defect.

Recommendation: `last4: z.string().regex(/^\d{4}$/)`, `brand` against an enum/allow-list,
and bound `expYear` (e.g. `.min(curYear).max(curYear+20)`).

---

## P2 — Nice-to-have / hardening

### P2-1. Copy-ping merges arbitrary client JSON into `activity_logs.meta` (log injection / storage bloat)

`app/api/activity/route.ts:24` spreads `...(body.meta ?? {})` — `body.meta` is
`z.record(z.string(), z.any())` (`lib/server/contracts/activity.ts:16`) — directly into
the persisted activity meta with no size/key/depth cap. A caller can write arbitrary,
unbounded JSON into their own log rows (and into the admin metrics action stream).
Low impact (own rows, JSON-encoded so no SQL/markup execution) but unbounded.

Recommendation: cap `meta` size/keys, or allow-list the keys you actually consume.

### P2-2. No rate limiting anywhere — login/signup/topup are unthrottled

There is no rate-limit primitive in `lib/server/**` (confirmed: no limiter, no counter
table). `POST /api/auth/login` can be brute-forced and `POST /api/billing/topup` /
`POST /api/auth/signup` can be hammered. Acceptable for a mock prototype but should be
called out as a pre-prod requirement. (NFR mentions exist in PRD; no implementation.)

Recommendation: add per-IP/per-account throttling on the auth and money endpoints
before any real deployment.

### P2-3. No CSRF token; reliance solely on `SameSite=Lax`

State-changing routes (logout, topup, change-plan, payment-method, preferences) are
cookie-authenticated with no CSRF token. `SameSite=Lax` (`lib/server/auth/session.ts:36`)
blocks cross-site POST cookies, which mitigates the common case, but Lax still permits
top-level GET navigations — none of the mutations are GET, so exposure is low. Worth an
explicit decision record rather than silence.

Recommendation: document the Lax-only stance; consider a double-submit token if any
mutation ever moves to GET or `SameSite=None` is needed.

### P2-4. SSE error frames can leak internal error text to the client

`lib/server/sse.ts:31-36` emits `err?.message || String(e)` on the `error` event.
For a controlled `ApiError` this is fine, but an *unexpected* throw inside `runTurn`
serializes the raw `Error.message` (and any embedded internals) to the client over the
stream — unlike the JSON path in `http.ts:62-63`, which deliberately collapses unknown
errors to a generic `"Internal error"`. Inconsistent leakage surface.

Recommendation: in the SSE catch, only forward `message` when `e instanceof ApiError`;
otherwise emit a generic message and log the detail server-side (mirror `toApiError`).

### P2-5. `resolveSession` does the GC delete then read inside the request path without a transaction; expired-session check is correct but not sliding

`lib/server/auth/session.ts:55-67` is correct (expired → delete row → null). Minor: the
delete-then-return is two awaited statements with no transaction; under concurrency a
just-expired session could be deleted twice (harmless). Also note there is no idle/sliding
expiration — sessions live to absolute `expiresAt` only, which is a reasonable choice but
means a 30-day "remember" cookie is valid for the full 30 days regardless of activity.

Recommendation: none required; optionally document the absolute-expiry decision.

### P2-6. `LoginBody.email` is unvalidated (`z.string()`); `normalizeEmail` lowercases but unique index is on stored value

`lib/server/contracts/auth.ts:19-23` — login accepts any string for `email` (correct,
since it only does an equality lookup), but combined with `normalizeEmail` (trim+lower)
at signup vs login, the security-relevant invariant (one account per normalized email) is
enforced only because both paths call `normalizeEmail`. The `ux_users_email` unique index
(`lib/server/db/schema.ts:22`) is on the raw stored column. This is fine today but fragile:
any future write path that inserts a non-normalized email would silently allow a duplicate
account differing only by case/whitespace.

Recommendation: enforce normalization at the schema/DB layer (e.g. store and index
`lower(email)`), or centralize all user inserts through one helper.

### P2-7. SSO mock auto-provisions a real session with no credential in default mode

`app/api/auth/sso/route.ts:17-71` — in the default `LLM_MODE=mock` deployment, anyone
calling `POST /api/auth/sso {provider}` gets a fully-authenticated session for a shared
deterministic account (`google.demo@omnimind.dev`, etc.) with `passwordHash=""`. This is
the documented demo stub (US1.UC5) and is correctly disabled in `gateway` mode (503), but
note the **shared demo accounts persist and accumulate real data** across anyone who hits
the endpoint, and they cannot be logged into via password (empty hash is rejected by
`verifyPassword`, `lib/server/auth/password.ts:14` — good). Flag only so a real deployment
doesn't ship with mock SSO enabled.

Recommendation: ensure prod sets `LLM_MODE=gateway` (or add an explicit `SSO_MODE` flag)
so the keyless auto-login cannot be reached in production.

---

## Genuine strengths (verified)

- **Ownership scoping is consistent and correct.** `assertOwner()`
  (`lib/server/auth/guard.ts:17-23`) returns `404 NOT_FOUND` for missing *or* not-owned
  rows — no existence enumeration. Applied uniformly across conversations
  (`app/api/conversations/[id]/route.ts:23,52`, `.../messages/route.ts:18`), invoices
  (`app/api/billing/invoices/[id]/route.ts:15`), and all usage/billing reads are scoped
  by `user.id` (verified each of `usage/{summary,by-model,trend,ledger,export}` and
  `billing/{invoices,plans,subscription,payment-method}`).
- **IDOR-prone chat paths are hardened.** `POST /api/chat` re-checks
  `conv.userId !== user.id → 404` (`app/api/chat/route.ts:58-60`); regenerate re-checks
  `turn.userId !== userId → 404` and the optional `conversationId` mismatch
  (`app/api/chat/regenerate/run.ts:36-41`).
- **Admin gating is double-enforced**: the `route()` wrapper rejects non-admins
  (`lib/server/http.ts:93-95`) and `requireAdmin()` re-checks in-handler
  (`app/api/admin/metrics/route.ts:23`).
- **Injection surface is essentially nil.** Every query uses Drizzle's parameterized
  builder; the only multi-statement execution is the static trusted `DDL` constant
  (`lib/server/db/client.ts:42`). CSV export escapes per RFC-4180
  (`lib/server/contracts/activity.ts:98-107`).
- **Password hashing is sound**: scrypt N=16384/r=8/p=1, 16-byte random salt, 64-byte key,
  constant-time `timingSafeEqual` with length guard, and empty-hash/salt rejection for
  SSO-only users (`lib/server/auth/password.ts:7-19`).
- **No secret leakage in logs.** DTO mappers never expose `passwordHash`/`salt`
  (`lib/server/contracts/auth.ts:37-49`); the structured logger and `writeActivity`
  log only ids/metadata, never the cookie value or password (grep-verified).
- **Cookie flags correct**: `HttpOnly; SameSite=Lax; Path=/` always, `Secure` in prod
  (`lib/server/auth/session.ts:34-42`); session id is 32 random bytes
  (`lib/server/auth/session.ts:21`).
- **Money/integrity**: `usage_records` are intentionally retained on conversation delete
  for billing integrity (`app/api/conversations/[id]/route.ts:40-66`), and topup amounts
  are bounded ¥1–¥1000 (`lib/server/contracts/billing.ts:17`).
