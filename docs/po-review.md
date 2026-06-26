# OmniMind Backend — Product-Owner Review (Authoritative)

**Reviewer:** Product Owner (synthesis of 6 critic dimensions + independent spot-checks against code)
**Scope reviewed:** PRD + 10 user stories (×5 UC = 50 use cases), architecture, technical-design contract,
task plan, `lib/server/**` foundation, `app/api/**` (30 route handlers), `tests/**`, and the
backend↔frontend integration seam.
**Suite status (re-run by PO):** `npx vitest run` → **11 files, 187/187 passing**, 1.07s.

---

## 1. Executive verdict

OmniMind's backend is a **genuinely strong, internally consistent delivery** that meets the spirit of
nearly every functional requirement: all 50 use cases have a real endpoint and at least one asserting
test, the money domain is integer micro-CNY end-to-end with zero float drift on persisted rows, ownership
scoping is uniformly leak-proof (`404`/`403`, no existence enumeration), and the mandatory
"log every activity / token / cost / latency" requirement is genuinely pervasive through a single shared
wrapper. The defects are concentrated, not systemic, and cluster into four themes: **(a) the live LLM path
over-bills and mis-states turn status on the unhappy branches** (aborted streams, failed fast/fusion calls,
and all-experts-fail are billed at `status:"ok"` with a full ¥0.05 fee and persisted as `done`,
contradicting the documented disconnect/degradation contract); **(b) two functional toggles are effectively
inert** (`deepAgents` is persisted but never read; regenerate replays *current* preferences rather than the
*original* turn's trio/compiler because those were never stored on the turn); **(c) pervasive
frozen-doc↔code drift** (auth error codes/plan in the user stories, the cost formula vs. reasoning-token
billing, hardcoded vs. configurable platform fee, phantom env vars, a registry-sync test the docs promise
but that does not exist); and **(d) the product is not yet end-to-end** — the auth screen is now wired, but
the store still simulates chat locally and the analytics/billing/conversations views render hardcoded data,
so nothing persists across reload. None of these is a security P0. The integration gap and the unhappy-path
billing correctness are the two items standing between "excellent prototype" and "shippable product."

**Overall score: 82 / 100** — *GO WITH FIXES.*

| Dimension | Sub-score | One-line rationale |
|---|---:|---|
| Use-case correctness & coverage | 85 | All 50 UCs wired + tested; weak spots are alt-flows untestable in mock and regenerate fidelity. |
| PRD/functional completeness | 84 | All 46 FRs have a handler; `deepAgents` inert, all-fail fusion unguarded, several verb/URL drifts. |
| Security & data integrity | 88 | No P0; strong auth/ownership/injection posture; gaps are timing oracle, no rate-limit, unvalidated card fields. |
| Observability & cost exactness | 80 | Drift-free for persisted rows + real per-request/per-call logging; live path over-bills on failures/aborts. |
| Product/frontend integration | 62 | Backend cleanly mirrors the UI; auth now wired, but chat + all data views still client-simulated. |
| Code quality & doc accuracy | 86 | Clean single-envelope code, ~zero `any`; almost all findings are doc drift, two are real code inconsistencies. |

> **PO correction to the critics:** the Integration report's **P0-2 ("auth page is a pure simulation,
> never calls the API")** is now **stale/inaccurate**. `components/AuthScreen.tsx:171,173,195` genuinely
> calls `api.auth.login/signup/sso` and `goToApp()` on success. P0-1 (store/data views unwired) and P0-3
> (no session guard on `/`) remain valid — verified `lib/OmniContext.tsx:30` only calls
> `store.seedInitial()`, `lib/store.ts:161-194` still uses `buildAnswer/buildReason/buildFusion` +
> `setInterval`, and `app/page.tsx` renders `<OmniApp/>` unconditionally.

---

## 2. Top strengths (genuinely meets "highest expectation")

- **Exact, integer-clean cost accounting with zero drift.** `cost.ts:28-30` =
  `round(in×pin) + round((out+reason)×pout)`; every aggregator (`usage/aggregate.ts`, `admin/metrics`,
  `usage/export`, per-turn rollups) **sums the stored integer columns** rather than re-deriving from
  tokens, so per-call rounding can never disagree with the rollup. Proven end-to-end across us2/us3/us6/us8.
  The seed path uses the *same* `billCall` as the live path, so demo history reconciles byte-for-byte.
- **Pervasive observability is real (NFR-13, FR-41/42).** Exactly one `activity_logs` row per served
  request — success, 4xx, **and** 5xx — written in the shared wrapper outside the try/catch
  (`http.ts:110-126`), with latency, route, method, status, `x-request-id`; one `usage_records` row per
  model call from the single gateway call-site. Logging is failure-isolated (`writeActivity` swallows its
  own errors) and mirrored to stdout JSON. This is the standout part of the delivery.
- **Security posture is strong for the stage.** Single `route()` wrapper centralizes auth + zod validation
  + error→envelope + logging; `assertOwner()` collapses missing-or-not-owned to `404` (no enumeration);
  IDOR-prone chat/regenerate re-check `userId`/`conversationId` server-side; admin endpoints are
  double-gated; all DB access is parameterized Drizzle; scrypt + `timingSafeEqual`; correct cookie flags.
  **No P0 security issues.**
- **Clean, consistent code.** One envelope, one `ApiError` path, integer micro-CNY everywhere, near-zero
  `any`, every input zod-validated. 30 handlers follow the same shape.
- **The contract was clearly designed against the ViewModel.** The SSE event set maps almost 1:1 onto the
  store's `StreamCall`/`FusionState` fields, a complete typed client (`lib/client/api.ts`) already exists,
  and the model catalog is single-sourced (server registry re-exports `lib/models.ts`) so client/server
  ids/prices/colors cannot drift. The hard design work is done and correct.

---

## 3. Deduplicated, prioritized gap list

Merged across all six critics; duplicate findings collapsed to one row with all evidence. Severity is the
PO's adjudicated level (occasionally raised/lowered from the originating critic).

| ID | Sev | Title | Evidence (file:line) | Recommendation | Owner-area |
|----|-----|-------|----------------------|----------------|------------|
| **G1** | **P1** | **Live path over-bills failed & aborted calls at `status:"ok"` with full ¥0.05 fee.** Fast/single (`fusion.ts:115`) and fusion (`fusion.ts:213`) never inspect `call.status`; on a gateway error (`gateway.ts:35`) or a client-abort `break` (`gateway.ts:42` → returns `"ok"`) they still `persistUsage(..., "ok")` + fee. Only the expert branch checks status. | `lib/server/llm/fusion.ts:106-126,190-231`; `lib/server/llm/gateway.ts:33-46`; contract `technical-design.md:847,859-861` | Branch on `call.status` for single & fusion exactly as experts do: on error skip the row (or write `status:"error"`, `cost=0`, `fee=0`); for a fatal fast error, throw so SSE emits `error` and the turn is `failed`. After each `streamOne`, check `signal.aborted`; do not bill truncated calls. Add regression tests. | LLM/billing |
| **G2** | **P1** | **Disconnected/aborted turn is persisted as `done`, not `partial`.** `turnStatus` is only ever flipped to `partial` by an *expert error* (`fusion.ts:165`), never by an abort; `runTurn` runs to completion and writes `status` from `turnStatus` regardless of `signal`. Violates NFR-17 "no orphaned in-flight turns, marked partial." | `lib/server/llm/fusion.ts:41-281,264`; `lib/server/sse.ts:46-49`; `technical-design.md:859-861` | After abort, stop launching further calls and set `turnStatus="partial"` before the message insert. Add a mid-stream-disconnect test asserting the turn row is `partial` and no fee was charged for the truncated call. | LLM |
| **G3** | **P1** | **All-experts-fail still runs and bills a fusion call over nothing.** With `surviving.length===0` there is no guard (`fusion.ts:164-165`); execution falls through to fusion, bills `fusionInput=200+0`, a ¥0.05 fee, and emits a normal `turn.done`. | `lib/server/llm/fusion.ts:164-231` | When `surviving.length===0`, emit a typed `error` (`ALL_EXPERTS_FAILED`), set turn `failed`, bill no fusion call. Add a test for the all-fail case. | LLM |
| **G4** | **P1** | **Regenerate replays *current* preferences, not the *original* turn's trio/compiler (US3.UC4 / US8.UC5).** `regenerate/run.ts:51` calls `resolveSettings(db,userId,{})` (empty body → falls back to `preferences` trio/main, `chat-helpers.ts:64-72`); the `turns` table stores `mode/promptText/routeText/deep*` but **not** `trio`/`mainModel` (`ddl.ts:61-72`). If the user edited their trio between send and regen, a *different* trio/compiler runs silently. The us3 test asserts only call counts, not model ids, so it's blind to this. | `app/api/chat/regenerate/run.ts:51`; `lib/server/db/ddl.ts:61-72`; `lib/server/contracts/chat-helpers.ts:64-72`; `tests/us3-expert-fusion.test.ts:279-304` | Persist `trio_json` + `main_model` on the `turns` row at send time; in regenerate read them from the turn, not preferences. Add a test asserting the regenerated trio == original after changing the pref trio. | DB/LLM |
| **G5** | **P1** | **`deepAgents` flag is completely inert (FR-39, US9.UC3).** Validated, persisted, returned, threaded into `RunTurnCfg.deepAgents` (`fusion.ts:28`) — but **never read** in the run logic; only `deepResearch` affects anything (`inflate`, `fusion.ts:39`). | `lib/server/llm/fusion.ts:28,39`; grep: `deepAgents` absent from run logic | Give `deepAgents` an observable effect (annotation and/or input-token inflation) parallel to `deepResearch`, or explicitly document it as persistence-only in v1. | LLM/PRD |
| **G6** | **P1** | **Admin-metrics happy path (US10.UC5) entirely unverified.** Only `403`/`401` guards are tested; **no admin user is ever created** in seed or tests, so the percentile/`errorRate`/`callsByModel`/`requestsByAction` math runs zero times. | `tests/us10-observability.test.ts:275-296`; `app/api/admin/metrics/route.ts`; no `role="admin"` writer in tests | Add a test-only admin promotion (direct `users.role` update via the test DB handle) and assert the metrics payload shape + known counts + `errorRate` over seeded 4xx/5xx rows. | Tests |
| **G7** | **P1** | **DOC↔CODE: cost formula omits reasoning tokens but code bills them.** Frozen contract §0 line 25 / §3.5 line 707 define cost as `round(in×pin)+round(out×pout)` (no reasoning term); code bills `(out+reason)×pout` (`cost.ts:28-30`). Every expert turn's fusion cost exceeds the documented formula. Real cross-file inconsistency, not just prose. | `docs/technical-design.md:25,707`; `lib/server/llm/cost.ts:28-30` | Decide intent; if reasoning is billable, update §0/§3.5 to `round(in×pin)+round((out+reason)×pout)`. Otherwise drop the term from cost.ts. | Docs/billing |
| **G8** | **P1** | **DOC↔CODE: user-stories prose uses wrong auth codes & plan.** `user-stories*.md` say `plan:"free"`, `409 EMAIL_TAKEN`, `401 INVALID_CREDENTIALS`, `401 UNAUTHENTICATED`; handlers emit `plan:"pro"`, `AUTH_EMAIL_TAKEN`, `AUTH_INVALID`, `AUTH_REQUIRED`. PRD already uses the correct codes — contract self-contradicts. | `user-stories.md:77,80,84,85,101,106,120…`; `auth/signup/route.ts:27,65`; `auth/login/route.ts:19,30`; `http.ts:91` | Global-replace the four mismatches in `user-stories*.md` to match the handlers (the implemented behavior is correct). | Docs |
| **G9** | **P1** | **`platformFeePerCallMicro` hardcoded `50000` in 3 read paths — diverges from the configurable billed fee.** Billed fee derives from `PLATFORM_FEE_CNY` (`cost.ts:15-18`) but reported fee is a literal in summary/usage/preferences. If the env is ever changed, UI fee silently disagrees with billed fee. | `app/api/usage/summary/route.ts:7`; `app/api/usage/route.ts:7`; `lib/server/contracts/preferences.ts:45` | Have all three read `PLATFORM_FEE_MICRO()` (auth contract already does, `contracts/auth.ts:82`); delete the literals. | Billing |
| **G10** | **P1** | **Backend↔frontend integration incomplete: store + data views still client-simulated.** `OmniContext.tsx:30` only `seedInitial()` (fake ledger); `store.ts:161-194` chat is fabricated via `buildAnswer/Reason/Fusion` + `setInterval`, never calls `streamChat`; `viewModel.ts:449,572,594` recents/plans/invoices hardcoded; `app/page.tsx` renders `<OmniApp/>` with no session guard. *(Auth screen itself IS now wired — corrects Integration P0-2.)* Nothing persists across reload. | `lib/OmniContext.tsx:30`; `lib/store.ts:161-194`; `lib/viewModel.ts:449,572,594`; `app/page.tsx:1-5` | Execute the integration wiring plan: replace store `send/regenerate` with a `streamChat`/`streamRegenerate` SSE consumer (delete the typewriter); add a session bootstrap + auth guard on `/`; add an adapter mapping server DTOs → the client `Aggregate`/`LedgerRecord` shapes (micro→¥); hydrate prefs/models/conversations/usage/billing. | Frontend/integration |
| **G11** | **P1** | **ViewModel↔DTO field/unit mismatch (silent `NaN`/¥0 risk on naive wiring).** VM reads `agg.tin/agg.mc/perArr[].cost/days[].val` in float-¥; server returns `inputTokens/modelCostMicro/totalMicro` in integer micro with different names. None of the VM field names exist in the DTOs. | `lib/viewModel.ts:478-526` vs `lib/server/usage/aggregate.ts:13-130` | Add `lib/client/adapters.ts` mapping each DTO → the client shape, dividing micro by 1e6. Prefer server-authoritative usage/cost over client recomputation. | Frontend |
| **G12** | **P1** | **Login timing oracle re-enables user enumeration.** Unknown email short-circuits before scrypt (`login/route.ts:18` → `verifyPassword` never runs), so latency differs by the scrypt cost; the design explicitly promises equivalent timing. | `app/api/auth/login/route.ts:18`; `lib/server/auth/password.ts:15`; `technical-design.md:736-740` | On null user, run a dummy `verifyPassword` against a fixed throwaway hash so both paths pay the same CPU. | Security |
| G13 | P2 | Fast mode never emits `answer.delta`; contract §6 says it should. Today low-impact (delivered FE doesn't consume named SSE) but breaks any contract-coded client. | `lib/server/llm/fusion.ts:112`; `technical-design.md:838,853-854` | Emit `answer.delta` on the fast single answer, or correct §6/FR-10 to "fast uses `call.delta` only." | LLM/docs |
| G14 | P2 | `usage_records` insert (`writeUsage`) has no failure isolation; a mid-turn insert throw leaves a turn stuck in `streaming` with partial billing, blocking the conversation's single-flight. | `lib/server/log/activity.ts:70-90`; `lib/server/llm/fusion.ts:69-85` | Persist usage rows + message + status in one transaction, or set `turns.status='failed'` in a `finally`; add a stale-streaming sweeper. | LLM/DB |
| G15 | P2 | Deep Research produces no backend research-step output (only a +600 input-token bump); UI parity survives only because the FE renders static i18n steps gated on the flag. | `lib/server/llm/fusion.ts:39`; `lib/server/llm/mock.ts:14-28`; `lib/viewModel.ts:122,350` | Emit a `research.step` event + persist steps in the payload, or tighten FR-39's wording. | LLM/PRD |
| G16 | P2 | Copy beacon logs `action="activity.ping"` (real action in `meta`), but US2.UC4/§2.2/US10.UC3 filter expect `chat.copy`/`result.copy`; `action=` filter never matches copy events. | `app/api/activity/route.ts:20,24`; `technical-design.md:457` | Pass the body action through as the activity action, or update §2.2/§2.9 + the story AC. | Observability |
| G17 | P2 | Request-level latency for chat/regenerate is ~0 (wrapper logs after returning the SSE `Response`; the stream body runs after). Per-call latency is correct. | `lib/server/http.ts:107-127` | Record latency inside the stream `finally` for streaming routes, or document the limitation. | Observability |
| G18 | P2 | Card fields stored without format validation: `last4` length-only (not digits), `brand` no allow-list, `expYear` unbounded; flows into the FE billing view. | `lib/server/contracts/billing.ts:24`; `app/api/billing/payment-method/route.ts:38` | `last4: regex(/^\d{4}$/)`, `brand` enum, bound `expYear`. | Security |
| G19 | P2 | No rate limiting on login/signup/topup; no CSRF token (Lax-only). Acceptable for prototype; must be a pre-prod gate. | `lib/server/**` (no limiter); `lib/server/auth/session.ts:36` | Add per-IP/account throttling on auth+money endpoints; document the Lax-only stance or add double-submit token. | Security |
| G20 | P2 | DOC↔CODE phantom config: `SESSION_TTL_MS` & `SEED_PLAN` documented but never read; `MOCK_STREAM_CPS` default doc=360 vs code=900; `MOCK_STREAM_DELAY_MS`/`SEED_DEMO` undocumented; mock is a plain generator, not `MockLanguageModelV2`. | `technical-design.md:43,46,44`; `lib/server/auth/session.ts:7-8`; `lib/server/db/seed.ts:35,95`; `lib/server/llm/mock.ts:33-47` | Read the env vars or delete the rows; fix the mock CPS default and document the actual generator + flags. | Docs |
| G21 | P2 | DOC↔CODE: documented registry-sync drift-guard test (R1) does not exist; registry is a re-export so nothing drifts today, but the promised safety net is absent. | `technical-design.md:608,879`; `lib/server/llm/registry.ts:1-8` | Add the trivial sync test, or update §3.1/§7 to state it's a direct re-export. | Tests/docs |
| G22 | P2 | DOC↔CODE: gateway-mode `usageEstimated` flag never set on token fallback, so estimated calls are indistinguishable from measured (defeats US10.UC2 audit trail). | `technical-design.md:719-720`; `lib/server/llm/gateway.ts:62-69` | Thread `usageEstimated` through to `usage_records.meta`, or remove the claim. | LLM/docs |
| G23 | P2 | Spec-vs-code drifts (each trivial): signup returns 200 vs US1.UC1's 201 (`signup/route.ts:62` `json()` default); `payment-method` is `PUT` not `PATCH` per FR-30 (`route.ts:24`); Enterprise change throws `409` vs FR-31's "no-op record"; `402 PAYMENT_FAILED` is dead (`topup/route.ts:18` `charged=true`); plan-change doesn't reset `renewsOn`/period (`subscription/route.ts:88-91`); CSV export missing `mode`/`modelName`/`¥` columns; `turns.route_text` always `null`; activity export URL is sub-route vs `?export=`; `as PlanId`/`as Lang` unchecked casts; `MODEL_DISABLED` 409 vs US4.UC2's `400 MODEL_NOT_AVAILABLE`. | per-item above | Pick code-or-doc as source of truth per item and reconcile; most are one-line edits. | Mixed |
| G24 | P2 | SSE error frames forward raw `Error.message` for unexpected throws (JSON path collapses to "Internal error"); inconsistent leakage surface. | `lib/server/sse.ts:31-36` vs `lib/server/http.ts:62-63` | Forward `message` only for `ApiError`; otherwise generic + server-side log. | Security |

**Counts (deduplicated):** P0 = 0 · **P1 = 12** · P2 = 12.

> Note on critic divergence: the Integration critic logged 3 P0s; the PO downgrades all three —
> P0-2 is **stale** (auth is wired), and P0-1/P0-3 are real but are *product-incompleteness*, not backend
> blockers, and are folded into **G10**. No reviewer found a true P0 in the backend itself.

---

## 4. GO / NO-GO recommendation

### Verdict: **GO WITH FIXES.**

The backend is acceptance-worthy as a backend deliverable — all 50 use cases are implemented and tested,
the suite is green, money math and observability are correct on the happy path, and security has no
blockers. It is **not yet a shippable product** because the unhappy-path billing is wrong and the React app
is still simulating chat + analytics. Neither is a structural redesign; both are bounded, well-understood
work against an already-correct contract.

**Minimal set to reach "highest expectation" (must-fix before sign-off):**

*Correctness / money integrity (non-negotiable — these silently over-charge users):*
1. **G1** — stop billing failed/aborted calls at `status:"ok"` + fee.
2. **G2** — mark disconnected turns `partial`, not `done`.
3. **G3** — guard `surviving.length===0`; don't bill a fusion over nothing.
4. **G4** — persist the turn's trio/compiler and regenerate against *that*, not current prefs.
5. **G9** — single-source the reported platform fee; and **G7** — reconcile the cost formula doc with the
   reasoning-token billing (both feed the "cost exactness" guarantee).

*Functional honesty:*
6. **G5** — make `deepAgents` do something observable, or document it as v1-inert (don't ship a dead toggle
   that the UI presents as functional).
7. **G6** — add the admin-metrics happy-path test so the analytics math is actually verified.

*Contract hygiene (cheap, high-trust-impact):*
8. **G8** — fix the auth code/plan drift in the user stories.

*Security parity claim:*
9. **G12** — close the login timing oracle so the no-enumeration promise holds.

*Product (required for an end-to-end demo, can run in parallel):*
10. **G10 + G11** — wire the store to `streamChat`, add the session guard, and add the DTO→ViewModel adapter.

All remaining P2s (G13–G24) are accept-now / fast-follow; they are mostly doc edits and hardening, none
affect correctness of a happy-path turn.

---

## 5. "Definition of done met?" checklist (vs. the user's original asks)

| Ask | Status | Note |
|---|---|---|
| PRD authored | ✅ Met | 46 FRs + NFRs; all FRs have a handler. |
| 10 user stories × 5 use cases (50 UCs) | ✅ Met | Every UC has a real endpoint **and** ≥1 asserting test; a handful of alt-flows are untestable in mock (G6, degraded-expert). |
| Architecture doc | ✅ Met | Accurate to the implemented shape. |
| Technical design / contract | ⚠️ Mostly | Solid, but several frozen-doc↔code drifts (G7, G8, G13, G16, G20–G23). Code is usually the better source. |
| Task plan / traceability matrix | ✅ Met | Maps stories→tasks; matches delivery. |
| Backend implemented | ✅ Met | 30 route handlers + foundation; clean, consistent, parameterized. |
| Tests pass | ✅ Met | **187/187 green** (PO re-ran). Coverage real, with named gaps (admin happy path, mid-stream disconnect, regenerate fidelity, all-fail). |
| Log every activity | ✅ Met | One `activity_logs` row per served request incl. 4xx/5xx, failure-isolated, `x-request-id`. |
| Log tokens / cost / latency | ✅ Mostly | One `usage_records` row/call with in/out/reason tokens, costMicro, fee, latency. Caveat: live path writes failed/aborted calls as `"ok"` (G1) and request-level chat latency ≈0 (G17). |
| SDK evaluation recorded | ✅ Met | `decisions/llm-sdk-evaluation.md` + `tech-stack.md` present. |
| Docs + prompts recorded | ✅ Met | Decision docs + gateway prompt builders captured (`gateway.ts:72-81`); mock content engine documented. |
| **Product is end-to-end functional** | ❌ **Not met** | Auth is wired; chat + analytics + billing + conversations remain client-simulated; no session guard (G10, G11). |

---

**One-line verdict:** **GO WITH FIXES — overall 82/100; 0 P0, 12 P1, 12 P2.** Excellent, well-tested,
observable backend with drift-free money math, but it over-bills failed/aborted/all-fail turns at full fee,
ships an inert `deepAgents` toggle and an infidelitous regenerate, carries notable frozen-doc↔code drift,
and is not yet end-to-end (store/analytics still simulated); fix the 12 P1s — chiefly the unhappy-path
billing (G1–G4), fee/cost doc reconciliation (G7/G9), and the integration wiring (G10/G11) — to reach
"highest expectation."
