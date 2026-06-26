# Decision: Backend Tech Stack & Conventions (FROZEN)

**Status:** Accepted · **Date:** 2026-06-18

This is the **single source of truth** for the backend stack. Every agent/workflow MUST
follow it so the codebase stays coherent.

## Stack

| Concern        | Choice |
|----------------|--------|
| Runtime/API    | **Next.js 16 App Router Route Handlers** (`app/api/**`), Node.js runtime (Fluid-Compute compatible). Same repo as the frontend. |
| Language       | **TypeScript** (strict), **zod** for all request/response validation & shared contracts. |
| Database       | **Drizzle ORM** over **PostgreSQL** (`pg` / node-postgres via `drizzle-orm/node-postgres`). Any compatible Postgres: Neon, Supabase, RDS, or self-hosted. `DATABASE_URL` (a `postgres://` connection string) is required. |
| Auth           | Session-based: password hashing with **node:crypto scrypt**, opaque **DB-backed sessions** in an httpOnly, SameSite=Lax cookie. |
| LLM            | **Vercel AI SDK v6** (`ai`) via **AI Gateway** (`"provider/model"`), wrapped by `lib/server/llm/`. Deterministic **mock** mode for keyless runs. See [llm-sdk-evaluation.md](llm-sdk-evaluation.md). |
| Logging        | Custom structured logger → stdout (JSON) **and** DB tables `activity_logs`, `usage_records`. Captures user activity, tokens, cost, latency on every call & request. |
| Testing        | **Vitest** (unit + integration via direct Route-Handler invocation against an in-process PostgreSQL via `@electric-sql/pglite`) + **Playwright** (e2e against `next dev`). |
| IDs / time     | `crypto.randomUUID()` for ids; store timestamps as epoch-ms integers (UTC). |
| Money          | Currency **CNY (¥)**. Store costs as **micro-cents (integer)** to avoid float drift; format at the edge. |

## Directory layout (backend)

```
app/api/
  auth/{signup,login,logout,session}/route.ts
  chat/route.ts                # POST: create turn (fast|expert), returns SSE stream
  conversations/...            # CRUD + history
  models/route.ts              # list; PATCH enable / set-main
  usage/route.ts               # aggregates, trend, ledger
  billing/{subscription,invoices,plans,topup}/route.ts
  activity/route.ts            # activity log query
lib/server/
  db/{client.ts,schema.ts,migrate.ts}
  contracts/                   # zod schemas shared with the client
  auth/{password.ts,session.ts,guard.ts}
  llm/{gateway.ts,registry.ts,router.ts,fusion.ts,mock.ts,cost.ts}
  log/{logger.ts,activity.ts}  # structured logs + DB activity/usage writers
  usage/{ledger.ts,aggregate.ts}
  billing/{plans.ts,subscription.ts}
  http.ts                      # json(), error envelope, request-id, timing wrapper
lib/client/api.ts              # typed fetch client used by the React app
```

## Conventions

- **Every API response** uses an envelope: `{ ok: true, data } | { ok: false, error: { code, message, details? } }`.
- **Every request** is wrapped by a handler that: assigns a `requestId`, authenticates (where
  required), validates with zod, times execution, and writes an `activity_logs` row with
  `{ requestId, userId, action, route, status, latencyMs, ... }`.
- **Every model call** writes a `usage_records` row: `{ requestId, conversationId, turnId,
  modelId, role(expert|fusion|single), inputTokens, outputTokens, reasoningTokens,
  costMicro, platformFeeMicro, latencyMs }`.
- Pricing/tiers/colors for the 12 models come from a single server registry that mirrors the
  client `lib/models.ts` (keep them in sync; the registry is authoritative server-side).
- The platform fee is **¥0.05 per model call** (configurable via `PLATFORM_FEE_CNY`).
- No secrets in the repo. Env via `.env.local` (gitignored) and documented in `.env.example`.

## Environment variables

The table below is the authoritative list of env vars **actually read by code**. The
"Read at" column points to the read site so the doc cannot drift from behaviour.

| Var | Default (if unset) | Read at | Purpose |
|-----|--------------------|---------|---------|
| `DATABASE_URL` | _(none — **required**)_ | `lib/server/db/client.ts` | PostgreSQL connection string (`postgres://…`). Required; there is no local/file fallback. Pooler params (`pgbouncer`/`connection_limit`/`pool_timeout`) are parsed and ignored safely. |
| `LLM_MODE` | `mock` | `lib/server/llm/gateway.ts`, `app/api/models/route.ts`, `app/api/auth/sso/route.ts` | `mock` = deterministic keyless provider; `gateway` = real models via the Vercel AI Gateway. |
| `AI_GATEWAY_API_KEY` | _(unset)_ | `app/api/models/route.ts` (gateway readiness) | Vercel AI Gateway key; only consulted when `LLM_MODE=gateway`. |
| `PLATFORM_FEE_CNY` | `0.05` | `lib/server/llm/cost.ts` | Per-call platform fee in ¥; converted to `PLATFORM_FEE_MICRO = round(× 1e6)` (default `50000`). |
| `MOCK_STREAM_CPS` | `900` | `lib/server/llm/mock.ts` | Mock streaming speed in characters/second. |
| `MOCK_STREAM_DELAY_MS` | `8` | `lib/server/llm/mock.ts` | Per-chunk delay (ms) in the mock streamer. |
| `MOCK_FAIL_MODELS` | _(unset)_ | `lib/server/llm/gateway.ts` | Comma-separated model ids forced to error — used to test provider-failure paths. |
| `SEED_DEMO` | _(unset)_ | `lib/server/db/seed.ts` | When `=1`, seeds extra demo data on new-user creation. |
| `LOG_LEVEL` | `info` | `lib/server/log/logger.ts` | Minimum structured-log level emitted to stdout. |
| `APP_SECRET` | `dev-only-insecure-secret-change-me` (from `.env.example`) | _declared only_ | Intended app/session secret. Present in `.env.example` but **not yet read by code** — sessions are opaque DB-backed ids, so no signing secret is consumed today. Set a long random value once it is wired. |
| `NODE_ENV` | _(framework-managed)_ | `lib/server/auth/session.ts` (cookie `Secure` flag), build tooling | Standard Node/Next environment flag; gates the `Secure` cookie attribute in production. |

**Not wired (do not rely on):**

- `SESSION_TTL_MS` — **not read.** Session lifetimes are hard-coded in
  `lib/server/auth/session.ts`: `DEFAULT_TTL_MS = 7d`, `REMEMBER_TTL_MS = 30d`. Adding this
  override would require code changes.
- `SEED_PLAN` — **not read.** New users are always created on `planId: "pro"` in
  `app/api/auth/signup/route.ts`. There is no env override for the seeded plan.
