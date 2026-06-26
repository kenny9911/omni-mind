# OmniMind Backend — Implementation Guide

How the OmniMind backend is built and run. The **source of truth is the code**
(`app/api/**`, `lib/server/**`); this guide explains how the pieces fit together, how a
request flows end to end, how the LLM layer switches between a keyless deterministic mock
and the real Vercel AI Gateway, and how to run it locally.

Stack: **Next.js 16 Route Handlers** · **libSQL / Drizzle ORM** · **Vercel AI SDK**
(`ai` v6) with a deterministic mock · **Zod** contracts · **Vitest** tests.

Conventions, everywhere:

- **Response envelope** — success `{ ok: true, data }`, failure `{ ok: false, error: { code, message, details? } }`.
- **`x-request-id`** — a UUID is set on **every** response (success, 4xx, 5xx, and SSE).
- **Money** — integer **micro-CNY** (`1 ¥ = 1_000_000 micro`); `¥ = micro / 1e6`. No floats in storage or math.
- **Time** — epoch-ms integers (UTC).
- **IDs** — UUID strings. **Booleans** — SQLite `INTEGER 0|1`. **JSON columns** — `TEXT` (`JSON.stringify`).

---

## 1. Module map — `lib/server/**`

The foundation is a small set of single-responsibility modules. Route handlers stay thin
and compose these.

### Database — `lib/server/db/`

| File | Role |
|---|---|
| `schema.ts` | Drizzle table definitions (the authoritative data model). Exports row types (`User`, `Conversation`, `Turn`, `UsageRecord`, …). |
| `ddl.ts` | The idempotent `CREATE TABLE IF NOT EXISTS` + index DDL string applied at startup. |
| `client.ts` | libSQL client + Drizzle binding. `getDb()` is a process-global, lazily-initialised, auto-migrating accessor used by every handler; `createDb(url)` builds an isolated bundle (used by tests); `ensureSchema()` runs the DDL; `__resetDbForTests()` drops the memoised instance. |
| `migrate.ts` | Standalone runner behind `npm run db:migrate` — opens a client and applies `ensureSchema`. |
| `seed.ts` | `seedNewUser()` provisions a fresh account on signup (preferences, 12 enabled `model_state` rows, a Pro subscription with ¥150 credit, demo invoices + payment method, and coherent demo usage history so Usage/Billing/Recents render immediately). |

The schema is **self-migrating**: `getDb()` calls `ensureSchema()` once per process, so a
running dev server or a fresh test DB always has the current tables. `db:migrate` is the
explicit, standalone equivalent.

### Auth — `lib/server/auth/`

| File | Role |
|---|---|
| `password.ts` | `scrypt` hashing with a per-user salt (`N=16384, r=8, p=1`, 64-byte key); `verifyPassword` is constant-time (`timingSafeEqual`). |
| `session.ts` | Opaque 32-byte session tokens in the `omni_session` HttpOnly/SameSite=Lax cookie (7-day TTL, 30 days with *remember*). `resolveSession()` maps cookie → `User`, lazily GCing expired rows; `createSession`/`destroySession`/`sweepExpiredSessions` round it out. |
| `guard.ts` | `requireUser(ctx)`, `requireAdmin(ctx)`, and `assertOwner(row, userId)` — ownership failures surface as `404 NOT_FOUND` (no existence leak). |

### HTTP plumbing — `lib/server/http.ts`, `sse.ts`, `util.ts`

- **`http.ts`** — the heart of the request lifecycle. `route(action, handler, { auth })`
  wraps a handler with: request-id generation, DB acquisition, session resolution + the
  `auth` guard (`public | required | admin`), error→envelope mapping, latency timing, and
  exactly one `activity_logs` row per served request (including 4xx/5xx). `ApiError(status,
  code, message?, details?)` is the throwable mapped to the failure envelope. `json(data,
  init)` builds the success envelope. `parseBody`/`parseQuery` validate against a Zod schema,
  throwing `400 VALIDATION_ERROR` with `z.flatten()` details.
- **`sse.ts`** — `sseResponse(requestId, run)` turns an async producer into a
  `text/event-stream` Response: an `emit(event, data)` helper, a `: ping` heartbeat every
  ~15 s, and an `AbortController` that fires on client disconnect so in-flight model work
  is cancelled mid-stream.
- **`util.ts`** — small shared helpers: `colorFor(id)` (deterministic accent), `truncate`,
  `currentMonthRange` (billing month), `windowRange` (`7d|30d|all` → epoch range).

### LLM layer — `lib/server/llm/`

This is the model-orchestration core. **Nothing outside this directory calls a provider.**

