# OmniMind Backend — Product Task Plan

**Status:** Draft for execution · **Date:** 2026-06-18
**Owners:** Backend Engineering + PO
**Frozen inputs:** [tech-stack.md](decisions/tech-stack.md), [llm-sdk-evaluation.md](decisions/llm-sdk-evaluation.md)
**Source of truth:** [PRD.md](PRD.md), [user-stories.md](user-stories.md), [user-stories-part2.md](user-stories-part2.md)

> This plan turns the 10 user stories (50 use cases) into an executable, parallelizable build.
> The Next.js 16 frontend is already built and is the behavioral contract; the backend exists to
> serve it against real persistence, real auth, and real-or-mocked model calls with **zero change
> to observable behavior**. The stack is **frozen** — this plan does not re-open it.
>
> **Execution model:** the build is run by **parallel agent workflows**. Each workstream (WS) is a
> unit a single agent can own end-to-end behind a stable contract. Cross-workstream coupling is
> minimized by landing the **Foundation** (contracts + DB + http wrapper + LLM gateway + logging)
> first, so domain agents work concurrently against frozen interfaces. The **Traceability Matrix
> (§3)** is the master checklist the test team and PO grade against — all 50 rows must go green.

---

## 1. Workstreams / Epics → Stories

Each workstream is an ownable epic. The **Foundation** workstreams (WS-A..WS-D) are shared
infrastructure every story depends on; the **Domain** workstreams (WS-1..WS-10) map 1:1 to the
ten user stories. **WS-T** (tests) and **WS-PO** (review) gate completion.

| WS | Epic | Stories served | Primary modules | Key endpoints |
|----|------|----------------|-----------------|---------------|
| **WS-A** | Contracts & schema foundation | all | `lib/server/db/{client,schema,migrate}.ts`, `lib/server/contracts/*` | — |
| **WS-B** | HTTP wrapper, request-id, envelope, zod boundary | all | `lib/server/http.ts` | — |
| **WS-C** | LLM gateway, registry, router, fusion, mock, cost engine | US2–US6 | `lib/server/llm/{gateway,registry,router,fusion,mock,cost}.ts` | — |
| **WS-D** | Structured logging + activity/usage writers | all, US10 | `lib/server/log/{logger,activity}.ts` | — |
| **WS-1** | Account & Authentication | US1 | `lib/server/auth/{password,session,guard,sso}.ts` | `auth/{signup,login,logout,session,sso}` |
| **WS-2** | Fast-mode single-model chat | US2 | `app/api/chat/route.ts`, `llm/{gateway,router,cost}` | `POST /api/chat` |
| **WS-3** | Multi-expert fusion | US3 | `app/api/chat/route.ts`, `app/api/chat/regenerate/route.ts`, `llm/fusion` | `POST /api/chat`, `POST /api/chat/regenerate` |
| **WS-4** | Intent routing & orchestration | US4 | `app/api/chat/route/route.ts`, `app/api/preferences`, `llm/router` | `POST /api/chat/route`, `GET/PATCH /api/preferences` |
| **WS-5** | Model library management | US5 | `app/api/models`, `llm/registry` | `GET /api/models`, `PATCH /api/models/:id` |
| **WS-6** | Usage & cost analytics | US6 | `app/api/usage/*`, `lib/server/usage/{aggregate,ledger}.ts` | `GET /api/usage/{summary,trend,by-model,ledger,export}` |
| **WS-7** | Billing & subscription | US7 | `app/api/billing/*`, `lib/server/billing/{plans,subscription}.ts` | `GET/POST/PUT /api/billing/*` |
| **WS-8** | Conversations & history | US8 | `app/api/conversations/*` | `GET/POST/PATCH/DELETE /api/conversations*`, `:id/messages` |
| **WS-9** | Preferences & localization | US9 | `app/api/preferences`, `lib/i18n` mirror, `contracts/preferences` | `GET/PATCH /api/preferences` |
| **WS-10** | Activity logging & observability | US10 | `app/api/activity/*`, `app/api/admin/metrics`, `log/*` | `GET /api/activity{,/export}`, `GET /api/admin/metrics` |
| **WS-T** | Test suite (unit + integration + e2e) | all | `tests/**` (Vitest), `e2e/**` (Playwright) | — |
| **WS-PO** | PO acceptance & sign-off | all | the matrix (§3), AC walkthrough | — |
| **WS-DOC** | Docs (`.env.example`, API.md, run/test guides) | all | `docs/`, `.env.example` | — |

