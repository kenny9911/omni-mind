# Review — Observability & Cost-Accounting Exactness

Dimension: (a) one `activity_logs` row per served request incl. 4xx/5xx; (b) one
`usage_records` row per model call with tokens+cost+latency; (c) aggregate totals ==
sum of per-call micro-CNY with zero drift; (d) latency captured. Adversarial pass —
verified against code, not comments.

Reviewer scope files: `lib/server/http.ts`, `lib/server/log/activity.ts`,
`lib/server/llm/cost.ts`, `lib/server/llm/fusion.ts`, `lib/server/llm/gateway.ts`,
`lib/server/usage/aggregate.ts`, `app/api/**`, `tests/us6,us10`.

---

## Genuine strengths (verified, not assumed)

- **Single integer-micro money domain, zero float drift in the math.** `cost.ts:28-30`
  computes `round(in×pin)+round((out+reason)×pout)` in integer micro-CNY; all aggregators
  (`aggregate.ts`, `admin/metrics`, `usage/export`, `messages` perTurn) sum the **stored**
  per-row integers and derive `totalMicro = costMicro + platformFeeMicro` rather than
  re-deriving from tokens. There is no place that re-multiplies price×tokens at aggregate
  time, so per-call rounding can never disagree with the rollup. This is the core
  zero-drift guarantee and it genuinely holds for persisted rows.
- **Seed path uses the exact same `billCall`** (`seed.ts:172,182,191,211`) as the live
  path (`fusion.ts:68`), so demo history reconciles with the live ledger byte-for-byte.
- **Aggregators read the ledger, not a cache.** `summary` / `byModel` / `trend` / `ledger`
  / `monthTotal` (`aggregate.ts`) and `messages` perTurn all recompute from
  `usage_records`; nothing stores a redundant denormalized total that could rot.
- **Activity logging is failure-isolated and runs for 4xx/5xx.** `http.ts:110-126` writes
  the row in the outer scope after the try/catch, so validation/auth errors still log;
  `writeActivity` (`activity.ts:24-40`) swallows its own insert failure so logging never
  breaks a request. Tests `us10` UC1 confirm 400 and 401 both produce rows.
- **Latency is measured on the real boundaries.** Request latency via
  `performance.now()` straddling the whole handler (`http.ts:79,116`); per-call latency
  straddles `streamOne` (`fusion.ts:105/114`, `145/155`, `189/211`).

---

## Findings

### P1 — Aborted / disconnected stream bills completed-and-partial calls AND marks the turn `done`, violating the documented disconnect contract
`lib/server/llm/fusion.ts:41-281`, `lib/server/sse.ts:46-49`, `lib/server/llm/gateway.ts:40-46`

The contract (`technical-design.md:859-861`) is explicit: "On client disconnect mid-stream,
the server cancels in-flight work and persists `usage_records` for any **completed** calls;
the turn is marked **`partial`** (no orphaned in-flight turns, NFR-17)." Implementation does
neither correctly:

1. On disconnect, `sse.ts:47-48 cancel()` calls `ac.abort()`. In mock mode the abort only
   `break`s the chunk loop (`gateway.ts:42`) and **returns `status:"ok"` with the partial
   text** (`gateway.ts:46`). `runTurn` does not inspect the signal after `streamOne`, so
   `persistUsage(... "ok")` (`fusion.ts:115`/`173`/`213`) **bills a full ¥0.05 fee + token
   cost for a call that was cut off**. The contract says only *completed* calls are billed;
   a torn-off call is billed at "ok".
2. `runTurn` runs to completion regardless of the signal: it inserts the assistant message
   (`fusion.ts:254`) and sets `turns.status` to `done`/`partial` from `turnStatus`
   (`fusion.ts:264`), where `turnStatus` is only ever flipped to `partial` by an *expert
   error* (`fusion.ts:165`), **never by an abort**. So a disconnected turn is persisted as
   `status:"done"`, directly contradicting "marked `partial` (no orphaned in-flight turns)".

There is no test exercising mid-stream disconnect (us6/us10 always `readSse`/drain to
completion), so this is unverified by the suite despite being a named NFR.