| File | Role |
|---|---|
| `registry.ts` | Server-authoritative model catalog. Re-exports the shared `MODELS`/`MODEL_MAP`/`PRICE_MAP` (single source of truth with the client), plus server-only mappings: `DEFAULT_TRIO`, `DEFAULT_MAIN_MODEL`, `isKnownModel`, and `gatewaySlug(id)` (internal id → `provider/model` string for gateway mode). |
| `router.ts` | Intent router — a verbatim port of the prototype's regex-ordered classifier. `route(prompt, lang, enabled)` picks a model by intent (code → DeepSeek, writing → Claude, translation → Qwen, …), returns a localized `routeText`, and falls back by tier (`flagship → balanced → fast`) when the chosen model is disabled. |
| `gateway.ts` | The single low-level call boundary. `streamOne(args)` streams one model call via `onDelta` and returns text + output tokens + status. In **mock** mode it pulls deterministic content from `mock.ts`; in **gateway** mode it calls the AI SDK `streamText({ model: gatewaySlug(id) })`. Honours an `AbortSignal` and the test-only `MOCK_FAIL_MODELS` fault injector. |
| `mock.ts` | The deterministic, keyless content engine behind `LLM_MODE=mock`. `mockText(role, …)` reuses the **exact** frontend content engine (`buildAnswer`/`buildReason`/`buildFusion`) so analytics/token values are byte-identical to the prototype. `streamChunks` paces output as deltas (`MOCK_STREAM_DELAY_MS=0` streams in big chunks for fast tests). `tok(s)` estimates tokens. |
| `fusion.ts` | The turn orchestrator. `runTurn(db, cfg, emit)` drives both modes end to end: **fast** = one (optionally auto-routed) `single` call; **expert** = three concurrent `expert` calls → a fusion `reason` trace → a consolidated `answer`, with the `mainModel` acting as the compiler. It emits the full SSE event sequence, persists one `usage_records` row per **billed** call, writes the assistant message, flips the turn status (`done | partial | failed`), and returns a rollup. |
| `cost.ts` | Cost accounting in **integer micro-CNY**. `billCall(usage, modelId)` returns `costMicro` (input × in-price + (output + reasoning) × out-price, prices are ¥/1M tokens so the result is exact micro) plus the per-call `platformFeeMicro`. `PLATFORM_FEE_MICRO()` derives the fee from `PLATFORM_FEE_CNY`. Helpers: `microToCny`, `cnyToMicro`, `formatMicro`. Reasoning tokens are billed at the output price. |

**Billing rules enforced in `fusion.ts`:** failed or client-aborted calls are **not**
billed at `status:"ok"` + fee; an all-experts-fail turn emits `ALL_EXPERTS_FAILED` and bills
no fusion; a mid-stream disconnect marks the turn `partial` and skips the truncated call's
bill. `deepResearch`/`deepAgents` each add real input-token overhead (`+600` / `+400`) so the
toggles have an observable, billed effect.

### Usage & billing — `lib/server/usage/`, `lib/server/billing/`

| File | Role |
|---|---|
| `usage/aggregate.ts` | The single source of truth for analytics & billing math. `summary`, `trend` (zero-filled daily buckets), `byModel` (cost-desc share), `ledger` (per-turn drill-down, cursor-paginated), and `monthTotal` (current calendar month). All sums are over integer micro-CNY, so an aggregate total **exactly** equals the sum of the per-call `usage_records`. |
| `billing/plans.ts` | The plan catalog (`free`/`pro`/`team`/`ent`) with prices and included credit in micro-CNY, plus localized feature bullets mirroring the frontend plan cards. `ent` requires sales (custom pricing). |

### Logging — `lib/server/log/`

| File | Role |
|---|---|
| `log/activity.ts` | The two DB-backed observability sinks: `writeActivity` (one `activity_logs` row **per request**, written by `http.ts`) and `writeUsage` (one `usage_records` row **per billed model call**, written by `fusion.ts`). Logging never breaks a request — failures are swallowed and line-logged. |
| `log/logger.ts` | A minimal structured JSON line-logger to stdout (`LOG_LEVEL`-gated), so logs are queryable in Vercel/observability tooling. |

### Contracts — `lib/server/contracts/`

