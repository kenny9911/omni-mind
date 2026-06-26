# Observability & Logging

> **The product requirement is simple and absolute: OmniMind logs *everything*.**
> Every served request becomes a durable row. Every model call becomes a durable row.
> Every ¥ is accounted for in integer micro-CNY with zero float drift, and the
> reported aggregate is, by construction, the exact sum of the per-call rows.

This document describes the two durable observability sinks (`activity_logs`,
`usage_records`), the stdout JSON mirror, the cost-accounting exactness guarantees,
how to query/export the data, and the unhappy-path billing rules that govern when a
call is — and is not — billed.

Source of truth is the code:

| Concern | File |
| --- | --- |
| Per-request logging + envelope/error mapping | `lib/server/http.ts` |
| The two DB sinks + stdout mirror | `lib/server/log/activity.ts` |
| Structured stdout line-logger | `lib/server/log/logger.ts` |
| Per-call billing (the LLM gateway) | `lib/server/llm/fusion.ts` |
| Cost math (micro-CNY, fee) | `lib/server/llm/cost.ts` |
| Aggregation (single source of truth) | `lib/server/usage/aggregate.ts` |
| Query / export / metrics handlers | `app/api/activity/`, `app/api/activity/export/`, `app/api/admin/metrics/` |
| Schema | `lib/server/db/schema.ts` |

Money convention: integer **micro-CNY**, where `¥ = micro / 1_000_000`. Times are
epoch-ms (`Date.now()`). Every HTTP response carries an `x-request-id` header.

---

## 1. `activity_logs` — one row per served request

Every request that the API serves — **including 4xx and 5xx** — produces exactly one
`activity_logs` row. This is enforced structurally: the `route()` wrapper in
`lib/server/http.ts` wraps every handler, and the row is written in the wrapper's tail
**after** the `try/catch`, so it runs whether the handler returned a success envelope,
threw an `ApiError`, or threw an unexpected error that was mapped to `500 INTERNAL`.

### Request lifecycle in `route()`

1. Mint a fresh `requestId` via `randomUUID()` and start a `performance.now()` timer.
2. Resolve the session; enforce `auth: "required" | "admin"` (→ `401 AUTH_REQUIRED` /
   `403 FORBIDDEN`).
3. Run the handler inside `try`. On throw, `toApiError()` maps it to the error envelope:
   `ApiError` passes through; `ZodError` → `400 VALIDATION_ERROR`; anything else →
   `500 INTERNAL` (and the raw error is logged to stdout as `unhandled_error`).
4. Compute `latencyMs = round(performance.now() - start)`.
5. Call `writeActivity(db, {...})` — **one row, unconditionally.**
6. Attach `x-request-id` to the outgoing response via `withRequestId()`.

Handlers can enrich the row through `ctx.setMeta({...})`. The accumulated `meta` object
is JSON-stringified into `meta_json` (or `null` when empty). Examples in the codebase:
the export handler sets `{ rowCount, type, format }`; the copy-ping sets
`{ action, turnId, ... }`.

### Fields (`activityLogs`, `lib/server/db/schema.ts`)

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text (uuid) | Row id. |
| `request_id` | text | The per-request `x-request-id`. Correlates to `usage_records.request_id` and the stdout `request` line. |
| `user_id` | text \| null | Authenticated user, or `null` for public/unauthenticated requests. |
| `action` | text | Stable action label passed to `route("…")`, e.g. `activity.query`, `admin.metrics`, `chat.send`. |
| `route` | text | `URL.pathname` of the request. |
| `method` | text | HTTP method. |
| `status` | integer | Final HTTP status — includes 4xx/5xx. |
| `latency_ms` | integer | Server-side handler latency in ms. |
| `meta_json` | text \| null | Optional handler-enriched JSON (`ctx.setMeta`). |
| `created_at` | integer | Epoch-ms. |

Indexes: `(user_id, created_at)`, `(action, created_at)`, `(status, created_at)`,
`(request_id)` — tuned for the query/metrics access patterns below.

### Logging never breaks a request

`writeActivity` wraps the `INSERT` in a `try/catch`; if the DB write fails it logs
`activity.write_failed` to stderr but does **not** rethrow. Observability is best-effort
at the storage layer and never converts a successful response into a failure.

### stdout JSON mirror