---

## 2. Sequenced Build Plan (parallel agent workflows)

Phases are **gates**, not hard serialization beyond the gate boundary. Within a phase, all listed
workstreams run **concurrently** by separate agents against the frozen contracts from the prior gate.

### Phase 0 — Foundation (blocking gate; lands first, single coherent set)
Run **WS-A, WS-B, WS-C, WS-D** to a green "scaffold" state. Nothing in Phase 2+ may begin its
handler work until these interfaces exist and compile.

1. **WS-A — DB & contracts.** Drizzle schema for all entities (PRD §7): `users, sessions,
   preferences, model_state, conversations, messages, subscriptions, invoices, payment_methods,
   activity_logs, usage_records`. Idempotent self-creating migration (NFR-18). All zod contracts
   in `lib/server/contracts/*` (request/response shapes, shared with client).
2. **WS-B — http wrapper.** `withRoute()` assigning `requestId`, auth-guarding, zod-validating,
   timing, emitting the `{ ok, data|error }` envelope and `x-request-id` header (FR-41, US10.UC1).
   This wrapper is the single logging chokepoint (R6 mitigation).
3. **WS-C — LLM gateway.** `gateway.ts` (single call site), `registry.ts` (12 models mirroring
   `lib/models.ts` + `OPENROUTER_MODELS`), `router.ts` (intent rules), `fusion.ts` (reason +
   compile), `mock.ts` (deterministic, `estTok`, wall-clock pacing), `cost.ts` (micro-cent engine
   + ¥0.05/call fee). Registry-sync test seed (R1).
4. **WS-D — logging.** `logger.ts` (stdout JSON) + `activity.ts` (`writeActivity`, `writeUsage`).
   Best-effort, never throws, never blocks response (US10.UC1 alt-flow).

**Foundation exit criteria:** schema migrates on a temp DB; `withRoute` round-trips an envelope
with a logged row; `gateway.complete()` streams deterministic mock tokens with correct token/cost;
registry-sync test passes. The seed script provisions one Pro demo user (A5).

### Phase 1 — Auth (blocking-ish gate)
**WS-1** lands `auth/*` + the five auth endpoints. Auth guards every other route (FR-6), so its
guard contract must be frozen before Phase 2 handlers can assert ownership. SSO stub included.

### Phase 2 — APIs by domain (fully parallel)
Six agents run concurrently, each owning one domain against the frozen Foundation + Auth contracts:

- **WS-5** Models (registry-backed; gates routing/trio/main).
- **WS-4** Orchestration & preferences (router preview + preference persistence; depends on WS-5
  enablement rules and WS-9 preference shape — coordinate on the `preferences` contract owned by WS-A).
- **WS-2** Fast chat (depends on WS-C gateway/router/cost, WS-8 conversation create, WS-D usage).
- **WS-3** Expert fusion + regenerate (depends on WS-2 SSE protocol, WS-C fusion).
- **WS-6** Usage analytics (read-only over `usage_records`; depends on WS-D writes existing).
- **WS-7** Billing (derives month spend from `usage_records`; depends on WS-6 aggregate helper).
- **WS-8** Conversations & history (persistence for chat; WS-2/WS-3 write through it).
- **WS-9** Preferences & localization (preference CRUD + i18n in responses).
- **WS-10** Activity/observability read APIs + admin metrics (reads what WS-B/WS-D write).

