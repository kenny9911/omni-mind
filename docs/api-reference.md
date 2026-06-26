# OmniMind Backend — REST API Reference

**Generated from the code** (`app/api/**`, `lib/server/**`). Where the implementation
diverges from `docs/technical-design.md`, **the code is authoritative** and is documented here.

- **Runtime:** Next.js 16 Route Handlers (Node runtime), Drizzle ORM over libSQL, Vercel AI SDK
  with a deterministic `LLM_MODE=mock` provider (keyless).
- **Endpoints:** 30 handlers across 8 domains.

---

## Conventions

### Response envelope

Every JSON response is wrapped by `lib/server/http.ts` (`route()`):

```jsonc
// success
{ "ok": true, "data": { /* endpoint-specific */ } }

// failure
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "human-readable", "details": { /* optional */ } } }
```

- **`x-request-id`** (a `crypto.randomUUID()`) is set on **every** response — success, 4xx, 5xx,
  and SSE streams. The same id appears in the `activity_logs` row and in error events.
- **`details`** on a `VALIDATION_ERROR` is `ZodError.flatten()`.
- Streaming endpoints (`POST /api/chat`, `POST /api/chat/regenerate`) return
  `text/event-stream` rather than the JSON envelope, but still carry `x-request-id`.
- File-export endpoints return raw `text/csv` / `application/json` with a
  `Content-Disposition: attachment` header (not the envelope).

### Auth model

`route(action, handler, { auth })` runs before the handler body:

| `auth` | Meaning | Failure |
|---|---|---|
| `public` | No session needed. | — |
| `required` | Valid `omni_session` cookie. | `401 AUTH_REQUIRED` |
| `admin` | Valid session **and** `users.role = "admin"`. | `401 AUTH_REQUIRED` (no session) / `403 FORBIDDEN` (non-admin) |

Session is an opaque 32-byte hex id in cookie `omni_session` (`HttpOnly; SameSite=Lax; Path=/;
Max-Age=…; Secure` in prod). TTL = 7 days, or 30 days when `remember=true` on login. Expired
sessions are deleted lazily on lookup (`resolveSession`). Ownership is enforced per-row; a
resource not owned by the caller surfaces as `404 NOT_FOUND` (no existence leak).

### Activity logging

The wrapper writes **exactly one `activity_logs` row per request** (including 4xx/5xx), recording
the endpoint's stable `action`, route, method, HTTP status, latency, and a `meta` object. Each
endpoint's `action` is listed below. `usage_records` (the billing source of truth, one row per
model call) are written **only** by the chat/regenerate streaming runner (`lib/server/llm/fusion.ts`).

### Units

- **Money is integer micro-CNY**: `¥ = micro / 1_000_000`. Example: `¥0.05` fee = `50000`;
  `¥150` included credit = `150000000`; `¥199` invoice = `199000000`. Never floats.
- **Tokens** are integers. Mock mode derives counts from `estTok(s) = round(len / 1.8)`;
  `inputTokens = estTok(prompt) + 180` per call.
- **Cost engine** (`lib/server/llm/cost.ts`): `costMicro = round(inputTokens × pin) +
  round((outputTokens + reasoningTokens) × pout)`, where `pin`/`pout` are ¥ per 1M tokens
  (== micro-CNY per token). Plus `platformFeeMicro = PLATFORM_FEE_MICRO` (default `50000`,
  from `PLATFORM_FEE_CNY`) **per model call**. Unknown model → fallback price `{in:5, out:15}`
  and `meta.pricingFallback = true`. Reasoning tokens bill at the **output** rate.
- **Times** are `Date.now()` epoch-ms (UTC). Day/month buckets are computed at server-local midnight.

---

## Domain index

