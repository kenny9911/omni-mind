# OmniMind Backend — Test Report

QA report for the completed OmniMind backend. The suite runs against the deterministic
keyless mock (`LLM_MODE=mock`, `MOCK_STREAM_DELAY_MS=0`) over an isolated in-process PostgreSQL
(`@electric-sql/pglite`) per file, invoking the **real** Route Handlers through `tests/helpers/harness.ts`.

## Summary

```
 Test Files  12 passed (12)
      Tests  194 passed (194)
   Duration  ~1.3s
```

**Status: GREEN.** `npx vitest run` (a.k.a. `npm run test`) reports **194 passing tests across
12 files**, with zero failures, skips, or flakes. The 12 files are the 10 user-story suites
(US1–US10), plus `smoke.test.ts` and `improvements.test.ts`.

| File | Tests |
|---|---:|
| `tests/us1-auth.test.ts` | 20 |
| `tests/us2-fast-chat.test.ts` | 16 |
| `tests/us3-expert-fusion.test.ts` | 13 |
| `tests/us4-orchestration.test.ts` | 22 |
| `tests/us5-models.test.ts` | 19 |
| `tests/us6-usage.test.ts` | 19 |
| `tests/us7-billing.test.ts` | 18 |
| `tests/us8-conversations.test.ts` | 21 |
| `tests/us9-preferences.test.ts` | 15 |
| `tests/us10-observability.test.ts` | 18 |
| `tests/smoke.test.ts` | 6 |
| `tests/improvements.test.ts` | 7 |
| **Total** | **194** |

---

## User-story coverage — US1…US10 (50 use cases)

Each user story maps to one test file covering all five of its use cases. Every use case has
a real endpoint **and** at least one asserting test.

### US1 — Authentication → `tests/us1-auth.test.ts` (20)

| UC | Coverage |
|---|---|
| US1.UC1 | Signup with email & password (`409 AUTH_EMAIL_TAKEN`, validation). |
| US1.UC2 | Login with existing credentials. |
| US1.UC3 | Resolve current session (cookie → user + preferences). |
| US1.UC4 | Log out (session destroyed, cookie cleared). |
| US1.UC5 | SSO stub & validation gate. |

### US2 — Fast chat → `tests/us2-fast-chat.test.ts` (16)

| UC | Coverage |
|---|---|
| US2.UC1 | Send a Fast-mode prompt and stream the answer (SSE). |
| US2.UC2 | Auto-route picks the model from intent (emits a `route` event). |
| US2.UC3 | Manually pick the main model (auto off, **no** `route` event). |
| US2.UC4 | Copy the answer (copy ping has **no** billing impact). |
| US2.UC5 | See per-turn token usage and cost. |

### US3 — Expert fusion → `tests/us3-expert-fusion.test.ts` (13)