> **Coordination seams (declared up front so agents don't block):**
> the `preferences` contract (WS-9 ↔ WS-4), the `usage/aggregate.ts` helper (WS-6 → WS-7),
> the SSE event protocol (WS-2 → WS-3), the registry enablement gate (WS-5 → WS-2/WS-3/WS-4),
> and conversation persistence (WS-8 → WS-2/WS-3). Each seam is a frozen interface from Phase 0/1.

### Phase 3 — Frontend integration
Wire `lib/client/api.ts` typed fetch client to replace the in-memory `lib/store.ts` data paths;
verify the `ViewModel` renders identical values (SM1 byte-for-byte parity). Swap the cosmetic auth
screen to real `/api/auth/*`. SSE consumption in `ChatView` against the real `POST /api/chat`.

### Phase 4 — Tests (WS-T; authored alongside, hardened here)
Unit (cost engine, router, registry-sync, fusion), integration (Route-Handler invocation against
temp libSQL, per the matrix test files), e2e (Playwright against `next dev`). All run with
`LLM_MODE=mock`, zero keys (SM5). See §3 for the per-UC test file.

### Phase 5 — PO review (WS-PO)
PO walks every row of §3, runs the AC (G/W/T) per use case, confirms Definition of Done (§4),
and signs off. Any red row blocks release.

### Phase 6 — Docs (WS-DOC)
`.env.example` (`LLM_MODE`, `AI_GATEWAY_API_KEY`, `PLATFORM_FEE_CNY`, DB url), API reference,
run/test guide, observability notes. Update decisions if any seam changed (it should not).

---

## 3. Traceability Matrix (master checklist — all 50 use cases)

Each row: **use case → API endpoint(s) → server/lib module(s) → verifying test file.** Test files
live under `tests/` (Vitest integration via direct Route-Handler invocation) with cross-cutting
e2e under `e2e/`. The PO and test team grade against this table; every row must be green.

| Use Case | API Endpoint(s) | lib/server Module(s) | Verifying Test File |
|----------|-----------------|----------------------|---------------------|
| **US1.UC1** Sign up | `POST /api/auth/signup` | `auth/password.ts` (scrypt), `auth/session.ts`, `db/schema.ts` (users, sessions), `http.ts`, `log/activity.ts` | `tests/auth/signup.test.ts` |
| **US1.UC2** Log in | `POST /api/auth/login` | `auth/password.ts` (verify), `auth/session.ts`, `http.ts` | `tests/auth/login.test.ts` |
| **US1.UC3** Resolve session (`/me`) | `GET /api/auth/session` | `auth/session.ts` (lookup+expiry+lazy cleanup), `auth/guard.ts` | `tests/auth/session.test.ts` |
| **US1.UC4** Log out | `POST /api/auth/logout` | `auth/session.ts` (delete), cookie clear in `http.ts` | `tests/auth/logout.test.ts` |
| **US1.UC5** SSO stub + validation gate | `POST /api/auth/sso` | `auth/sso.ts` (provider allowlist, upsert), `auth/session.ts`, `contracts/auth.ts` | `tests/auth/sso.test.ts` |
| **US2.UC1** Fast send + stream | `POST /api/chat` (SSE) | `llm/gateway.ts`, `llm/cost.ts`, `conversations` persist (`db/schema.ts`), `log/activity.ts` (usage), stream guard | `tests/chat/fast-stream.test.ts` |
| **US2.UC2** Auto-route by intent | `POST /api/chat` (SSE, `route` event) | `llm/router.ts`, `llm/registry.ts` (enablement), `i18n` route label | `tests/chat/fast-route.test.ts` |
| **US2.UC3** Manual main model (auto off) | `POST /api/chat` | `llm/registry.ts` (availability check), `llm/gateway.ts` | `tests/chat/fast-manual-model.test.ts` |
| **US2.UC4** Copy answer | (client copy) optional `POST /api/activity` | `log/activity.ts` (`chat.copy`, no usage row) | `tests/chat/copy.test.ts` |
| **US2.UC5** Per-turn tokens & cost | `POST /api/chat` (`done.usage`), `GET /api/usage/summary` | `llm/cost.ts` (micro-cents, ¥0.05 fee, default-price fallback), `usage/aggregate.ts` | `tests/chat/fast-cost.test.ts` |
| **US3.UC1** Expert trio in parallel | `POST /api/chat` (expert SSE) | `llm/gateway.ts` (concurrent), `llm/fusion.ts`, `contracts/chat.ts` (trio), `log/activity.ts` (3× expert rows) | `tests/chat/expert-parallel.test.ts` |
| **US3.UC2** Reasoning / thinking trace | `POST /api/chat` (`reason*` events) | `llm/fusion.ts` (`buildReason`), `cost.ts` (reasoningTokens), gating on experts-done | `tests/chat/expert-reason.test.ts` |
| **US3.UC3** Final Compiler synthesis | `POST /api/chat` (`final*` + `done`) | `llm/fusion.ts` (`buildFusion`), `cost.ts` (fusion row, N+1 fees) | `tests/chat/expert-final.test.ts` |
| **US3.UC4** Regenerate an Expert turn | `POST /api/chat/regenerate` | reload turn (`db/schema.ts` messages), `llm/fusion.ts`, stream guard, `log/activity.ts` (fresh usage) | `tests/chat/regenerate.test.ts` |
| **US3.UC5** Per-call accounting (whole turn) | `POST /api/chat`, `GET /api/usage/ledger` | `llm/cost.ts`, `usage/ledger.ts` (4 rows/turn, degraded count) | `tests/chat/expert-accounting.test.ts` |
| **US4.UC1** Auto-route preview | `POST /api/chat/route` | `llm/router.ts`, `llm/registry.ts` (fallback), `i18n` label (no usage row) | `tests/route/route-preview.test.ts` |
| **US4.UC2** Set main model | `PATCH /api/preferences` (or `PATCH /api/models/:id setMain`) | `auth/guard.ts`, `db/schema.ts` (preferences), `llm/registry.ts` (enabled check) | `tests/prefs/set-main.test.ts` |
| **US4.UC3** Configure expert trio | `PATCH /api/preferences` | `contracts/preferences.ts` (3 distinct enabled), `llm/registry.ts` | `tests/prefs/set-trio.test.ts` |
| **US4.UC4** Switch Fast ↔ Expert mode | `PATCH /api/preferences`, then `POST /api/chat` | `db/schema.ts` (preferences.mode), chat branch logic | `tests/prefs/switch-mode.test.ts` |
| **US4.UC5** Toggle auto-routing | `PATCH /api/preferences`, then `POST /api/chat` | `db/schema.ts` (preferences.auto), `llm/router.ts` branch | `tests/prefs/toggle-auto.test.ts` |
| **US5.UC1** List 12 models + metadata | `GET /api/models` | `llm/registry.ts`, `model_state` merge, `i18n` tags | `tests/models/list.test.ts` |
| **US5.UC2** Enable / disable a model | `PATCH /api/models/:id { enabled }` | `db/schema.ts` (model_state), guard (main/trio 409s) | `tests/models/toggle.test.ts` |
| **US5.UC3** Set a model as main | `PATCH /api/models/:id { setMain }` | `db/schema.ts` (preferences.mainModel), `llm/registry.ts` (enabled) | `tests/models/set-main.test.ts` |
| **US5.UC4** Inspect tiers/pricing/context | `GET /api/models` | `llm/registry.ts` (pin/pout/ctx/tier authoritative), `i18n` tags | `tests/models/registry-detail.test.ts` |
| **US5.UC5** OpenRouter gateway list | `GET /api/models?gateway=openrouter` | `llm/registry.ts` (`OPENROUTER_MODELS`), `llm/gateway.ts` (provider/model), `cost.ts` (fallback price) | `tests/models/openrouter.test.ts` |
| **US6.UC1** Usage summary aggregates | `GET /api/usage/summary` | `usage/aggregate.ts`, `contracts/usage.ts` (window) | `tests/usage/summary.test.ts` |
| **US6.UC2** 7-day cost trend | `GET /api/usage/trend?days=7` | `usage/aggregate.ts` (day buckets, zero-fill) | `tests/usage/trend.test.ts` |
| **US6.UC3** Cost-by-model breakdown | `GET /api/usage/by-model` | `usage/aggregate.ts` (group, sort, sharePct), `llm/registry.ts` (name/color) | `tests/usage/by-model.test.ts` |
| **US6.UC4** Per-turn ledger drill-down | `GET /api/usage/ledger` | `usage/ledger.ts` (turn join, distinct models, cursor) | `tests/usage/ledger.test.ts` |
| **US6.UC5** Export usage CSV/JSON | `GET /api/usage/export` | `usage/ledger.ts` (stream rows), CSV/JSON serializer, `log/activity.ts` | `tests/usage/export.test.ts` |
| **US7.UC1** Subscription + credit usage | `GET /api/billing/subscription` | `billing/subscription.ts`, `usage/aggregate.ts` (month-to-date), credit math | `tests/billing/subscription.test.ts` |
| **US7.UC2** List plans | `GET /api/billing/plans` | `billing/plans.ts` (4 plans, current flag, featureKeys) | `tests/billing/plans.test.ts` |
| **US7.UC3** Change / subscribe plan | `POST /api/billing/subscription` | `billing/subscription.ts` (update, ent→contact-sales), `contracts/billing.ts` | `tests/billing/change-plan.test.ts` |
| **US7.UC4** List & download invoices | `GET /api/billing/invoices`, `GET /api/billing/invoices/:id` | `db/schema.ts` (invoices), ownership guard, line items | `tests/billing/invoices.test.ts` |
| **US7.UC5** Top-up + payment method | `POST /api/billing/topup`, `GET/PUT /api/billing/payment-method` | `billing/subscription.ts` (credit, topup invoice), `db/schema.ts` (payment_methods, masked) | `tests/billing/topup-payment.test.ts` |
| **US8.UC1** Create a conversation | `POST /api/conversations` | `db/schema.ts` (conversations), `auth/guard.ts`, title derive | `tests/conversations/create.test.ts` |
| **US8.UC2** List conversations & recents | `GET /api/conversations` | `db/schema.ts` (order by updatedAt, turnCount, preview), cursor | `tests/conversations/list.test.ts` |
| **US8.UC3** Rename a conversation | `PATCH /api/conversations/:id` | ownership guard, title validation, `updatedAt` bump | `tests/conversations/rename.test.ts` |
| **US8.UC4** Delete a conversation | `DELETE /api/conversations/:id` | cascade messages, **retain** usage_records, ownership guard | `tests/conversations/delete.test.ts` |
| **US8.UC5** History + copy/regenerate | `GET /api/conversations/:id/messages`, `POST /api/chat` (regenerate) | message rehydrate (single/experts/fusion + perTurn), regenerate path | `tests/conversations/history.test.ts` |
| **US9.UC1** Get preferences | `GET /api/preferences` | `db/schema.ts` (preferences), lazy default backfill | `tests/prefs/get.test.ts` |
| **US9.UC2** Set theme | `PATCH /api/preferences { theme }` | `contracts/preferences.ts` (partial), upsert | `tests/prefs/theme.test.ts` |
| **US9.UC3** Set language (4-lang i18n) | `PATCH /api/preferences { lang }` | `contracts/preferences.ts` (4 tags), `i18n` future-turn content | `tests/prefs/lang.test.ts` |
| **US9.UC4** Toggle Deep Research / Agents | `PATCH /api/preferences { deepResearch, deepAgents }` | preferences upsert, turn annotation echo | `tests/prefs/deep-toggles.test.ts` |
| **US9.UC5** Configure defaults | `PATCH /api/preferences { defaultMode, defaultLang, platformFeeDisplayMicro }` | preferences upsert, **display-only fee** invariant (billed = `PLATFORM_FEE_CNY`) | `tests/prefs/defaults.test.ts` |
| **US10.UC1** Auto-log every request | (all routes; verified via `GET /api/activity`) | `http.ts` (`withRoute`), `log/activity.ts` (`writeActivity`), `x-request-id` | `tests/activity/request-logging.test.ts` |
| **US10.UC2** Log usage/cost/latency per call | (all chat; verified via `GET /api/usage/ledger`) | `llm/gateway.ts` (usage capture), `cost.ts`, `log/activity.ts` (`writeUsage`, estimate flag) | `tests/activity/usage-logging.test.ts` |
| **US10.UC3** Query activity logs | `GET /api/activity` | `db/schema.ts` (activity_logs), `contracts/activity.ts`, user-scoping/admin guard | `tests/activity/query.test.ts` |
| **US10.UC4** Export logs & usage | `GET /api/activity/export` | activity/usage stream, CSV/JSON, scope guard | `tests/activity/export.test.ts` |
| **US10.UC5** Admin metrics | `GET /api/admin/metrics` | `auth/guard.ts` (admin role), aggregate (errorRate, p50/p95, by-model/action) | `tests/activity/admin-metrics.test.ts` |

**Cross-cutting verifications (graded in addition to the 50 rows):**
- `tests/llm/registry-sync.test.ts` — server registry == `lib/models.ts` ids/prices/tiers (R1, SM1).
- `tests/llm/cost-engine.test.ts` — micro-cent math, ¥0.05/call, zero aggregate drift (SM2, NFR-6/7).
- `tests/llm/router.test.ts` — full intent→model table incl. fallback on disabled (FR-13).
- `tests/foundation/envelope-and-logging.test.ts` — every request → one activity row, `x-request-id` (SM4).
- `e2e/auth-chat-usage-billing.spec.ts` — Playwright happy path across all four views (SM1, SM3).

---

## 4. Definition of Done (per use case)

A use case is **Done** only when **all** of the following hold. The PO checks each box per row in §3.

**Universal DoD (every UC):**
1. **Endpoint(s) implemented** exactly as named in §3, using the `{ ok, data|error }` envelope and
   correct HTTP status + error `code` for every documented alt/error flow.
2. **zod-validated** request body/query at the boundary; invalid input → `400 VALIDATION_ERROR`
   with field `details`.
3. **Auth + ownership** enforced: protected routes return `401 UNAUTHENTICATED` without a session;
   resources are scoped to `session.userId` (no cross-user leakage); admin-only routes `403` otherwise.
4. **Activity logged:** exactly one `activity_logs` row per request with the documented `action`,
   `status`, measured `latencyMs ≥ 0`, and `x-request-id` on the response (US10.UC1 invariant).
5. **i18n correct:** any user-facing string honors `lang ∈ {zh, zh-TW, en, ja}` with `en→zh`
   fallback; money/number/time match `fmtMoney`/`fmtNum`/`fmtTime` byte-for-byte (SM1, NFR-19).
6. **Verifying test passes** (the §3 file) under `LLM_MODE=mock` with **zero provider keys** (SM5),
   covering the use case's main flow **and** every listed alt/error flow and all G/W/T acceptance
   criteria from the story doc.
7. **No regression:** the cross-cutting tests stay green; UI parity preserved (SM1).

**Use-case-specific DoD additions (the load-bearing extras):**
- **US1.*:** passwords scrypt-hashed (never logged/returned); cookie `httpOnly; SameSite=Lax`
  (`Secure` in prod); login is enumeration-safe (identical message/timing for unknown-email vs
  bad-password); logout idempotent; expired sessions lazily deleted on read; SSO body carries
  `sso.stub === true`.
- **US2.* / US3.*:** turn streams via SSE with the typed event protocol; **one** `usage_records`
  row per model call (`single` / `expert` / `fusion`); per-turn footer = Σ(cost) + `callCount × ¥0.05`,
  **byte-identical** to the UI; concurrent send → `409 STREAM_IN_PROGRESS`; expert calls run
  concurrently and fusion gates on experts-done; degraded turn bills only calls that ran;
  regenerate writes fresh usage and keeps the assistant message id.
- **US4.* / US5.*:** routing/trio/main can only select **enabled** models; disabling main → `409
  CANNOT_DISABLE_MAIN`, disabling a trio member → `409 MODEL_IN_TRIO`; exactly one model `isMain`;
  registry is authoritative and equals `lib/models.ts` (sync test green).
- **US6.*:** all amounts derived server-side from `usage_records` in micro-cents; trend always
  returns exactly `days` zero-filled buckets oldest→newest; by-model sorted desc with `sharePct`
  summing ~100%; ledger ownership-scoped with stable cursor paging; export streamed (no full buffer).
- **US7.*:** month-to-date derived from `usage_records` (current calendar month); Pro included
  credit = ¥150; `usedPct` clamped to 100%, `remaining = max(0, included − used)`; Enterprise never
  auto-provisions (contact-sales); top-up creates a `paid` topup invoice and raises balance; payment
  method stores **only** masked display fields (no PAN/CVV ever).
- **US8.*:** ownership-scoped CRUD; delete cascades messages but **retains** `usage_records` so
  billing totals are unchanged; history rehydrates persisted call text (single/experts/fusion +
  `perTurn` totals) without re-streaming.
- **US9.*:** preferences persist per user and are returned by `me`; partial PATCH validated;
  `platformFeeDisplayMicro` is **display-only** — billed `usage_records.platformFeeMicro` always
  equals `PLATFORM_FEE_CNY`.
- **US10.*:** request logging never throws/blocks the response (best-effort, stderr on failure);
  every model call has a `usage_records` row (estimate-flagged when provider gives no usage);
  non-admin queries force-scoped to own rows; admin metrics derive purely from
  `activity_logs` + `usage_records`.

---

## 5. Risk & Sequencing Notes

**Sequencing risks**
- **S1 — Foundation must land first.** WS-A/B/C/D are a hard gate (Phase 0). Starting domain
  handlers before the http wrapper + logging chokepoint exists scatters logging across handlers and
  breaks SM4. *Mitigation:* gate Phase 2 on Foundation exit criteria; logging lives only in
  `http.ts` + the single `gateway.ts` call site (R6).
- **S2 — Auth gates everything.** FR-6 means every Phase-2 handler asserts the guard contract.
  *Mitigation:* freeze `auth/guard.ts` in Phase 1 before parallel domain work; domain agents import,
  never re-implement, the guard.
- **S3 — Shared-contract seams.** `preferences` (WS-9↔WS-4), `usage/aggregate.ts` (WS-6→WS-7),
  the SSE protocol (WS-2→WS-3), the registry enablement gate (WS-5→WS-2/3/4), and conversation
  persistence (WS-8→WS-2/3) are the parallelism fault lines. *Mitigation:* WS-A owns the zod
  contracts and the schema for these seams in Phase 0; they are frozen before Phase 2 forks.
- **S4 — Chat is the deepest dependency chain.** WS-2 → WS-3 (fusion reuses Fast's SSE harness) →
  regenerate → US8 history rehydrate → US6/US7 aggregates. *Mitigation:* land Fast (WS-2) first
  within Phase 2; WS-3 extends rather than rewrites the stream loop.

**Product / correctness risks (from PRD §9, mapped to where they bite)**
- **R1 Registry drift → wrong cost.** One authoritative server registry; `registry-sync.test.ts`
  asserts equality with `lib/models.ts`. Blocks US2.UC5, US5.*, US6.*.
- **R2 Cost rounding drift.** Micro-cent integers end-to-end; `cost-engine.test.ts` + SM2 zero-drift
  over a randomized turn sequence. Blocks US2.UC5, US3.UC5, US6.*, US7.*.
- **R3 Streaming under proxies/serverless.** Node runtime, no full-buffering, heartbeats (NFR-2),
  Fluid-Compute-compatible handlers. Blocks US2.*, US3.*.
- **R4 Token mismatch mock vs gateway.** Mock uses `estTok`; gateway uses SDK `usage`; both flow
  through one cost engine. Tests assert exact values **only** in mock mode (SM5).
- **R5 Partial expert failure.** Graceful degradation — fuse survivors, log partial, bill completed
  calls. Verified in US3.UC1/UC5 degraded-path tests.
- **R6 Observability gaps.** Logging in the shared wrapper + single gateway call site, not per
  handler. SM4 coverage test (`foundation/envelope-and-logging.test.ts`). Blocks US10.*.
- **R7 SSO mistaken for real auth.** Stub is contract-only (NG3), flagged `sso.stub:true`, behind a
  flag; production handshake scoped later without breaking the contract.

**Parallelization notes**
- After Phase 1, **WS-5, WS-9, WS-6, WS-8, WS-10** have no inter-dependencies beyond Foundation and
  can run fully in parallel from the start of Phase 2.
- **WS-2 → WS-3** is the one intentional intra-phase ordering (Fast before Expert); everything else
  forks immediately.
- **WS-7** depends only on `usage/aggregate.ts` (WS-6) + its own tables — it can start as soon as the
  aggregate helper's signature is frozen (Phase 0), without waiting for WS-6's endpoints.
- **WS-T** authors tests **alongside** each domain agent (test file names are pre-allocated in §3),
  then hardens in Phase 4; it does not wait for all domains to finish.
- **WS-PO** runs continuously as rows go green, with a final full sweep in Phase 5; a red row or a
  failing cross-cutting test (registry-sync, cost-engine, logging-coverage) blocks release.