Recommendation: after each `streamOne`, check `cfg.signal?.aborted`; for an aborted call,
skip `persistUsage` (or persist with `status:"partial"` and **no** fee, matching the expert
"not billed" rule), stop launching further calls, and set `turnStatus = "partial"` before
the message insert. Add a regression test that aborts the `AbortSignal` mid-stream and
asserts (a) the turn row is `partial` and (b) no fee was charged for the truncated call.

### P1 — A failed fast (single) call and a failed fusion call are billed as `status:"ok"` with a full platform fee
`lib/server/llm/fusion.ts:106-126` (fast), `lib/server/llm/fusion.ts:190-231` (fusion)

`streamOne` can return `{status:"error", outputTokens:0}` in gateway mode
(`gateway.ts:33-36`). The expert branch correctly honors `call.status === "error"` and
**skips billing** (`fusion.ts:156-159,169-171`), matching the design rule "a failed expert …
is **not** billed" (`technical-design.md:674-675`). But:

- **Fast/single:** `fusion.ts:106-115` never reads `call.status`. On a provider error it
  calls `persistUsage("single", modelId, inputTokens, 0, 0, latency, "ok")` — writing a
  `usage_records` row with `status:"ok"`, `costMicro = round(inputTokens×pin)` (input is
  still billed even though nothing was produced), and a ¥0.05 fee. The design says a failed
  fast call should be a fatal turn error: `event: error … code PROVIDER_ERROR` that closes
  the stream (`technical-design.md:847`). Instead the turn completes as `done` and the user
  is charged.
- **Fusion:** `fusion.ts:190-221` never reads `reason.status` or `answer.status`. A failed
  compiler call still runs `persistUsage("fusion", …, "ok")` (`fusion.ts:213-221`), billing
  input + fee for a fusion that produced nothing.

Net effect: the `status` column on `usage_records` is effectively always `"ok"` from the
live path (only the expert-error branch ever avoids a row, and it avoids it entirely rather
than writing `"error"`). The admin error-rate/metrics view is computed off `activity_logs`
status (`admin/metrics:38`), so a silently-billed provider failure shows up as a 200 there
too — it is invisible in observability AND it over-bills.