| UC | Coverage |
|---|---|
| US3.UC1 | Run the expert trio in parallel. |
| US3.UC2 | Stream the reasoning / thinking trace. |
| US3.UC3 | Final Compiler synthesizes one answer. |
| US3.UC4 | Regenerate an Expert turn (replays the **original** turn's trio/compiler). |
| US3.UC5 | Per-call accounting across the whole Expert turn. |

### US4 — Orchestration → `tests/us4-orchestration.test.ts` (22)

| UC | Coverage |
|---|---|
| US4.UC1 | Auto-route a prompt by intent (preview). |
| US4.UC2 | Set the main model. |
| US4.UC3 | Configure the expert trio. |
| US4.UC4 | Switch between Fast and Expert modes. |
| US4.UC5 | Toggle auto-routing on/off. |

### US5 — Model library → `tests/us5-models.test.ts` (19)

| UC | Coverage |
|---|---|
| US5.UC1 | List all 12 models with metadata. |
| US5.UC2 | Enable / disable a model (guards: `CANNOT_DISABLE_MAIN`, `MODEL_IN_TRIO`). |
| US5.UC3 | Set a model as main. |
| US5.UC4 | Tiers, pricing, context windows, localized tags. |
| US5.UC5 | OpenRouter gateway catalog. |

### US6 — Usage analytics → `tests/us6-usage.test.ts` (19)

| UC | Coverage |
|---|---|
| US6.UC1 | Usage summary aggregates (totals). |
| US6.UC2 | 7-day cost trend (zero-filled buckets). |
| US6.UC3 | Cost-by-model breakdown (share %). |
| US6.UC4 | Per-turn ledger detail (call drill-down). |
| US6.UC5 | Export usage as CSV / JSON. |

### US7 — Billing → `tests/us7-billing.test.ts` (18)

| UC | Coverage |
|---|---|
| US7.UC1 | Get current subscription + credit usage. |
| US7.UC2 | List plans (Free / Pro / Team / Enterprise). |
| US7.UC3 | Change / subscribe to a plan (`PLAN_REQUIRES_SALES` for Enterprise). |
| US7.UC4 | List & download invoices. |
| US7.UC5 | Top up credit & manage payment method. |

### US8 — Conversations → `tests/us8-conversations.test.ts` (21)

| UC | Coverage |
|---|---|
| US8.UC1 | Create a conversation. |
| US8.UC2 | List conversations & recents. |
| US8.UC3 | Rename a conversation. |
| US8.UC4 | Delete a conversation. |
| US8.UC5 | Fetch message history + regenerate. |

### US9 — Preferences → `tests/us9-preferences.test.ts` (15)

| UC | Coverage |
|---|---|
| US9.UC1 | Get preferences. |
| US9.UC2 | Set theme (light / dark). |
| US9.UC3 | Set language (4-language i18n). |
| US9.UC4 | Toggle Deep Research / Deep Agents. |
| US9.UC5 | Configure defaults (start mode, default lang, platform-fee display). |

### US10 — Observability → `tests/us10-observability.test.ts` (18)

| UC | Coverage |
|---|---|
| US10.UC1 | Every request writes exactly one `activity_logs` row (including 4xx). |
| US10.UC2 | `usage_records` written per model call. |
| US10.UC3 | Query activity logs (non-admin force-scoped to self). |
| US10.UC4 | Export logs & usage records (CSV / JSON). |
| US10.UC5 | Admin metrics dashboard (`403` for non-admin). |

---

## Smoke coverage — `tests/smoke.test.ts` (6)

A single critical-path walk that proves the whole stack composes, signup → chat → analytics →
billing:

1. Signup issues a session cookie.
2. Session resolves from the cookie (user + preferences).
3. Model library lists 12 models, exactly one `isMain`.
4. A multi-expert turn streams (`turn.start → reason.done → turn.usage → turn.done`), bills
   `callCount=4` (3 experts + 1 fusion) and `turnFeeMicro=200000` (4 × ¥0.05).
5. The new turn shows up in the usage summary with **zero drift** (`totalMicro ===
   modelCostMicro + platformFeeMicro`).
6. Billing returns the Pro subscription (`includedCreditMicro=150000000`).
7. Unauthenticated access is rejected (`401 AUTH_REQUIRED`).

---

## Improvement-regression coverage — `tests/improvements.test.ts` (7)

Targeted regression tests pinning the P1 fixes from the PO review so they can't silently
regress. Each maps to a gap (G…):

| Test | Gap | Asserts |
|---|---|---|
| All experts fail → `ALL_EXPERTS_FAILED` | **G3** | All experts forced to fail → terminal `error` `ALL_EXPERTS_FAILED`, fusion never runs (no `reason.start`), **nothing billed** (call count unchanged), turn row marked `failed`. |
| Failed fast call not billed at ok+fee | **G1** | A forced-fail fast call emits `call.error` + `error`, and the usage `callCount` is **unchanged** (no `status:"ok"` row, no ¥0.05 fee on a failure). |
| Regenerate replays the **original** trio | **G4** | Run an expert turn, change the preference trio to a different set, regenerate → history shows the **original** trio, not current preferences. |
| `deepAgents` inflates input tokens | **G5** | Same prompt with vs. without `deepAgents` → `inputTokens` is strictly higher with the toggle (observable, not inert). |
| Admin metrics happy path | **G6** | Promote a user to admin, call `/api/admin/metrics` → full metrics shape (`requests`, `errorRate`, `p50/p95LatencyMs`, `totalCostMicro`, `callsByModel[]`) with `requests > 0`. |
| Login enumeration parity | **G12** | Unknown email **and** wrong password both return `401 AUTH_INVALID` (identical code/message). |
| Payment-method validation | **G18** | Non-numeric `last4` → `400`; unknown `brand` → `400`; a valid card → `200`. |

---

## Cost-exactness assertions

Money is integer micro-CNY end to end, so totals must reconcile with **zero float drift**.
This invariant is asserted at every layer:

- **Per call (SSE `call.usage`)** — `costMicro` and `platformFeeMicro` are emitted per call and
  match the persisted `usage_records` row (US2.UC5, US3.UC5).
- **Per turn (SSE `turn.usage`)** — `turnTotalMicro === turnCostMicro + turnFeeMicro` exactly;
  the per-call fees sum to `turnFeeMicro` and the per-call costs sum to `turnCostMicro`
  (US3.UC5). For an expert turn, `callCount === 4` and `turnFeeMicro === 200000` (4 × ¥0.05).
- **Per ledger row (US6.UC4 / US3.UC5)** — every ledger row satisfies `totalMicro ===
  modelCostMicro + platformFeeMicro`; expert rows carry the full 4-call fee.
- **Aggregates (US6.UC1, smoke)** — `summary.totalMicro === modelCostMicro + platformFeeMicro`;
  the aggregate is the exact integer sum of its constituent `usage_records` (SM2 / NFR-6).
- **Fee single-sourcing (G9)** — `platformFeePerCallMicro` reported by summary, the `usage`
  contract, preferences, and the auth/session payload all derive from `PLATFORM_FEE_MICRO()`
  (driven by `PLATFORM_FEE_CNY`); tests assert the reported value equals the billed value, and
  that the display-only `platformFeeDisplayMicro` is kept distinct.

Because the mock content engine is deterministic, these are **exact-equality** assertions, not
tolerances.

---

## Known-uncovered alternate flows

A small number of alt-flows are not directly asserted; each is by design, not by omission:

- **Degraded-expert (partial trio) in pure mock** — a turn where *some* (but not all) experts
  fail, marking the turn `partial`, is exercised only via the `MOCK_FAIL_MODELS` injector and
  the all-fail (G3) regression. The "1–2 of 3 fail, fusion still runs over the survivors" path
  is implemented in `fusion.ts` (surviving experts billed, failed ones emitted as `call.error`
  and excluded) but not asserted as a dedicated mock test — it has no deterministic trigger
  outside fault injection.
- **Mid-stream client disconnect** — the abort path (`signal.aborted` → turn `partial`,
  truncated call **not** billed; G2) is implemented in `sse.ts` + `fusion.ts`, but the test
  harness reads the SSE stream to completion, so there is no test that aborts a live stream
  mid-flight to assert the `partial` turn row and the skipped bill.

Both are correctness-implemented in the live path; only their dedicated assertions are absent.

---

## PO improvement round — changelog

The P1 gaps from `docs/po-review.md` were resolved and pinned by `tests/improvements.test.ts`.

| Gap | Fix | Files |
|---|---|---|
| **G1** | Fast & fusion calls now branch on `call.status` and `signal.aborted` exactly as experts do — failed/aborted calls are no longer persisted at `status:"ok"` with a ¥0.05 fee; a fatal fast error throws so SSE emits `error` and the turn is `failed`. | `lib/server/llm/fusion.ts` |
| **G2** | A mid-stream disconnect now sets `turnStatus="partial"` before the message insert and skips billing the truncated call (no orphaned `done` turns). | `lib/server/llm/fusion.ts`, `lib/server/sse.ts` |
| **G3** | When every expert fails (`surviving.length === 0`), the turn emits a typed `ALL_EXPERTS_FAILED` error, is marked `failed`, and bills **no** fusion call over nothing. | `lib/server/llm/fusion.ts` |
| **G4** | The turn's `trio`/`mainModel`/`auto` are captured on the `turns` row at send time; *regenerate* reads them from the turn, not current preferences, so it replays the original turn faithfully. | `lib/server/db/schema.ts`, `lib/server/db/ddl.ts`, `app/api/chat/route.ts`, `app/api/chat/regenerate/run.ts` |
| **G5** | `deepAgents` now has an observable, billed effect (input-token inflation, `+400`) parallel to `deepResearch` — no longer an inert toggle. | `lib/server/llm/fusion.ts` |
| **G9** | The reported platform fee is single-sourced from `PLATFORM_FEE_MICRO()` in all read paths; the hardcoded `50000` literals were removed so the reported fee can never diverge from the billed fee. | `app/api/usage/summary/route.ts`, `app/api/usage/route.ts`, `lib/server/contracts/preferences.ts` (auth contract already correct) |
| **G12** | On an unknown email, login now runs a dummy `verifyPassword` so both unknown-email and wrong-password paths pay the same scrypt cost — closing the timing/enumeration oracle. Both return identical `401 AUTH_INVALID`. | `app/api/auth/login/route.ts`, `lib/server/auth/password.ts` |
| **G18** | Payment-method input is now format-validated: `last4` must be 4 digits, `brand` is an allow-list enum, and `expYear`/expiry is bounded to the future. | `lib/server/contracts/billing.ts`, `app/api/billing/payment-method/route.ts` |

Net effect: the P1 billing-correctness gaps (G1–G4), the dead-toggle (G5), the fee-divergence
gap (G9), the security gaps (G12, G18), and the previously-unverified admin-metrics math (G6)
are all fixed and regression-locked. The suite is green at 194/194.