Independent of the DB write, every request also emits a single structured JSON line to
stdout via `log.info("request", {...})` (`lib/server/log/logger.ts`). One line = one JSON
object (`{ t, level, msg, requestId, userId, action, route, method, status, latencyMs }`),
so logs are greppable and queryable in Vercel / log tooling even if the DB is unavailable.
`error`/`warn` go to stderr; `LOG_LEVEL` (default `info`) gates the threshold.

> **Known limitation (G17):** for the streaming chat/regenerate routes, the `route()`
> wrapper records `latency_ms` when the SSE `Response` object is returned — i.e. before
> the stream body has finished — so request-level latency for those routes is ≈0. The
> *per-call* latency in `usage_records` (measured around each `streamOne`) is accurate and
> is the figure to trust for model timing.

---

## 2. `usage_records` — one row per model call

Every model call made by the LLM gateway (`runTurn` in `lib/server/llm/fusion.ts`) that is
actually billed produces exactly one `usage_records` row, written by `writeUsage`
(`lib/server/log/activity.ts`). A single chat turn can produce several rows:

- **Fast mode:** 1 row (`role: "single"`).
- **Expert mode:** 1 row per *surviving* expert (`role: "expert"`) + 1 fusion row
  (`role: "fusion"`) — an N-expert turn that fully succeeds = **N + 1 rows**.

The fusion row's `reasoning_tokens` carries the compiler's reasoning-trace tokens
(estimated from the reasoning text); single/expert rows have `reasoning_tokens = 0`.

### Fields (`usageRecords`, `lib/server/db/schema.ts`)

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text (uuid) | Row id. |
| `request_id` | text | The originating request's `x-request-id` (joins to `activity_logs`). |
| `user_id` | text | Owner. Retained even if the conversation is deleted (no FK). |
| `conversation_id` | text \| null | Conversation the turn belongs to. |
| `turn_id` | text | Turn id — the unit a ledger row aggregates over. |
| `message_id` | text \| null | Assistant message id (currently written `null` at call time). |
| `model_id` | text | Model used (e.g. `deepseek-pro`). |
| `role` | text | `single` \| `expert` \| `fusion`. |
| `input_tokens` | integer | Input tokens (incl. Deep Research / Deep Agents inflation). |
| `output_tokens` | integer | Output tokens. |
| `reasoning_tokens` | integer | Reasoning-trace tokens (fusion only); billed at the output price. |
| `cost_micro` | integer | Model cost in micro-CNY (see §3). |
| `platform_fee_micro` | integer | `PLATFORM_FEE_MICRO()` for this call (see §3). |
| `latency_ms` | integer | Per-call latency, measured around `streamOne`. |
| `status` | text | `ok` \| `error` \| `partial`. |
| `meta_json` | text \| null | e.g. `{ "pricingFallback": true }` when the model price was unknown. |
| `created_at` | integer | Epoch-ms. |

Indexes: `(user_id, created_at)`, `(turn_id)`, `(user_id, model_id)`, `(request_id)`.

### stdout mirror

`writeUsage` also emits a structured `usage` line to stdout (`requestId`, `turnId`,
`modelId`, `role`, token counts, `costMicro`, `platformFeeMicro`, `latencyMs`), mirroring
the DB row for line-log queryability.

### Live SSE mirror

During the stream, the same numbers are emitted to the client as SSE `call.usage`
(per call) and `turn.usage` (turn rollup) events, so the UI's running cost matches the
persisted rows exactly. `turn.usage` reports `turnFeeMicro = fee × callCount`, i.e. the
sum of the per-row `platform_fee_micro`.

---

## 3. Cost accounting — exactness, zero drift

### 3.1 Integer micro-CNY, no floats

All money lives in integer micro-CNY. Model prices (`pin`/`pout` in `lib/models.ts`) are
`¥ per 1M tokens`, which makes **micro-CNY-per-token equal to the price number**, so the
cost formula reduces to integer multiplication with a single `Math.round` per term
(`lib/server/llm/cost.ts`):

```
costMicro = round(inputTokens × pin) + round((outputTokens + reasoningTokens) × pout)
```

Reasoning tokens are billed at the output price (they are generated output). Unknown
models fall back to `{ in: 5, out: 15 }` and the row's `meta_json` records
`{ "pricingFallback": true }`. Floats never touch a persisted column; conversion to ¥
(`micro / 1e6`) happens only at the display edge (`formatMicro` / `fmtMoney`).