Recommendation: branch on `call.status` for the single and fusion calls exactly as the
expert branch does — on error, either skip the row (design's "not billed" rule) or write
`status:"error"` with `costMicro:0, platformFeeMicro:0`, and for the fatal fast case throw
so `sse.ts` emits the `error` event and the turn is marked `failed`.

### P2 — `writeUsage` has no failure isolation; a usage-insert failure leaves a half-billed turn stuck in `streaming`
`lib/server/log/activity.ts:70-90`, `lib/server/llm/fusion.ts:69-85`

Unlike `writeActivity` (wrapped in try/catch, `activity.ts:24-40`), `writeUsage` lets an
insert error propagate. In expert mode the experts are persisted in a loop
(`fusion.ts:168-185`) and the fusion row after (`fusion.ts:213`). If, say, the fusion
`writeUsage` throws, the experts are already committed, `runTurn` throws before
`turns.status` is flipped off `streaming` (set at `chat/route.ts:103`), and the SSE wrapper
emits `error` (`sse.ts:30-36`). Result: a turn permanently `status:"streaming"` with a
**partial** set of billed `usage_records` and no assistant message. Because the
`hasStreamingTurn` single-flight guard keys off `streaming` turns, that conversation can also
become permanently blocked from new turns. (Aggregates themselves stay self-consistent —
they sum whatever rows exist — so this is durability/consistency, not arithmetic drift.)

Recommendation: persist all usage rows for a turn in a single transaction with the
assistant-message insert + `turns.status` update, or add a sweeper that reconciles turns
left `streaming` past a deadline. At minimum, on `runTurn` failure set `turns.status` to
`failed` in a `finally`.

### P2 — `getDb()` is awaited outside the try/catch, so a DB-init failure produces zero `activity_logs` rows and an unhandled rejection
`lib/server/http.ts:81`

`const { db } = await getDb();` sits before the `try` (and before `start`/`meta`/`status`
are usable for the log write at `:117`). If first-call schema init or client creation throws
(`client.ts:47-51`), the wrapper rejects before any `writeActivity`, so that served request
produces **no** activity row — a hole in "exactly one row per served request." In practice
`getDb()` is process-memoized so this only bites on the first request after a cold/broken
DB, but the invariant as stated ("every served request incl. 5xx") is not unconditionally
true. Recommendation: move `getDb()` inside the try, or wrap the handler so an init failure
still emits a `status:500` activity row (best-effort) before returning the envelope.

### P2 — `reasoningTokens` is billed at the *output* price but the fast/single path can never record it; documentation vs. behavior gap for routed/manual fast turns
`lib/server/llm/cost.ts:28-30`, `lib/server/llm/fusion.ts:115`

`modelCostMicro` bills `(outputTokens + reasoningTokens) × pout` (`cost.ts:30`), which is the
documented rule (`technical-design.md:25`, line "Reasoning tokens are billed at the output
price"). Correct for fusion. But the fast/single path always passes `reasoningTokens:0`
(`fusion.ts:115`) even though FR-39/Deep Research is described as adding reasoning-style
inflation; only `inputTokens` is inflated via `inflate()` (`fusion.ts:104`). This is
arguably intended (single mode has no reasoning trace), but it means the only
reasoning-token cost in the system comes from the fusion compiler. Worth a one-line
assertion/test so a future change to single-mode Deep Research can't silently skip
reasoning billing. No drift today.

### P2 — `trend` bucketing is local-timezone and `> Date.now()` exclusive; future-dated or DST-edge records can be dropped from the trend total while still counting in `summary`
`lib/server/usage/aggregate.ts:61-78`

`trend` builds buckets with `setHours(0,0,0,0)` in local time and queries
`rowsInRange(..., from, Date.now()+1)`. A `usage_records.createdAt` newer than the bucket
range end (clock skew, or a seeded `ts` in the future) lands outside `[from, Date.now()+1)`
and is silently dropped from the trend, while `summary(window=all)` (`:31`, range
`[0, now)`) and `byModel` would still include it. `trend` totals can therefore under-report
relative to `summary` for the same nominal period. The `us6` trend test only asserts
`> 0` and bucket count, not reconciliation against `summary`. Recommendation: derive the
upper bound consistently (`to` from `windowRange`) and add a test asserting
`sum(trend.totalMicro) == summary.totalMicro` for an equivalent window.

---

## Things explicitly checked and found CORRECT (no issue)

- **Per-call fee vs. rollup fee agree.** `fusion.ts:248` computes `feeMicro = fee × callCount`
  for the `turn.usage` SSE event; every persisted row carries exactly one
  `PLATFORM_FEE_MICRO` (`activity.ts:85`) and `callCount` == number of rows, so the streamed
  rollup equals the summed ledger fee. No double-count.
- **`PLATFORM_FEE_MICRO()` is read once per turn** (`fusion.ts:49`) but recomputed per
  `billCall` (`cost.ts:52`); both read the same env default `50000`, consistent across the
  turn. `usage/summary` hardcodes `50000` (`summary/route.ts:7`) — matches the default but
  would diverge if `PLATFORM_FEE_CNY` were overridden (display-only constant, low risk).
- **Regenerate does not double-bill.** `regenerate/run.ts:66` deletes the turn's
  `usage_records` before re-running and reuses the same `turnId`, so re-running replaces
  rather than appends. Net ledger stays exact.
- **Pricing fallback is recorded, not silently mispriced.** Unknown model → `{in:5,out:15}`
  + `pricingFallback:true` (`cost.ts:27,31`) surfaced into `meta_json`
  (`fusion.ts:84`). OpenRouter ids (not in `PRICE_MAP`) take this path deterministically.
- **Cross-user scoping is injected server-side** for both activity (`activity/route.ts:44-52`)
  and usage aggregates (all `rowsInRange` filter `userId`), so no foreign rows pollute totals.
- **Latency persisted on every usage row and activity row** (`activity.ts:35,84`); admin
  p50/p95 computed over `activity_logs.latencyMs` (`admin/metrics:38-43`).

---

## One-line summary
0 P0, 2 P1, 4 P2 — money math is genuinely drift-free for *persisted* rows, but the live path over-bills (full fee at `status:"ok"`) on aborted streams and on failed fast/fusion calls, and leaves disconnected turns marked `done`/`streaming` instead of `partial`/`failed`, contradicting the documented disconnect & degraded-turn contracts.