| Domain | Endpoints |
|---|---|
| [Auth & Session](#1-auth--session) | `signup`, `login`, `logout`, `session`, `sso` |
| [Chat, Streaming & Orchestration](#2-chat-streaming--orchestration) | `chat`, `chat/route`, `chat/regenerate`, `activity` (copy ping), `orchestration` |
| [Model Library](#3-model-library) | `models`, `models/:id` |
| [Usage & Cost Analytics](#4-usage--cost-analytics) | `usage`, `usage/summary`, `usage/trend`, `usage/by-model`, `usage/ledger`, `usage/export` |
| [Billing & Subscription](#5-billing--subscription) | `billing/subscription`, `billing/plans`, `billing/invoices`, `billing/invoices/:id`, `billing/topup`, `billing/payment-method` |
| [Conversations & History](#6-conversations--history) | `conversations`, `conversations/:id`, `conversations/:id/messages` |
| [Preferences & Localization](#7-preferences--localization) | `preferences` |
| [Activity & Admin](#8-activity--admin) | `activity`, `activity/export`, `admin/metrics` |

---

## 1. Auth & Session

### POST /api/auth/signup
- **Auth:** public · **Action:** `auth.signup`
- **Request body** (`SignupBody`):
  ```ts
  { name: z.string().min(1),
    email: z.string().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
    password: z.string().min(8),
    lang: z.enum(["zh","zh-TW","en","ja"]).optional() }
  ```
- **Side effects (one flow):** insert `users` (scrypt hash + salt, `plan_id="pro"`,
  `role="user"`); then `seedNewUser` inserts `preferences` (FR-40 defaults; `lang` from body or
  `Accept-Language`, default `zh`), **12 enabled `model_state` rows**, a `subscriptions` row
  (Pro → `includedCreditMicro = 150000000`), **3 trailing monthly Pro invoices** (`¥199` paid,
  `kind="subscription"`), and a demo `payment_methods` row (`visa •••• 4242`). Then a session
  cookie is opened. (Demo usage history is opt-in via `SEED_DEMO=1`.)
- **Success `data`** (`200`, + `Set-Cookie`):
  ```jsonc
  { "user": { "id": "...", "name": "...", "email": "..." },
    "plan": "pro",
    "preferences": { /* full PreferencesPayload — see §7 */ } }
  ```
- **Errors:** `409 AUTH_EMAIL_TAKEN` (duplicate, normalized email), `400 VALIDATION_ERROR`.

### POST /api/auth/login
- **Auth:** public · **Action:** `auth.login`
- **Request body** (`LoginBody`):
  ```ts
  { email: z.string(), password: z.string(), remember: z.boolean().default(false) }
  ```
- **Success `data`** (`200`, + `Set-Cookie`): `{ user: {id,name,email}, plan }`.
- **Errors:** `401 AUTH_INVALID` (identical message + constant-time work for unknown-email vs
  wrong-password — no user enumeration), `400 VALIDATION_ERROR`.

### POST /api/auth/logout
- **Auth:** public (idempotent) · **Action:** `auth.logout`
- **Request:** none.
- **Success `data`** (`200`, + cleared cookie): `{ loggedOut: true }`. Always `200`, even with no
  or an invalid session; deletes only the current session row.

### GET /api/auth/session
- **Auth:** required · **Action:** `auth.session`
- **Request:** none.
- **Success `data`**: `{ user: {id,name,email,role}, plan, preferences: { /* PreferencesPayload */ } }`.
- **Errors:** `401 AUTH_REQUIRED` (no/expired session — expired session row is deleted),
  `500 INTERNAL` (defensive: preferences row missing).

### POST /api/auth/sso
- **Auth:** public · **Action:** `auth.sso`
- **Request body** (`SsoBody`): `{ provider: z.enum(["google","github","wechat","apple"]) }`.
- **Behavior:** mock mode upserts a deterministic demo identity
  `email = "<provider>.demo@omnimind.dev"` (seeding a new user via `seedNewUser`), then opens a
  session. `meta.provider` is logged.
- **Success `data`** (`200`, + `Set-Cookie`): `{ user: {id,name,email}, plan, sso: { provider, stub: true } }`.
- **Errors:** `400 VALIDATION_ERROR`; `503 SSO_UNAVAILABLE` when `LLM_MODE=gateway` (real-OAuth
  mode, no provider configured).

#### Worked example — signup

Request:
```http
POST /api/auth/signup
Content-Type: application/json

{ "name": "Mei", "email": "Mei@Example.com", "password": "hunter2hunter", "lang": "zh" }
```

Response:
```http
HTTP/1.1 200 OK
content-type: application/json
x-request-id: 5f1c…-…-…
set-cookie: omni_session=ab12…; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800
```
```jsonc
{
  "ok": true,
  "data": {
    "user": { "id": "a1b2c3…", "name": "Mei", "email": "mei@example.com" },
    "plan": "pro",
    "preferences": {
      "theme": "dark", "lang": "zh", "mode": "expert", "auto": true,
      "mainModel": "gpt-55",
      "trio": ["deepseek-pro", "gpt-55", "claude-opus"],
      "deepResearch": false, "deepAgents": false,
      "platformFeePerCallMicro": 50000,
      "platformFeeDisplayMicro": 50000
    }
  }
}
```
Email is normalized (trim + lowercase). A duplicate returns:
```jsonc
{ "ok": false, "error": { "code": "AUTH_EMAIL_TAKEN", "message": "Email already registered" } }
```

---

## 2. Chat, Streaming & Orchestration

### POST /api/chat
- **Auth:** required · **Action:** `chat.send` (+ N `usage_records`). When `regenerateTurnId` is
  present this delegates to the regenerate runner (logged as `chat.send`, `meta.regenerate=true`).
- **Request body** (`ChatBody`, `lib/server/contracts/chat.ts`):
  ```ts
  z.object({
    conversationId: z.string().uuid().optional(),   // created implicitly if absent
    mode: z.enum(["fast","expert"]).optional(),     // falls back to preferences.mode
    prompt: z.string().trim().min(1).optional(),     // required unless regenerateTurnId set
    auto: z.boolean().optional(),                    // fast only; falls back to preferences.auto
    mainModel: z.string().optional(),               // falls back to preferences.main_model
    trio: z.array(z.string()).length(3).optional(),  // expert only; falls back to preferences.trio
    deepResearch: z.boolean().optional(),
    deepAgents: z.boolean().optional(),
    regenerateTurnId: z.string().uuid().optional(),  // alias for in-place regenerate
  })
  .refine(b => !(b.trio && new Set(b.trio).size !== 3))   // trio must be 3 distinct ids
  .refine(b => Boolean(b.regenerateTurnId) || Boolean(b.prompt))  // prompt required
  ```
- **Resolution & guards (before streaming):**
  1. Resolve effective settings = `preferences` merged with body overrides (body wins).
  2. If `conversationId` absent → create a conversation (title = first ~40 chars of prompt,
     deterministic `color`). If present but not owned → `404 NOT_FOUND`.
  3. Single-flight: if a turn with `status="streaming"` already exists in the conversation →
     `409 STREAM_IN_PROGRESS`.
  4. **Fast + manual** (`auto=false`): `mainModel` must be a known **and** enabled id, else
     `400 MODEL_NOT_AVAILABLE`. (Fast + auto skips this check — the router picks an enabled model.)
  5. **Expert:** `trio` must be 3 distinct, known, enabled ids else `400 INVALID_TRIO`; the
     compiler (`mainModel`) must be known + enabled else `409 COMPILER_UNAVAILABLE`.
  6. Insert `turns` (`status="streaming"`, capturing mode/prompt/mainModel/trio/auto/deep flags)
     + user message (`seq=0`); bump `conversations.updatedAt`. Then stream.
- **Success:** `200 text/event-stream` — see [§ SSE format](#sse-event-format). On `turn.done`
  the assistant message (`seq=1`) is persisted and `turns.status` flipped to `done`/`partial`/`failed`.
- **Errors (pre-stream, JSON envelope):** `400 VALIDATION_ERROR`, `404 NOT_FOUND`,
  `409 STREAM_IN_PROGRESS`, `400 MODEL_NOT_AVAILABLE`, `400 INVALID_TRIO`,
  `409 COMPILER_UNAVAILABLE`. Errors that arise mid-stream are delivered as an `error` SSE event
  (e.g. `PROVIDER_ERROR`, `ALL_EXPERTS_FAILED`).

### POST /api/chat/route
- **Auth:** required · **Action:** `chat.route` (**no** usage)
- **Request body** (`RouteBody`): `{ prompt: z.string().min(1), lang: z.enum(["zh","zh-TW","en","ja"]).optional() }`.
- **Behavior:** runs the enablement-aware intent router over the caller's enabled set (`lang` from
  body or preferences). Does **not** call a model or create a turn.
- **Success `data`**: `{ modelId, label, routeText, fallback }` — `fallback=true` when the matched
  model was disabled and a tier-ordered enabled substitute was chosen.
- **Errors:** `400 VALIDATION_ERROR`, `401 AUTH_REQUIRED`.

### POST /api/chat/regenerate
- **Auth:** required · **Action:** `chat.regenerate` (+ fresh `usage_records`)
- **Request body** (`RegenerateBody`): `{ conversationId: z.string(), turnId: z.string() }`.
  (Also reachable via `POST /api/chat { regenerateTurnId }`.)
- **Behavior:** re-runs an existing turn **in place** using the turn's **original** captured
  mode/prompt/mainModel/trio/auto/deep flags (not the user's current prefs; `lang` comes from
  prefs). Deletes the old assistant message (`seq=1`) + that turn's `usage_records`, resets the
  turn to `streaming`, bumps `conversations.updatedAt`, then streams.
- **Success:** `200 text/event-stream` (same event format), reusing the same `turnId`.
- **Errors:** `404 TURN_NOT_FOUND` (missing, not owned, or `conversationId` mismatch),
  `409 STREAM_IN_PROGRESS`, `409 COMPILER_UNAVAILABLE` (expert mode, compiler now disabled).

### POST /api/activity (copy ping)
- **Auth:** required · **Action:** `activity.ping` (the wrapper's fixed action; the client's
  `action` is surfaced into `meta`) · **no** usage
- **Request body** (`ActivityPingBody`):
  ```ts
  { action: z.enum(["chat.copy","result.copy"]),
    turnId: z.string().optional(),
    meta: z.record(z.string(), z.any()).optional() }
  ```
- **Success `data`**: `{ logged: true }`.
- **Errors:** `400 VALIDATION_ERROR`, `401 AUTH_REQUIRED`.

### PATCH /api/orchestration
- **Auth:** required · **Action:** `orchestration.set`
- **Request body** (`OrchestrationPatch`, strict — subset of preferences, FR-14):
  ```ts
  { mainModel: z.string().optional(),
    auto: z.boolean().optional(),
    trio: z.array(z.string()).length(3).optional(),
    mode: z.enum(["fast","expert"]).optional() }
  ```
- **Behavior:** validates `mainModel`/`trio` against the enabled set; setting `mainModel` implies
  `auto=false` unless `auto` is explicitly provided in the same patch. `meta.changed` lists the
  changed fields.
- **Success `data`**: the full `PreferencesPayload` (see §7).
- **Errors:** `400 VALIDATION_ERROR`, `400 MODEL_NOT_AVAILABLE` (unknown main), `409 MODEL_DISABLED`
  (disabled main), `400 INVALID_TRIO`.

### SSE event format

`POST /api/chat` and `POST /api/chat/regenerate` stream `text/event-stream; charset=utf-8`
(`cache-control: no-cache, no-transform`, `x-accel-buffering: no`, `x-request-id`). Each message
is an `event:` line + a JSON `data:` line. A heartbeat comment `: ping` is sent every ~15s. On
client disconnect the server aborts in-flight work; completed calls are billed and the turn is
marked `partial`.

Event payloads (from `lib/server/llm/fusion.ts`):

| Event | Modes | `data` fields |
|---|---|---|
| `turn.start` | all | `{ turnId, conversationId, mode, ts }` |
| `route` | fast + `auto` only | `{ modelId, label, routeText, fallback }` |
| `call.start` | all | `{ callId, modelId, role }` (+ `index` for experts) |
| `call.delta` | all | `{ callId, modelId, role, delta }` (+ `index` for experts) — incremental answer text |
| `call.usage` | all | `{ callId?, modelId, role, inputTokens, outputTokens, reasoningTokens, costMicro, platformFeeMicro, status }` (mirrors the `usage_records` row) |
| `call.error` | fast (fatal) / expert (degraded) | `{ callId, modelId, role, code: "PROVIDER_ERROR" }` (+ `index` for experts) |
| `reason.start` | expert only | `{ modelId }` (the compiler) |
| `reason.delta` | expert only | `{ delta }` — fusion reasoning trace |
| `reason.done` | expert only | `{ reasoningTokens }` |
| `answer.delta` | expert only | `{ delta }` — consolidated fusion answer |
| `turn.usage` | all | `{ turnTok, turnCostMicro, turnFeeMicro, turnTotalMicro, callCount }` |
| `turn.done` | all | `{ turnId, status, messageId }` — `status ∈ done|partial|failed` |
| `error` | fatal | `{ code, message, requestId }` — closes the stream |

Notes:
- **Fast** answer deltas are emitted on `call.delta` (role `single`), not `answer.delta`.
- **Expert** answer deltas are emitted on `answer.delta`; per-expert deltas use `call.delta`
  (role `expert`, with `index`).
- A failed expert emits `call.error`, is excluded from fusion, and is **not** billed; the turn is
  `partial`. If **every** expert fails → an `error` event with `code: "ALL_EXPERTS_FAILED"`, no
  fusion billed, turn `failed`.
- A fatal fast-mode error emits `call.error` then throws → the wrapper emits the typed `error`
  event with `code: "PROVIDER_ERROR"`.
- Deep Research / Deep Agents inflate per-call `inputTokens` (+600 / +400) so the toggles bill.

**Event sequence — Fast (auto):**
```
turn.start → route → call.start → call.delta* → call.usage → turn.usage → turn.done
```
Fast (manual) is identical **without** the `route` event.

**Event sequence — Expert (3 experts + fusion):**
```
turn.start
→ (×3 concurrent experts) call.start, call.delta*, call.usage
→ reason.start → reason.delta* → reason.done
→ answer.delta* → call.usage (role "fusion")
→ turn.usage → turn.done
```

#### Worked example — expert SSE turn (abbreviated)
```
event: turn.start
data: {"turnId":"t-…","conversationId":"c-…","mode":"expert","ts":1750200000000}

event: call.start
data: {"callId":"e1","modelId":"deepseek-pro","role":"expert","index":0}

event: call.delta
data: {"callId":"e1","modelId":"deepseek-pro","role":"expert","index":0,"delta":"从第一性原理…"}

event: call.usage
data: {"modelId":"deepseek-pro","role":"expert","inputTokens":312,"outputTokens":640,"reasoningTokens":0,"costMicro":8928,"platformFeeMicro":50000,"status":"ok"}

event: reason.start
data: {"modelId":"gpt-55"}

event: reason.delta
data: {"delta":"融合器（GPT-5.5）正在对比…"}

event: reason.done
data: {"reasoningTokens":410}

event: answer.delta
data: {"delta":"综合多位专家的回答…"}

event: call.usage
data: {"modelId":"gpt-55","role":"fusion","inputTokens":1200,"outputTokens":980,"reasoningTokens":410,"costMicro":...,"platformFeeMicro":50000,"status":"ok"}

event: turn.usage
data: {"turnTok":4210,"turnCostMicro":31200,"turnFeeMicro":200000,"turnTotalMicro":231200,"callCount":4}

event: turn.done
data: {"turnId":"t-…","status":"done","messageId":"m-…"}
```
A 3-expert turn produces **4** model calls (3 experts + 1 fusion) → `callCount = 4` and
`turnFeeMicro = 4 × 50000 = 200000`. A fast turn produces 1 call → 1 fee.

---

## 3. Model Library

### GET /api/models
- **Auth:** required · **Action:** `models.list`
- **Query** (`ModelsQuery`): `?lang=zh|zh-TW|en|ja` (optional), `?gateway=openrouter` (optional).
- **Default response `data`**: `{ models: ModelDTO[12], openRouter: string[] }`.
  ```ts
  type ModelDTO = {
    id; name; vendor; color; initials; tier;   // from the registry
    tags: string[];                              // localized for the caller's lang
    ctx; pin; pout;                              // context window + pricing (¥/1M)
    enabled: boolean;                            // per-user model_state (COALESCE → true)
    isMain: boolean;                             // id === preferences.main_model
  }
  ```
- **OpenRouter response (`?gateway=openrouter`) `data`**: `{ models: { name }[] }`. `meta.gateway="openrouter"`.
- **Errors:** `401 AUTH_REQUIRED`; `503 GATEWAY_UNAVAILABLE` only when `LLM_MODE=gateway` **and**
  no `AI_GATEWAY_API_KEY` (mock mode lists the catalog freely).

### PATCH /api/models/:id
A discriminated union dispatched by body shape (so the action name differs):

**Toggle enabled** — **Action:** `models.toggle`
- **Body:** `{ enabled: z.boolean() }` (strict).
- **Success `data`**: `{ model: ModelDTO }`. `meta = { modelId, enabled }`.
- **Errors:** `404 MODEL_NOT_FOUND` (unknown id), `409 CANNOT_DISABLE_MAIN` (disabling current
  main), `409 MODEL_IN_TRIO` (disabling a model in the active trio), `400 VALIDATION_ERROR`.

**Set main** — **Action:** `models.setMain`
- **Body:** `{ setMain: z.literal(true) }` (strict).
- **Success `data`**: `{ model: ModelDTO, mainModel: <id> }`. `meta = { mainModel }`.
- **Errors:** `404 MODEL_NOT_FOUND`, `400 MODEL_NOT_AVAILABLE` (target disabled).

---

## 4. Usage & Cost Analytics

All sums are over integer micro-CNY from `usage_records`, so aggregates equal the sum of per-call
rows with zero drift. Windows: `windowRange("7d"|"30d"|"all")` → `[from, to)` epoch-ms.

### GET /api/usage (alias)
- **Auth:** required · **Action:** `usage.summary`
- **Query** (`AliasQuery`): `?trend=<n>` (leading integer = day count, 1–90), `?by=model`,
  `?view=ledger`, plus `?window`, `?days`, `?limit`, `?cursor`. Dispatches to the matching
  aggregator below (default = summary). `meta.view` records which.

### GET /api/usage/summary
- **Auth:** required · **Action:** `usage.summary`
- **Query** (`SummaryQuery`): `?window=7d|30d|all` (default `7d`) **or** explicit
  `?from&?to` (epoch-ms; when both present they override the window).
- **Success `data`**:
  ```jsonc
  { "window": "7d",
    "totals": { "inputTokens", "outputTokens", "reasoningTokens",
                "modelCostMicro", "platformFeeMicro", "totalMicro",
                "callCount", "requestCount" },
    "platformFeePerCallMicro": 50000 }
  ```
  `requestCount` = distinct `turn_id`s; `totalMicro = modelCostMicro + platformFeeMicro`.
- **Errors:** `400 VALIDATION_ERROR`.

### GET /api/usage/trend
- **Auth:** required · **Action:** `usage.trend`
- **Query** (`TrendQuery`): `?days=z.coerce.number().int().min(1).max(90).default(7)`.
- **Success `data`**: `{ days: [{ key, label, totalMicro }] }` — exactly `days` buckets,
  zero-filled, oldest→newest. `key` = bucket midnight epoch-ms; `label` = `"M/D"`;
  `totalMicro` = model cost + fee for that day.
- **Errors:** `400 VALIDATION_ERROR`.

### GET /api/usage/by-model
- **Auth:** required · **Action:** `usage.by_model`
- **Query** (`ByModelQuery`): `?window` (default `7d`), `?limit=z.coerce.number().int().min(1).max(50).default(6)`.
- **Success `data`**: `{ models: [{ modelId, name, color, calls, modelCostMicro, sharePct }], totalModelCostMicro }`
  — sorted by `modelCostMicro` desc, top `limit`. `sharePct = round(cost/total × 100)`.
- **Errors:** `400 VALIDATION_ERROR`.

### GET /api/usage/ledger
- **Auth:** required · **Action:** `usage.ledger`
- **Query** (`LedgerQuery`): `?limit=z.coerce.number().int().min(1).max(100).default(12)`,
  `?cursor` = **epoch-ms integer** (`turn.created_at`; keyset, newest-first, inclusive `<=`).
- **Success `data`**: `{ rows: LedgerRow[], nextCursor }`.
  ```ts
  type LedgerRow = {
    turnId; ts; prompt;          // prompt truncated to 80 chars
    mode;
    models: { modelId, name, color }[];   // deduped, in usage_records order
    inputTokens; outputTokens;            // outputTokens includes reasoning tokens
    modelCostMicro; platformFeeMicro; totalMicro;
  }
  ```
  `nextCursor` = `created_at` of the first overflow turn, or `null`.
- **Errors:** `400 VALIDATION_ERROR`.

### GET /api/usage/export
- **Auth:** required · **Action:** `usage.export` (`meta = { rowCount, format, window }`)
- **Query** (`ExportQuery`): `?format=csv|json` (**required**), `?window=7d|30d|all` (default `7d`).
- **Success:** raw file (not the envelope), `Content-Disposition: attachment;
  filename="usage-<window>-<YYYY-MM-DD>.<ext>"`. Columns: `id, createdAt, turnId, conversationId,
  modelId, role, inputTokens, outputTokens, reasoningTokens, costMicro, platformFeeMicro,
  totalMicro, latencyMs, status` (oldest→newest). CSV is CRLF, RFC-4180 escaped.
- **Errors:** `400 VALIDATION_ERROR` (e.g. missing/invalid `format`).

---

## 5. Billing & Subscription

Plan → included credit (micro-CNY): `free → 0`, `pro → 150000000`, `team → 750000000`,
`ent → custom (null)`. Monthly usage is computed over the current calendar month.

### GET /api/billing/subscription
- **Auth:** required · **Action:** `billing.subscription`
- **Success `data`**:
  ```jsonc
  { "plan": { "id", "name", "includedCreditMicro", "periodStart", "periodEnd", "renewsOn" },
    "usage": { "modelCostMicro", "platformFeeMicro", "monthTotalMicro" },
    "includedCreditMicro", "remainingMicro", "usedPct", "creditBalanceMicro" }
  ```
  `usedPct = min(100, round(monthTotalMicro / includedCreditMicro × 100))` (0 if no credit);
  `remainingMicro = max(0, includedCreditMicro − monthTotalMicro)`. If no subscription row exists,
  defaults are synthesized from `users.plan_id`.
- **Errors:** `401 AUTH_REQUIRED`.

### POST /api/billing/subscription
- **Auth:** required · **Action:** `billing.change_plan` (`meta = { fromPlan, toPlan }`)
- **Request body** (`ChangePlanBody`): `{ planId: z.enum(["free","pro","team","ent"]) }`.
- **Behavior:** upserts the subscription (new `includedCreditMicro`), updates the denormalized
  `users.plan_id`, and returns the refreshed subscription view (same shape as GET).
- **Errors:** `409 PLAN_REQUIRES_SALES` (`planId="ent"` — never auto-provisions),
  `400 VALIDATION_ERROR`.

### GET /api/billing/plans
- **Auth:** required · **Action:** `billing.plans`
- **Query:** `?lang=zh|zh-TW|en|ja` (optional, default `zh`).
- **Success `data`**: `{ plans: [{ id, name, priceMicro|null, period, includedCreditMicro|null,
  features: string[], current: boolean }] }` — 4 plans, localized `name`/`period`/`features`.
  `priceMicro`: `free=0`, `pro=199000000`, `team=899000000`, `ent=null`.

### GET /api/billing/invoices
- **Auth:** required · **Action:** `billing.invoices`
- **Success `data`**: `{ invoices: [{ id, date, planLabel, kind, amountMicro, status }] }`,
  newest-first (`date` desc).

### GET /api/billing/invoices/:id
- **Auth:** required · **Action:** `billing.invoice_detail`
- **Success `data`**: `{ invoice: { id, date, planLabel, kind, amountMicro, status,
  lineItems: [{ label, amountMicro }] } }`.
- **Errors:** `404 NOT_FOUND` (missing or not owned).

### POST /api/billing/topup
- **Auth:** required · **Action:** `billing.topup` (`meta = { amountMicro }`)
- **Request body** (`TopupBody`): `{ amountMicro: z.number().int().min(1000000).max(1000000000) }`
  (¥1–¥1000).
- **Behavior:** adds to `subscriptions.creditBalanceMicro` and records a paid `topup` invoice.
- **Success `data`**: `{ creditBalanceMicro, invoice: { id, date, planLabel:"Top-up", kind:"topup",
  amountMicro, status:"paid", lineItems: [{ label:"Top-up", amountMicro }] } }`.
- **Errors:** `400 VALIDATION_ERROR`; `402 PAYMENT_FAILED` (stub PSP failure path).

### GET /api/billing/payment-method
- **Auth:** required · **Action:** `billing.payment_method`
- **Success `data`**: `{ method: { brand, last4, expMonth, expYear } | null }`.

### PUT /api/billing/payment-method
- **Auth:** required · **Action:** `billing.payment_method`
- **Request body** (`PaymentMethodBody`):
  ```ts
  { brand: z.enum(["visa","mastercard","unionpay","amex","alipay","wechat"]),
    last4: z.string().regex(/^\d{4}$/),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2024).max(2099) }
  ```
- **Behavior:** rejects an expiry already in the past (valid through end of the expiry month).
  No PAN/CVV is ever stored.
- **Success `data`**: `{ method: { brand, last4, masked:"•••• 1234", expMonth, expYear } }`.
- **Errors:** `400 VALIDATION_ERROR` (bad fields or past expiry).

---

## 6. Conversations & History

### POST /api/conversations
- **Auth:** required · **Action:** `conversation.create`
- **Request body** (`CreateConversationBody`): `{ title: z.string().max(120).optional() }`
  (defaults to `"New chat"`).
- **Success `data`**: `{ conversation: { id, title, color, createdAt, updatedAt } }`.
- **Errors:** `400 VALIDATION_ERROR`.

### GET /api/conversations
- **Auth:** required · **Action:** `conversation.list`
- **Query** (`ListConversationsQuery`): `?limit=z.coerce.number().int().min(1).max(100).default(20)`,
  `?cursor` (base64url of `updatedAt:id`).
- **Success `data`**: `{ conversations: [{ id, title, color, updatedAt, lastPrompt, turnCount }],
  nextCursor }` — `updatedAt` desc, keyset paginated. `lastPrompt` = newest turn's prompt
  (truncated 80); `turnCount` = number of turns.

### PATCH /api/conversations/:id
- **Auth:** required · **Action:** `conversation.rename`
- **Request body** (`RenameConversationBody`): `{ title: z.string().min(1).max(120) }`.
- **Success `data`**: `{ conversation: { id, title, color, createdAt, updatedAt } }` (bumps `updatedAt`).
- **Errors:** `404 NOT_FOUND` (missing/not owned), `400 VALIDATION_ERROR`.

### DELETE /api/conversations/:id
- **Auth:** required · **Action:** `conversation.delete` (`meta = { turnCount }`)
- **Behavior:** deletes the conversation + its turns + messages, but **retains `usage_records`**
  (billing integrity — they carry `user_id` and a now-orphaned `conversation_id`).
- **Success `data`**: `{ id, deleted: true }`.
- **Errors:** `404 NOT_FOUND`.

### GET /api/conversations/:id/messages
- **Auth:** required · **Action:** `conversation.messages`
- **Success `data`**: `{ turns: [...] }`, oldest→newest, rehydrating the full chat view:
  ```ts
  {
    turnId,
    user: { text },
    assistant: {
      mode, deepResearch,
      routeText?,                 // present when captured (fast+auto)
      single?,                    // fast: { modelId, text, inputTokens, outputTokens, costMicro, platformFeeMicro }
      experts?,                   // expert: array of { modelId, text, …, status }
      fusion?,                    // expert: { modelId, reasonText, answerText, …, reasoningTokens }
    },
    perTurn: { inputTokens, outputTokens, modelCostMicro, platformFeeMicro, totalMicro, callCount }
  }
  ```
  `perTurn` is derived from `usage_records` (`outputTokens` includes reasoning tokens).
- **Errors:** `404 NOT_FOUND` (missing/not owned).

---

## 7. Preferences & Localization

`PreferencesPayload`:
```jsonc
{ "theme", "lang", "mode", "auto", "mainModel", "trio": string[3],
  "deepResearch", "deepAgents",
  "platformFeePerCallMicro": 50000,   // the BILLED fee (constant; from PLATFORM_FEE_CNY)
  "platformFeeDisplayMicro": 50000 }  // DISPLAY-only; never affects billing
```

### GET /api/preferences
- **Auth:** required · **Action:** `prefs.get`
- **Success `data`**: the full `PreferencesPayload`.
- **Errors:** `401 AUTH_REQUIRED`.

### PATCH /api/preferences
- **Auth:** required · **Action:** `prefs.set` (`meta = { changed: [...] }`)
- **Request body** (`PreferencesPatch`, **strict** partial):
  ```ts
  { theme: z.enum(["dark","light"]).optional(),
    lang: z.enum(["zh","zh-TW","en","ja"]).optional(),
    mode: z.enum(["fast","expert"]).optional(),
    auto: z.boolean().optional(),
    mainModel: z.string().optional(),
    trio: z.array(z.string()).length(3).optional(),
    deepResearch: z.boolean().optional(),
    deepAgents: z.boolean().optional(),
    platformFeeDisplayMicro: z.number().int().min(0).max(1000000).optional() }
  ```
- **Behavior:** applies only the provided fields; returns the full `PreferencesPayload`.
- **Errors:** `400 VALIDATION_ERROR`; `400 MODEL_NOT_AVAILABLE` (unknown `mainModel`);
  `409 MODEL_DISABLED` (disabled `mainModel`); `400 INVALID_TRIO` (trio not 3 distinct enabled ids).

---

## 8. Activity & Admin

### GET /api/activity
- **Auth:** required · **Action:** `activity.query`
- **Query** (`ActivityQuery`): `?from&?to` (epoch-ms), `?action`, `?route`, `?status`,
  `?limit=z.coerce.number().int().min(1).max(200).default(50)`, `?cursor` (base64url `createdAt:id`),
  `?userId` (admin-only).
- **Scoping:** non-admins are force-scoped to their own `userId` (a client `?userId` that differs
  → `403 FORBIDDEN`); admins may pass any `?userId`.
- **Success `data`**: `{ logs: [{ requestId, action, route, method, status, latencyMs, createdAt }],
  nextCursor }` — newest-first (keyset over `createdAt,id`).
- **Errors:** `400 VALIDATION_ERROR` (incl. bad cursor), `403 FORBIDDEN`.

### GET /api/activity/export
- **Auth:** required · **Action:** `activity.export` (`meta = { rowCount, type, format }`)
- **Query** (`ActivityExportQuery`): `?type=activity|usage` (**required**), `?format=csv|json`
  (**required**), `?from&?to` (optional).
- **Scoping:** non-admin callers are force-scoped to their own `userId`.
- **Success:** streamed attachment (not the envelope), `filename="<type>-<YYYY-MM-DD>.<ext>"`.
  `type="activity"` columns: `requestId, userId, action, route, method, status, latencyMs,
  createdAt`. `type="usage"` columns: `id, requestId, userId, conversationId, turnId, messageId,
  modelId, role, inputTokens, outputTokens, reasoningTokens, costMicro, platformFeeMicro,
  latencyMs, status, createdAt`. JSON body: `{ type, rowCount, rows }`.
- **Errors:** `400 VALIDATION_ERROR`.

### GET /api/admin/metrics
- **Auth:** **admin** · **Action:** `admin.metrics`
- **Query** (`MetricsQuery`): `?window=z.enum(["1h","24h","7d","30d"]).default("24h")`.
- **Success `data`**:
  ```jsonc
  { "window": "24h",
    "metrics": {
      "requests", "errorRate",        // errorRate = count(status>=500)/count(*)
      "p50LatencyMs", "p95LatencyMs", // percentiles over activity_logs.latency_ms
      "activeUsers",                  // distinct user_id in activity_logs
      "totalCalls", "totalTokens", "totalCostMicro", "totalFeeMicro",
      "callsByModel": [{ modelId, calls, costMicro }],     // cost desc
      "requestsByAction": [{ action, count }]               // count desc
    } }
  ```
- **Errors:** `401 AUTH_REQUIRED` (no session), `403 FORBIDDEN` (non-admin), `400 VALIDATION_ERROR`.

---

## Error code table

`ApiError(status, code, message?, details?)` is thrown anywhere and mapped to the envelope +
HTTP status by `http.ts`. All failures still carry `x-request-id` and write an `activity_logs`
row with `meta.code`.

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod body/query parse failure, empty prompt, bad enum, bad cursor, past card expiry. `details` = `z.flatten()`. |
| 400 | `MODEL_NOT_AVAILABLE` | Fast-manual `mainModel` unknown/disabled; `setMain` target disabled; preferences `mainModel` unknown. |
| 400 | `INVALID_TRIO` | `trio` ≠ 3 distinct, known, enabled ids (chat expert / preferences / orchestration). |
| 401 | `AUTH_REQUIRED` | Protected route with no/expired session. |
| 401 | `AUTH_INVALID` | Login bad credentials (identical for unknown email / wrong password). |
| 402 | `PAYMENT_FAILED` | Stub PSP failure on top-up. |
| 403 | `FORBIDDEN` | Non-admin querying another user's activity; non-admin hitting an admin endpoint. |
| 404 | `NOT_FOUND` | Resource missing or not owned (conversation, invoice). |
| 404 | `MODEL_NOT_FOUND` | Unknown model id on `PATCH /api/models/:id`. |
| 404 | `TURN_NOT_FOUND` | Regenerate target turn missing, not owned, or conversationId mismatch. |
| 409 | `AUTH_EMAIL_TAKEN` | Signup with an already-registered email. |
| 409 | `STREAM_IN_PROGRESS` | A second chat/regenerate while a turn streams in that conversation. |
| 409 | `CANNOT_DISABLE_MAIN` | Disabling the current main model. |
| 409 | `MODEL_IN_TRIO` | Disabling a model in the active trio. |
| 409 | `MODEL_DISABLED` | Setting a disabled model as main via preferences/orchestration. |
| 409 | `COMPILER_UNAVAILABLE` | Expert compiler (`mainModel`) unknown/disabled at fusion start. |
| 409 | `PLAN_REQUIRES_SALES` | `POST /api/billing/subscription { planId:"ent" }`. |
| 503 | `GATEWAY_UNAVAILABLE` | `GET /api/models?gateway=openrouter` in gateway mode with no `AI_GATEWAY_API_KEY`. |
| 503 | `SSO_UNAVAILABLE` | `POST /api/auth/sso` in `LLM_MODE=gateway`. |
| 500 | `INTERNAL` | Unhandled error (the wrapper still logs `status:500` and returns the envelope). |

**In-stream (SSE `error`/`call.error`) codes** — not HTTP statuses; delivered as events on an
already-`200` stream:

| code | When |
|---|---|
| `PROVIDER_ERROR` | A model call failed (fatal in fast mode; per-expert `call.error` in expert mode). |
| `ALL_EXPERTS_FAILED` | Every expert in an expert-mode turn failed; no fusion billed, turn `failed`. |