### 3.2 The platform fee — single-sourced, N+1 per turn

The per-call platform fee is **¥0.05 by default**, single-sourced from the
`PLATFORM_FEE_CNY` environment variable and converted once:

```ts
// lib/server/llm/cost.ts
export const PLATFORM_FEE_MICRO = (): number => {
  const cny = Number(process.env.PLATFORM_FEE_CNY ?? "0.05");
  return Math.round((Number.isFinite(cny) ? cny : 0.05) * 1_000_000); // default 50000
};
```

`billCall()` stamps `PLATFORM_FEE_MICRO()` onto **every billed call**, so the fee count
equals the billed-call count:

- A **Fast** turn = **1 fee** (`50000` micro = ¥0.05).
- An **N-expert** turn = **N + 1 fees** (one per surviving expert + one for fusion).

The turn rollup computes `feeMicro = fee × callCount`, where `callCount` is incremented
once per persisted row — so the fee total is always an exact integer multiple of the
single-sourced fee and can never disagree with the per-row sum.

> **PO fix G9:** the *reported* fee in `GET /api/usage`, `GET /api/usage/summary`, and the
> preferences contract was previously a hardcoded literal `50000`. It now reads
> `PLATFORM_FEE_MICRO()` everywhere, so changing `PLATFORM_FEE_CNY` moves the billed fee
> and the reported fee together. There is one fee constant in the system.

### 3.3 Aggregate == sum of per-call rows (zero drift)

There is **no separate physical aggregate table**. A "ledger" / turn row is derived by
summing `usage_records` for that `turn_id`. All aggregation in
`lib/server/usage/aggregate.ts` is a plain integer sum over rows in a time range:

```
modelCostMicro  = Σ row.costMicro
platformFeeMicro = Σ row.platformFeeMicro
totalMicro      = modelCostMicro + platformFeeMicro
```

Because the per-call cost is computed once, stored as an integer, and every read path sums
those same integers, **the aggregate equals the exact sum of the per-call rows with zero
rounding drift** (SM2 / NFR-6). `summary()`, `trend()`, `byModel()`, `ledger()`, and
`monthTotal()` all share this property; `admin/metrics` re-derives the same sums for its
window. The only place a non-sum operation occurs is `sharePct` (a display percentage),
which never feeds back into a stored or billed figure.

---

## 4. Querying & exporting

### `GET /api/activity` — activity query (US10.UC3)

Newest-first, keyset-paginated (`(createdAt, id)` cursor) query over `activity_logs`.
Filters: `from`, `to`, `action`, `route`, `status`, `limit` (≤200), `cursor`.
**Scoping:** non-admins are force-scoped to their own `user_id` (a `?userId` that differs
→ `403 FORBIDDEN`); admins may pass any `?userId`. Returns
`{ logs: ActivityLogDTO[], nextCursor }`.

### `POST /api/activity` — copy ping (US2.UC4 / US8.UC5)

A telemetry beacon with no usage. The `route()` wrapper still writes the one
`activity_logs` row; the body's `action` and `turnId` are surfaced into `meta`. (Note
G16: the row's top-level `action` is `activity.ping`, with the real `chat.copy` /
`result.copy` carried in `meta`.)

### `GET /api/activity/export` — export (US10.UC4)

Streams `activity_logs` **or** `usage_records` (`?type=activity|usage`) as `csv` or `json`
(`?format=`), optional `from`/`to`, returned as a download (`content-disposition:
attachment`). CSV is RFC-4180 escaped via `csvRow`; columns are fixed projections
(`ACTIVITY_EXPORT_COLUMNS` / `USAGE_EXPORT_COLUMNS`). Non-admins are force-scoped to their
own rows. The handler records `meta = { rowCount, type, format }` on its own activity row.

### `GET /api/admin/metrics` — observability dashboard (US10.UC5, admin only)

Rolls up a window (`1h | 24h | 7d | 30d`) into:

- `requests` — count of `activity_logs` in window.
- `errorRate` — `count(status ≥ 500) / count(*)`.
- `p50LatencyMs` / `p95LatencyMs` — percentiles over `activity_logs.latency_ms`
  (sorted ascending, computed in JS).