One Zod module per domain (`auth`, `chat`, `chat-helpers`, `conversations`, `models`,
`preferences`, `usage`, `billing`, `activity`, `common`). Every request body and query
string is validated by a schema here before a handler touches the DB; failures become
`400 VALIDATION_ERROR` with `z.flatten()` details. `chat-helpers.ts` additionally holds
shared logic: `resolveSettings` (merge request overrides over saved preferences),
`enabledSetFor` (the user's enabled model set), and `hasStreamingTurn` (single-flight guard).

---

## 2. Request lifecycle

Every handler is `export const METHOD = route("action", async (ctx) => …, { auth })`. The
wrapper in `http.ts` does the same work for all 30 handlers:

1. **Request-id** — generate a UUID; it lands in `x-request-id` on the response and in every log line.
2. **DB** — `getDb()` (memoised; runs `ensureSchema` on first call of the process).
3. **Auth** — `resolveSession(db, req)` reads the `omni_session` cookie → `User | null`.
   `auth:"required"` throws `401 AUTH_REQUIRED` when absent; `auth:"admin"` additionally
   requires `role === "admin"` (else `403 FORBIDDEN`); `auth:"public"` skips the check.
4. **Handler** — runs with a typed `RouteCtx` (`req`, `requestId`, `db`, `user`, `params`,
   `url`, `now`, `setMeta`). It returns either a `Response` (e.g. an SSE stream or a file
   download) or a plain object, which is wrapped in the success envelope by `json()`.
5. **Error mapping** — any throw is caught: `ApiError` → its `{status, code, message, details}`;
   a `ZodError` → `400 VALIDATION_ERROR`; anything else → `500 INTERNAL` (logged with stack).
6. **Activity log** — exactly one `activity_logs` row is written for the served request
   (action, route, method, status, latency, `meta` enriched via `ctx.setMeta`), **including**
   4xx/5xx responses.
7. **Response** — `x-request-id` is attached and returned.

### Streaming requests

`POST /api/chat` and `POST /api/chat/regenerate` return an SSE stream via `sseResponse`.
The handler validates, resolves/creates the conversation, enforces single-flight
(`409 STREAM_IN_PROGRESS` if a turn is already streaming), runs mode-specific guards
(`MODEL_NOT_AVAILABLE` / `INVALID_TRIO` / `COMPILER_UNAVAILABLE`), persists the `turn`
+ user `message` **before** streaming, then hands control to `runTurn`. The turn's
`mainModel`/`trio`/`auto`/`deep*` settings are **captured on the turn row at send time** so
*regenerate* replays the original turn faithfully — not the user's current preferences.

The SSE event vocabulary (emitted by `fusion.ts`):

```
turn.start → [route] → call.start → call.delta* → call.usage
           → [reason.start → reason.delta* → reason.done → answer.delta*]   (expert only)
           → turn.usage → turn.done
```

- **Fast (auto):** `turn.start → route → call.start → call.delta* → call.usage → turn.usage → turn.done`.
- **Fast (manual):** same, without `route`. The single answer streams via `call.delta` (`role:"single"`), not `answer.delta`.
- **Expert:** three concurrent experts (`call.start`/`call.delta*`/`call.usage`), then the fusion `reason`/`answer` trace, then `turn.usage`/`turn.done`.
- A failed expert emits `call.error` and is dropped from fusion; a fatal fast error or an all-experts-fail emits a terminal `error` event and closes the stream.

---

## 3. LLM modes — mock vs. gateway

The whole backend runs against either of two interchangeable LLM backends, selected by
`LLM_MODE`. Only `lib/server/llm/gateway.ts` knows the difference; every handler is
identical across modes.

### `LLM_MODE=mock` (default) — keyless & deterministic

- `streamOne` routes to `mock.ts`, which calls the **exact same content engine the frontend
  prototype uses** (`buildAnswer`/`buildReason`/`buildFusion`). Output, token counts, and
  therefore every cost figure are **deterministic and byte-identical** to the prototype.
- **No API keys, no network.** This is the default for development, tests, and CI, which is
  what makes the project clone-and-run with zero setup.
- Streaming pace is tunable: `MOCK_STREAM_CPS` (chars/sec) and `MOCK_STREAM_DELAY_MS`
  (per-chunk delay; `0` streams in large chunks so the suite runs in ~1.3 s).
- `MOCK_FAIL_MODELS="id1,id2"` is a test-only fault injector that forces those model calls to
  error — used to exercise the degraded-expert / all-fail / failed-fast billing paths.

### `LLM_MODE=gateway` — real models via the Vercel AI Gateway

- `streamOne` calls the AI SDK `streamText({ model: gatewaySlug(id), prompt, abortSignal })`,
  mapping each internal id (`deepseek-pro`, `gpt-55`, `claude-opus`, …) to a
  `provider/model` slug in `registry.ts`. Output tokens come from the gateway's usage report
  when available, falling back to the estimator.
- Requires `AI_GATEWAY_API_KEY`. In gateway mode the model library surfaces
  `503 GATEWAY_UNAVAILABLE` and SSO surfaces `503 SSO_UNAVAILABLE` when their dependencies
  aren't configured — the mock path never hits these.
- Cost accounting, persistence, the SSE protocol, and every contract are **unchanged** — only
  where the tokens come from differs.

---

## 4. Data model summary

libSQL / SQLite, all times epoch-ms, all money integer micro-CNY. Defined in
`lib/server/db/schema.ts`.

| Table | Purpose | Notable columns |
|---|---|---|
| `users` | Accounts | `email` (unique, normalised), `passwordHash`+`salt` (scrypt; `''` for SSO-only), `planId`, `role` (`user|admin`). |
| `sessions` | Opaque session tokens | `id` (token), `userId`, `expiresAt`. |
| `preferences` | One row per user | `theme`, `lang`, `mode`, `auto`, `mainModel`, `trioJson`, `deepResearch`, `deepAgents`, `platformFeeDisplayMicro`. |
| `model_state` | Per-user model enable/disable | PK `(userId, modelId)`, `enabled`. |
| `conversations` | Chat threads | `title`, `color`, indexed by `(userId, updatedAt)`. |
| `turns` | One user prompt + its run | `mode`, `promptText`, `routeText`, **`mainModel`/`trioJson`/`auto` captured at send time** (for faithful regenerate), `deepResearch`/`deepAgents`, `status` (`streaming|done|failed|partial`). |
| `messages` | Rendered messages | `role` (`user|assistant`), `payloadJson`, `seq` (0=user, 1=assistant). |
| `usage_records` | **One row per billed model call** | `modelId`, `role` (`single|expert|fusion`), in/out/reasoning tokens, `costMicro`, `platformFeeMicro`, `latencyMs`, `status`. Retained on conversation delete (no FK on `userId`). |
| `activity_logs` | **One row per request** | `action`, `route`, `method`, `status`, `latencyMs`, `metaJson`. |
| `subscriptions` | Billing state | `planId`, `includedCreditMicro`, `creditBalanceMicro`, `status`, period bounds. |
| `invoices` | Invoice history | `kind` (`subscription|topup|overage`), `amountMicro`, `lineItemsJson`. |
| `payment_methods` | One masked card per user | `brand`, `last4`, `expMonth`, `expYear`. |

The two ledgers are the analytics backbone: `usage_records` (per call) rolls up exactly into
the aggregates in `usage/aggregate.ts`, and `activity_logs` (per request) feeds the activity
query and admin metrics.

---

## 5. Environment setup — `.env.example`

Copy `.env.example` → `.env` (or `.env.local`). The defaults run the full app keyless in mock
mode.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./.data/omnimind.db` | libSQL/SQLite location. Set a Turso/remote URL in prod. |
| `DATABASE_AUTH_TOKEN` | _(unset)_ | Auth token for a remote libSQL (Turso) DB. |
| `LLM_MODE` | `mock` | `mock` (deterministic, keyless) or `gateway` (real models). |
| `AI_GATEWAY_API_KEY` | _(unset)_ | Required **only** when `LLM_MODE=gateway`. |
| `PLATFORM_FEE_CNY` | `0.05` | Platform fee per model call, in CNY. Single-sourced into `PLATFORM_FEE_MICRO()` and reported everywhere. |
| `APP_SECRET` | dev placeholder | App/session secret — set a long random value in real envs. |

Tunables not in `.env.example` (sensible defaults): `MOCK_STREAM_CPS`,
`MOCK_STREAM_DELAY_MS`, `MOCK_FAIL_MODELS` (test-only), `LOG_LEVEL`.

---

## 6. Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server. |
| `npm run build` | Production build. |
| `npm run start` | Run the production build. |
| `npm run db:migrate` | Apply the idempotent schema (`tsx lib/server/db/migrate.ts`). Safe to run repeatedly. |
| `npm run db:generate` | Generate Drizzle artifacts (`drizzle-kit`). |
| `npm run test` | Run the Vitest suite once (194 tests). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run lint` | Lint. |

Note: the schema auto-migrates on first DB access, so `db:migrate` is rarely required for
local dev — it's the explicit hook for CI/prod provisioning.

---

## 7. Running locally — quickstart

```bash
# 1. Install
npm install

# 2. Configure (defaults are keyless mock mode)
cp .env.example .env

# 3. (Optional) provision the schema explicitly; otherwise it auto-migrates on first request
npm run db:migrate

# 4. Run
npm run dev          # → http://localhost:3000

# 5. Verify the suite is green (194 tests, ~1.3s)
npm run test
```

**Keyless by default.** With `LLM_MODE=mock` (the default) there are **no API keys to set and
no network calls** — `streamOne` serves deterministic content from the same engine the
prototype uses, so chat, streaming, token counts, cost math, usage analytics, and billing all
work end to end out of the box. Sign up (`POST /api/auth/signup`) and a full demo account is
seeded (preferences, enabled models, a Pro subscription with ¥150 credit, invoices, and
coherent usage history), so the Usage, Billing, and Recents views render immediately.

**Going live.** To exercise real models, set `LLM_MODE=gateway` and `AI_GATEWAY_API_KEY`,
then map any new internal model ids to gateway slugs in `lib/server/llm/registry.ts`.
Nothing else changes — contracts, the SSE protocol, persistence, and cost accounting are
mode-agnostic.