- `activeUsers` — distinct `user_id`.
- `totalCalls`, `totalTokens`, `totalCostMicro`, `totalFeeMicro` — sums over
  `usage_records`.
- `callsByModel` (calls + cost per model, desc by cost) and `requestsByAction`.

---

## 5. Unhappy-path billing rules (post-PO-fix)

The cardinal rule: **only successful, fully-streamed calls are billed at `status:"ok"`
with a fee. Failed, aborted, and all-fail turns are never billed.** These rules are
implemented in `runTurn` (`lib/server/llm/fusion.ts`) and close PO gaps G1–G3.

| Scenario | Billing | Turn status | Notes |
| --- | --- | --- | --- |
| **Fast call errors** (`streamOne` → `status:"error"`) | **No `usage_records` row.** No cost, no fee. | `failed` | Emits SSE `call.error` (`PROVIDER_ERROR`), flips `turns.status = failed`, throws so the SSE `error` frame fires. (G1) |
| **Fast call aborted** (client disconnects mid-stream; `signal.aborted`) | **Not billed** — the truncated call is dropped (`cost=0`, `fee=0`). | `partial` | No row persisted for the truncated call. (G1/G2) |
| **One expert errors / is aborted** | **That expert is not billed** and is excluded from fusion. | `partial` if it survives to fusion | Surviving experts + fusion are billed normally. |
| **All experts fail** (`surviving.length === 0`) | **No fusion call is run or billed.** Zero cost, zero fee for the turn. | `failed` | Emits typed SSE `error` `ALL_EXPERTS_FAILED`; fusion over nothing is never billed. (G3, NFR-16) |
| **Aborted before fusion** (experts done, client gone) | Surviving experts already billed; **compiler is not run or billed.** | `partial` | (G2, NFR-17) |
| **Happy fast** | 1 call billed (`ok`) + 1 fee. | `done` | — |
| **Happy expert (N experts)** | N expert calls + 1 fusion, each `ok` + fee = **N+1 fees**. | `done` | — |

Mechanically: `persistUsage(...)` (which calls `billCall` + `writeUsage` and increments
`callCount`) is invoked **only on the success path** of each branch. Error/abort branches
either `return` an unbilled placeholder (experts), drop the call (fast/fusion), or throw.
Therefore `platform_fee_micro` is charged once and only once per genuinely-served call, and
a failed or aborted turn contributes no money to any aggregate.

---

## 6. Sample rows

### `activity_logs` (a successful authenticated query)

```json
{
  "id": "7b1f3c2e-9a44-4d0b-8e21-2f6c4a9d1b03",
  "request_id": "c8e4a6d2-31f7-4a90-b5cc-9d2e1f0a7b64",
  "user_id": "usr_3kq9m2",
  "action": "activity.query",
  "route": "/api/activity",
  "method": "GET",
  "status": 200,
  "latency_ms": 14,
  "meta_json": null,
  "created_at": 1750204800123
}
```

A 5xx looks identical in shape — the row is still written, with `status: 500` and
`meta_json` carrying `{ "code": "INTERNAL" }`.

### `usage_records` (one fusion call of an expert turn)

```json
{
  "id": "a1d9f4b7-0c52-4e88-9b3a-7e5d2c1f6a90",
  "request_id": "f2c7b9e1-4a83-42d6-9c1e-0b7a5d3e8f12",
  "user_id": "usr_3kq9m2",
  "conversation_id": "cnv_7h2p",
  "turn_id": "trn_91xk",
  "message_id": null,
  "model_id": "deepseek-pro",
  "role": "fusion",
  "input_tokens": 642,
  "output_tokens": 588,
  "reasoning_tokens": 214,
  "cost_micro": 12192,
  "platform_fee_micro": 50000,
  "status": "ok",
  "meta_json": null,
  "created_at": 1750204801456
}
```

Cost check (`deepseek-pro`: `pin=4`, `pout=12`):
`round(642 × 4) + round((588 + 214) × 12) = 2568 + 9624 = 12192` micro = **¥0.012192**,
plus the **¥0.05** platform fee. For a 3-expert turn, this fusion row plus the three
`role:"expert"` rows yields **4 fees** (`4 × 50000 = 200000` micro = ¥0.20), and the
month/summary aggregate is exactly the sum of those four `cost_micro` + four
`platform_fee_micro` integers.
