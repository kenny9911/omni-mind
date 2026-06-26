# OmniMind Backend — Product Requirements Document

**Product:** OmniMind (多模型智能融合平台) — backend services
**Status:** Draft for implementation · **Date:** 2026-06-18
**Owners:** Backend Engineering
**Frozen inputs:** [tech-stack.md](decisions/tech-stack.md), [llm-sdk-evaluation.md](decisions/llm-sdk-evaluation.md)

> This PRD specifies the **backend** for OmniMind. The Next.js 16 + React 19 + TypeScript
> **frontend is already built and is the source of truth** for required behavior. Every
> backend capability below exists to serve a behavior the UI already performs against an
> in-memory store (`lib/store.ts`, `lib/viewModel.ts`). The job of the backend is to make
> that UI work against real persistence, real auth, and real (or deterministically mocked)
> model calls — with no change to the product's observable behavior. Stack choices are
> **frozen**; this document does not re-open them.

---

## 1. Overview & Vision

OmniMind is a compound, multi-agent LLM platform. It either **routes a prompt to the single
best model** (快速模式 / Fast) or **fuses a trio of expert models in parallel** (多专家模式 /
Multi-expert): the experts stream answers, a reasoning/thinking trace narrates how their
strongest points are reconciled, and a **Final Compiler** model rewrites one consolidated
answer. Across both modes, every model call is metered to the token with a per-call platform
fee, and all activity is logged.

The frontend already renders all of this. The backend must:

1. **Authenticate** users with real, session-based accounts (replacing the cosmetic auth screen).
2. **Run real orchestration** — intent routing, single-model Fast turns, and parallel
   Multi-expert turns with a reasoning trace and Final Compiler synthesis — streamed token by
   token to the client.
3. **Account precisely** for tokens and cost on every model call, add the ¥0.05 platform fee
   per call, and persist a per-call ledger that drives the Usage and Billing views.
4. **Persist** conversations, messages, model-library state, preferences, subscription, and
   invoices so the experience survives reloads and is consistent across sessions/devices.
5. **Observe everything** — write a structured activity log and a usage record for every
   request and every model call (user, action, route, status, tokens, cost, latency).

**Vision:** a backend that is faithful to the UI, exact on cost, fully observable, and
runnable end-to-end **with zero API keys** via deterministic mock mode — so the whole product
demos, tests, and ships from a single coherent codebase.

---

## 2. Goals & Non-Goals

### Goals
- **G1 — Faithful backing of the existing UI.** Every value the `ViewModel` renders (turn
  tokens/cost/fee/total, usage aggregates, 7-day trend, cost-by-model, ledger rows, plan
  usage bar, model cards, trio chips, route text) is produced by a real API, byte-for-byte
  consistent with the frontend's current formatting rules.
- **G2 — Real, secure accounts.** Session-based auth (signup, login, logout, `me`) with
  hashed passwords and DB-backed httpOnly cookies; SSO stubbed but contract-complete.
- **G3 — Real orchestration with streaming.** Fast and Multi-expert turns execute server-side
  through the LLM Gateway and stream to the client (SSE), including the expert stage, the
  fusion reasoning trace, and the final answer.
- **G4 — Exact cost accounting.** Per-call token counts × per-1M model pricing + ¥0.05 fee,
  stored as integer micro-cents, aggregated into the same totals the UI shows today.
- **G5 — Durable product state.** Conversations/messages, model enable/main state,
  preferences, subscription, and invoices persist in libSQL via Drizzle.
- **G6 — Pervasive observability.** Every request → one `activity_logs` row; every model call
  → one `usage_records` row; both queryable and exportable.
- **G7 — Keyless runnability.** `LLM_MODE=mock` (default) reproduces the existing content
  engine deterministically so the product and full test suite run with no provider keys.

### Non-Goals
- **NG1 — No new frontend.** No UI redesign, no new views, no new product surface beyond what
  the four views (chat, usage, models, billing) and the auth screen already imply.
- **NG2 — No real payment processing.** Top-up and plan changes mutate balances/records;
  no real charge, gateway integration, or PCI scope. Invoices are records, not generated PDFs.
- **NG3 — No real third-party SSO handshake.** SSO endpoints are stubs with a stable contract
  (NG can be lifted later without breaking callers).
- **NG4 — No multi-tenant org/RBAC system** beyond the Team "seats" concept implied by plans;
  Team/Enterprise seat management is out of scope for v1 (see §10).
- **NG5 — No model fine-tuning, no vector store / true RAG.** Deep Research / Deep Agents are
  **flags** that annotate a turn (and may inflate input tokens / add research steps); they do
  not stand up a retrieval pipeline in v1.
- **NG6 — Not re-implementing transport.** All provider calls go through the Vercel AI SDK via
  the Gateway; we do not hand-roll per-vendor HTTP/streaming (per llm-sdk-evaluation.md).

---

## 3. Personas

### P1 — Zoe, the advanced individual user (primary)
A power user on the **Pro** plan. Switches fluidly between Fast and Multi-expert, pins a main
model or lets auto-routing pick, configures her expert trio, toggles Deep Research, and
**scrutinizes cost** — she reads per-turn token/cost/fee and checks the Usage view's 7-day
trend and cost-by-model breakdown. She works in **简体中文** but flips to English/日本語. She
expects streaming to feel instant, costs to be exact, and her conversations to persist.
*Needs:* low-latency streaming, exact per-call cost, persisted history, language that sticks.

### P2 — The team admin
Owns a **Team** subscription, manages the shared ¥750 credit, watches aggregate spend, exports
usage, and configures which of the 12 models (plus OpenRouter) are enabled. Cares about budget
visibility, invoices, and being able to disable expensive flagship models org-wide.
*Needs:* trustworthy aggregates, usage export, model enable/disable, subscription state.

### P3 — Ops / Product Owner
Operates and reasons about the platform. Reads the structured activity log and usage records to
answer "who did what, how fast, at what cost, with what status." Watches latency budgets,
error rates, and cost accuracy; needs basic admin metrics and exportable observability data.
*Needs:* complete activity/usage logs, query + export, latency/error/cost metrics, request IDs.

---

## 4. Scope — the 10 Capability Areas

Each area maps to exactly one user story (US1–US10) with five use cases. IDs are stable and
are referenced by the functional requirements in §5.

- **US1 — Account & Authentication.** Email/password signup with validation, login, logout,
  `session`/`me`, and a contract-complete SSO stub. Sessions are DB-backed httpOnly cookies.
- **US2 — Fast-mode single-model chat.** Submit a prompt; stream one model's answer; pick the
  model manually (or auto); copy the result; see per-turn tokens, model cost, fee, and total.
- **US3 — Multi-expert fusion.** Run the expert trio in parallel; stream each expert; emit the
  Final Compiler's reasoning/thinking trace, then its single rewritten final answer; regenerate.
- **US4 — Intent routing & orchestration.** Auto-route a prompt to the best model by intent;
  pin a main model; configure the expert trio; switch between Fast and Multi-expert modes.
- **US5 — Model library management.** List the 12 models (tier, tags, context, per-1M pricing,
  vendor color); enable/disable; set-as-main; expose the OpenRouter gateway list.
- **US6 — Usage & cost analytics.** Per-turn ledger; totals/aggregates; 7-day cost trend;
  cost-by-model breakdown; detailed call ledger rows.
- **US7 — Billing & subscription.** Plans (Free/Pro/Team/Enterprise); current plan + included
  credit + month usage bar; invoices; top-up; payment method.
- **US8 — Conversations & history.** Create/list/rename/delete conversations; recents; message
  history per conversation; copy and regenerate a result.
- **US9 — Preferences & localization.** Theme (light/dark); 4-language i18n (zh, zh-TW, en, ja);
  Deep Research / Deep Agents toggles; defaults (mode, language, platform fee).
- **US10 — Activity logging & observability.** Log user activity + tokens + cost + latency per
  request and per model call; query and export; basic admin metrics.

### Use cases per story

**US1 — Account & Authentication**
- **US1.UC1** Sign up with name, email, password (≥8 chars, valid email per the UI's regex) → account + session created, user returned.
- **US1.UC2** Log in with email + password → session cookie set; `remember me` controls session lifetime.
- **US1.UC3** Log out → server invalidates the session and clears the cookie.
- **US1.UC4** `GET session/me` → returns the current user + plan + preferences, or 401 when unauthenticated.
- **US1.UC5** SSO stub (`google|github|wechat|apple`) → provisions/returns a session via a stable contract (mock identity) without a real OAuth handshake.

**US2 — Fast-mode single-model chat**
- **US2.UC1** POST a Fast turn with a prompt → server creates the turn and streams the single model's answer token by token (SSE).
- **US2.UC2** Manually pick the main model for the turn → that exact model answers (no routing).
- **US2.UC3** On completion → server emits final per-call usage: input/output tokens, model cost, ¥0.05 fee, and turn total.
- **US2.UC4** Copy the result → client copies; no server mutation required, but a copy activity may be logged.
- **US2.UC5** Auto mode in Fast → server routes by intent (US4) and returns `routeText` (e.g. "Intent: Code · routed to DeepSeek V4 Pro") before streaming.

**US3 — Multi-expert fusion**
- **US3.UC1** POST an expert turn → server runs the configured trio in parallel and streams each expert's answer with per-expert usage.
- **US3.UC2** After all experts finish → server streams the Final Compiler's reasoning/thinking trace.
- **US3.UC3** After the trace → server streams one consolidated, rewritten final answer (not a meta-summary), with fusion-call usage.
- **US3.UC4** Turn accounting → sums all expert calls + the fusion call (each a billable call with its own ¥0.05 fee) into the turn total.
- **US3.UC5** Regenerate a turn → re-run the same prompt/trio/compiler, replacing the prior assistant turn and writing fresh usage records.

**US4 — Intent routing & orchestration**
- **US4.UC1** Auto-route a prompt → classify intent (code / writing / translation / quick / planning / general) and select the matching model.
- **US4.UC2** Pin a main model → disable auto and force that model for Fast turns and as the Multi-expert compiler.
- **US4.UC3** Configure the expert trio → set the three expert model IDs used by Multi-expert turns.
- **US4.UC4** Switch mode (Fast ↔ Multi-expert) → persisted preference; subsequent turns use the selected mode.
- **US4.UC5** Routing respects enablement → routing/trio/main selection may only pick **enabled** models; disabled models are excluded.

**US5 — Model library management**
- **US5.UC1** List models → returns all 12 with id, name, vendor, color, initials, tier, localized tags, context window, and per-1M in/out price.
- **US5.UC2** Enable/disable a model → persisted; disabled models disappear from the picker and are ineligible for routing/trio/main.
- **US5.UC3** Set-as-main → persisted; reflected as the Fast main model and the Multi-expert compiler.
- **US5.UC4** Pricing/tier/context authoritative server-side → the registry mirrors `lib/models.ts` and drives cost math.
- **US5.UC5** OpenRouter gateway → expose the OpenRouter model list and route calls for those models through the gateway.

**US6 — Usage & cost analytics**
- **US6.UC1** Totals/aggregates → total in/out tokens, model cost, platform fees, grand total, and request count.
- **US6.UC2** 7-day trend → daily total (model cost + fees) for the last 7 days, including empty days.
- **US6.UC3** Cost-by-model → per-model call count and cost, sorted by cost, with share-of-total.
- **US6.UC4** Call ledger → most-recent turns with time, prompt, mode, the distinct models used, tokens, model cost, fee, and total.
- **US6.UC5** A completed turn is appended to the ledger immediately and is reflected in all aggregates on the next read.

**US7 — Billing & subscription**
- **US7.UC1** Get current subscription → plan, included credit, month usage, used %, and remaining credit.
- **US7.UC2** List plans → Free / Pro / Team / Enterprise with price, period, included credit, and feature list; mark the current plan.
- **US7.UC3** List invoices → historical invoices with date, plan, amount, and status (e.g. Paid).
- **US7.UC4** Top up → increase the account's available credit/balance by a chosen amount.
- **US7.UC5** Payment method → read/update the stored (non-sensitive) payment-method descriptor and expiry.

**US8 — Conversations & history**
- **US8.UC1** Create a conversation (implicitly on first send, or explicitly) → returns a conversation id.
- **US8.UC2** List conversations / recents → titled, color-tagged entries ordered by recency.
- **US8.UC3** Rename / delete a conversation → persisted; delete removes its messages and usage linkage is preserved historically.
- **US8.UC4** Get message history → ordered user/assistant messages for a conversation, including per-message model/usage metadata.
- **US8.UC5** Copy / regenerate a result within a conversation → copy is client-side; regenerate re-runs the turn in place (see US3.UC5).

**US9 — Preferences & localization**
- **US9.UC1** Get/set theme (dark | light) → persisted per user.
- **US9.UC2** Get/set language (zh | zh-TW | en | ja) → persisted; localized content (tags, route labels, plan features) follows.
- **US9.UC3** Toggle Deep Research / Deep Agents → persisted per user; flags annotate subsequent turns.
- **US9.UC4** Defaults → server seeds default mode (`expert`), default language, and platform fee (¥0.05, configurable) for new users.
- **US9.UC5** Preferences are returned by `me` and applied to orchestration, accounting, and localized responses.

**US10 — Activity logging & observability**
- **US10.UC1** Per-request activity → one `activity_logs` row per API request: requestId, userId, action, route, status, latencyMs.
- **US10.UC2** Per-call usage → one `usage_records` row per model call: requestId, conversationId, turnId, modelId, role, in/out/reasoning tokens, costMicro, platformFeeMicro, latencyMs.
- **US10.UC3** Query → filter activity/usage by user, time range, action/route, and status.
- **US10.UC4** Export → export filtered activity/usage as JSON/CSV.
- **US10.UC5** Admin metrics → basic aggregate metrics (request count, error rate, p50/p95 latency, total cost) over a time window.

---

## 5. Functional Requirements

All responses use the envelope `{ ok: true, data } | { ok: false, error: { code, message, details? } }`.
Money is stored as integer **micro-cents (CNY)** and formatted at the edge with the existing
rules (`fmtMoney`: `¥0.00` ≥1, `¥0.0000` ≥0.001, else `¥0.000000`). Token estimation uses the
existing `estTok` model (`round(len / 1.8)`) in mock mode; in gateway mode, token counts come
from the SDK's normalized `usage`. Tracing to user stories is shown in brackets.

### Authentication & Session (US1)
- **FR-1** `POST /api/auth/signup` accepts `{ name, email, password }`, validates email
  (`/^[^@\s]+@[^@\s]+\.[^@\s]+$/`) and `password.length ≥ 8`, hashes the password with
  `node:crypto` scrypt, creates the user with default preferences and a Free or Pro plan
  (configurable seed), opens a DB-backed session, sets an httpOnly `SameSite=Lax` cookie, and
  returns the public user. Duplicate email → `409 AUTH_EMAIL_TAKEN`. [US1.UC1]
- **FR-2** `POST /api/auth/login` accepts `{ email, password, remember? }`, verifies the scrypt
  hash, opens a session, sets the cookie (longer TTL when `remember` is true), returns the user.
  Bad credentials → `401 AUTH_INVALID`. [US1.UC2]
- **FR-3** `POST /api/auth/logout` invalidates the current session row and clears the cookie. [US1.UC3]
- **FR-4** `GET /api/auth/session` (a.k.a. `me`) returns `{ user, plan, preferences }` for a valid
  session, or `401 AUTH_REQUIRED`. [US1.UC4]
- **FR-5** `POST /api/auth/sso/:provider` (`google|github|wechat|apple`) is a **stub** that
  provisions or returns a mock identity and a real session via the same session machinery, with
  a stable response contract. [US1.UC5]
- **FR-6** All non-auth routes are guarded; unauthenticated requests get `401 AUTH_REQUIRED`. [US1]

### Chat, Streaming & Orchestration (US2, US3, US4)
- **FR-7** `POST /api/chat` accepts `{ conversationId?, mode: "fast"|"expert", prompt, deepResearch?,
  deepAgents?, mainModel?, auto?, trio? }`, creates a turn, and returns an **SSE stream**
  (`Content-Type: text/event-stream`). Unspecified fields fall back to the user's persisted
  preferences/config. [US2.UC1, US3.UC1, US4.UC4]
- **FR-8** In **Fast** mode the server resolves the model: if `auto`, run intent routing (FR-13)
  and emit a `route` event carrying the localized `routeText`; otherwise use `mainModel`. It then
  streams a single `answer` for that model with incremental token deltas. [US2.UC1, US2.UC2, US2.UC5]
- **FR-9** In **Multi-expert** mode the server streams the configured `trio` **in parallel**,
  emitting per-expert `delta` events; after **all** experts complete it streams the Final
  Compiler's `reason` (thinking trace) events, then the consolidated `answer` events. The fusion
  answer is a single rewritten answer merging each expert's strongest point, deduplicated — not a
  meta-summary. [US3.UC1, US3.UC2, US3.UC3]
- **FR-10** The SSE protocol emits typed events: `turn.start`, `route`, `call.start`,
  `call.delta`, `call.usage`, `reason.start`, `reason.delta`, `reason.done`, `answer.delta`,
  `turn.usage`, `turn.done`, and `error`. Each call event carries its `modelId` and `role`
  (`single | expert | fusion`). [US2, US3]
- **FR-11** On turn completion the server emits and persists **per-call usage** (input/output/
  reasoning tokens, model cost, ¥0.05 fee) and a **turn rollup** (`turnTok`, `turnCost`,
  `turnFee`, `turnTotal`, `callCount`) that matches the UI's per-turn footer exactly. [US2.UC3, US3.UC4]
- **FR-12** `POST /api/chat/regenerate` (or `POST /api/chat` with `regenerateTurnId`) re-runs the
  same prompt with the same mode/trio/compiler, replaces the prior assistant turn in the
  conversation, and writes fresh usage records. [US3.UC5, US8.UC5]
- **FR-13** **Intent router** maps a prompt to a model using the existing rules: code →
  `deepseek-pro`, writing → `claude-opus`, translation → `qwen`, quick/summary →
  `deepseek-flash`, planning → `gemini-pro`, else general → `gpt-55`; returns `{ id, label }`
  where `label` is localized. Routing only selects **enabled** models. [US4.UC1, US4.UC5]
- **FR-14** `PATCH /api/preferences` (or `/api/orchestration`) sets `mainModel` (with `auto=false`),
  toggles `auto`, sets the `trio` (exactly 3 enabled model ids), and sets `mode`; all persisted
  per user. Selecting a disabled model is rejected `409 MODEL_DISABLED`. [US4.UC2, US4.UC3, US4.UC4, US4.UC5]
- **FR-15** The pinned main model is used both as the Fast main model and as the Multi-expert
  **compiler**; the trio supplies the experts. [US3, US4.UC2]

### Model Library (US5)
- **FR-16** `GET /api/models` returns the 12 models with `{ id, name, vendor, color, initials,
  tier, tags (localized for the caller's language), ctx, pin, pout }` plus each model's per-user
  `enabled` and `isMain` state, and the `OPENROUTER_MODELS` list. [US5.UC1, US5.UC5]
- **FR-17** `PATCH /api/models/:id` supports `{ enabled }` (toggle) and `setMain: true`; persisted
  per user. Disabling the current main or a current trio member returns `409` with guidance (the
  client must pick a replacement). [US5.UC2, US5.UC3]
- **FR-18** The server **model registry** is authoritative for pricing/tier/context/color and
  must stay in sync with `lib/models.ts`; cost math reads only the server registry. [US5.UC4]
- **FR-19** OpenRouter models are callable through the AI Gateway and metered identically (tokens
  × price + fee); pricing for OpenRouter entries falls back to a default if unlisted. [US5.UC5]

### Usage & Cost Analytics (US6)
- **FR-20** Cost engine: `modelCost = inTok/1e6 × pin + outTok/1e6 × pout` per call, stored as
  micro-cents; `platformFee = PLATFORM_FEE_CNY` (default ¥0.05) **per call**; turn/aggregate
  totals sum these. This reproduces `respCost` and the `aggregate()` math exactly. [US6, US2.UC3, US3.UC4]
- **FR-21** `GET /api/usage` returns aggregates: `{ tin, tout, modelCost, fee, total, calls,
  requestCount }` over the user's ledger. [US6.UC1]
- **FR-22** `GET /api/usage?trend=7d` returns 7 daily buckets (oldest→newest) of `(modelCost +
  fee)`, including zero-value days, labeled `M/D`. [US6.UC2]
- **FR-23** `GET /api/usage?by=model` returns per-model `{ id, calls, cost }` sorted by cost
  descending, with each model's share of total model cost. [US6.UC3]
- **FR-24** `GET /api/usage?view=ledger&limit=12` returns recent turns: `{ time, prompt, mode,
  distinctModels[], tokens, modelCost, fee, total }`, newest first. [US6.UC4]
- **FR-25** Completing a turn appends one ledger record (one row per model call under it) and is
  reflected in all aggregate reads thereafter. [US6.UC5]

### Billing & Subscription (US7)
- **FR-26** `GET /api/billing/subscription` returns `{ plan, includedCredit, monthUsed, usedPct,
  remaining }` where `monthUsed` is the user's current-period total (model cost + fees),
  `usedPct = min(100, used/includedCredit×100)`, `remaining = max(0, includedCredit − used)`.
  Default Pro included credit is **¥150**. [US7.UC1]
- **FR-27** `GET /api/billing/plans` returns Free / Pro / Team / Enterprise with `{ name, price,
  period, includedCredit, features[] (localized), current }`. Feature lists match the UI's plan
  cards. [US7.UC2]
- **FR-28** `GET /api/billing/invoices` returns historical invoices `{ date, plan, amount,
  status }`. [US7.UC3]
- **FR-29** `POST /api/billing/topup` accepts `{ amount }`, increases the account credit/balance
  (no real charge), and records the transaction. [US7.UC4]
- **FR-30** `GET/PATCH /api/billing/payment-method` reads/updates a non-sensitive payment-method
  descriptor `{ brand, last4, expires }`. No card data is stored. [US7.UC5]
- **FR-31** `POST /api/billing/subscription` changes the plan (Free/Pro/Team/Enterprise),
  updating included credit and the current-plan flag. Enterprise routes to a "contact sales"
  no-op record. [US7.UC2]

### Conversations & History (US8)
- **FR-32** `POST /api/conversations` creates a conversation (also created implicitly on first
  `POST /api/chat` when `conversationId` is absent), returning `{ id, title, color }`. [US8.UC1]
- **FR-33** `GET /api/conversations` lists the user's conversations (recents), ordered by last
  activity, with `{ id, title, color, updatedAt }`. [US8.UC2]
- **FR-34** `PATCH /api/conversations/:id` renames; `DELETE /api/conversations/:id` deletes the
  conversation and its messages (usage records are retained for historical accounting). [US8.UC3]
- **FR-35** `GET /api/conversations/:id/messages` returns ordered messages with role and, for
  assistant turns, the mode, route text, per-call model/usage, fusion reason+answer, and turn
  rollup needed to rehydrate the chat view. [US8.UC4]
- **FR-36** Copy is client-only (optionally logged as activity); regenerate is FR-12. [US8.UC5]

### Preferences & Localization (US9)
- **FR-37** `GET/PATCH /api/preferences` reads/writes `{ theme, lang, mode, auto, mainModel,
  trio, deepResearch, deepAgents }`, all persisted per user and returned by `me`. [US9.UC1–UC5]
- **FR-38** `lang ∈ {zh, zh-TW, en, ja}` controls localized fields in all responses (model tags,
  route labels, plan features, mode labels) using the existing `pick()`/i18n dictionaries with
  `en→zh` fallback. [US9.UC2]
- **FR-39** Deep Research / Deep Agents toggles persist and annotate subsequent turns; in mock
  mode Deep Research adds the existing research-step annotations and may inflate input tokens.
  [US9.UC3]
- **FR-40** New users are seeded with defaults: `mode=expert`, language from signup/Accept-Language,
  theme `dark`, `auto=true`, default trio `[deepseek-pro, gpt-55, claude-opus]`, main `gpt-55`,
  all 12 models enabled, platform fee ¥0.05. [US9.UC4]

### Activity Logging & Observability (US10)
- **FR-41** A request wrapper assigns a `requestId`, authenticates (where required), validates
  with zod, times execution, and writes exactly one `activity_logs` row `{ requestId, userId,
  action, route, status, latencyMs, ts }` per request. [US10.UC1]
- **FR-42** Every model call writes one `usage_records` row `{ requestId, conversationId, turnId,
  modelId, role, inputTokens, outputTokens, reasoningTokens, costMicro, platformFeeMicro,
  latencyMs, ts }`. [US10.UC2]
- **FR-43** `GET /api/activity` queries activity/usage filtered by `{ userId?, from?, to?,
  action?, route?, status? }` with pagination. [US10.UC3]
- **FR-44** `GET /api/activity?export=csv|json` exports the filtered result set. [US10.UC4]
- **FR-45** `GET /api/activity/metrics?window=…` returns aggregate metrics: request count, error
  rate, p50/p95 latency, and total cost over the window. [US10.UC5]
- **FR-46** Structured logs are also emitted to **stdout as JSON**, mirroring the DB rows, so logs
  are available without DB access. [US10]

---

## 6. Non-Functional Requirements

### Performance & latency budgets
- **NFR-1 (TTFB / first token).** For a chat turn, the first SSE event (`turn.start`) is emitted
  within **300 ms** of request receipt (excluding model time); the first `call.delta` follows as
  soon as the model yields. In **mock mode** streaming is wall-clock paced to mirror the current
  UX (~360 chars/sec, slight per-call stagger) so demos and tests are deterministic.
- **NFR-2 (streaming continuity).** SSE keeps the connection open for the full turn; no buffering
  the whole answer before sending. Heartbeats/comments prevent idle-proxy timeouts on long turns.
- **NFR-3 (parallel experts).** In Multi-expert mode the three expert calls run **concurrently**;
  the fusion stage starts only after all experts finish. End-to-end wall-clock should approximate
  the slowest expert + fusion, not the sum.
- **NFR-4 (read-path latency).** Non-streaming GETs (usage, models, billing, conversations,
  activity) respond **p95 < 200 ms** against the local libSQL DB for a typical user dataset.
- **NFR-5 (mock determinism).** With `LLM_MODE=mock` and a fixed seed, content and token counts
  are deterministic, enabling exact-value assertions in tests and CI with zero keys.

### Cost accuracy
- **NFR-6.** Cost math uses integer micro-cents end to end; no floating-point money is persisted.
  Aggregates equal the sum of per-call records to the micro-cent (no rounding drift across turns).
- **NFR-7.** Platform fee is exactly `PLATFORM_FEE_CNY` per **model call** (¥0.05 default); a
  Fast turn = 1 fee, a Multi-expert turn = (experts + 1) fees, matching the UI footer.
- **NFR-8.** In gateway mode, token counts are taken from the SDK's normalized `usage`
  (`inputTokens`/`outputTokens`/`reasoningTokens`); the cost engine never scrapes per-vendor.

### Security
- **NFR-9.** Passwords hashed with scrypt + per-user salt; never logged or returned. Sessions are
  opaque, DB-backed, httpOnly, `SameSite=Lax`, `Secure` in production.
- **NFR-10.** Every mutating route is authenticated and authorizes resource ownership (a user can
  only read/modify their own conversations, usage, billing, preferences).
- **NFR-11.** All input validated with zod at the boundary; invalid input → `400 VALIDATION` with
  field details. No secrets in the repo; provider keys via env only.
- **NFR-12.** Logs and exports exclude prompt **content** by default beyond what the ledger already
  surfaces (prompt preview); full prompts are not duplicated into activity logs. PII handling per §7.

### Observability (mandatory)
- **NFR-13.** It is a hard requirement that the backend **logs user activity, tokens, cost, and
  latency** on **every request and every model call** (FR-41, FR-42). Absence of a log row for a
  served request is a defect.
- **NFR-14.** Every response and log row carries the `requestId`; errors include it for traceability.
- **NFR-15.** Admin metrics (FR-45) are derivable purely from `activity_logs` + `usage_records`.

### Reliability
- **NFR-16.** In gateway mode, transient provider errors use the SDK's provider fallback / retry;
  a failed expert degrades gracefully (the turn proceeds with remaining experts, logged as a
  partial) rather than failing the whole turn. A failed Fast call surfaces a typed `error` event.
- **NFR-17.** A client disconnect mid-stream cancels server work where possible and still persists
  usage for any completed calls; no orphaned "in-flight forever" turns.
- **NFR-18.** Migrations are idempotent; the app self-creates the schema on first run for local/CI.

### Internationalization
- **NFR-19.** All user-facing strings produced by the backend (route labels, plan features, mode
  labels, localized tags) honor `lang ∈ {zh, zh-TW, en, ja}` with `en→zh` fallback, matching the
  existing dictionaries. Numeric/money/time formatting matches `fmtNum`/`fmtMoney`/`fmtTime`.

### Portability & testability
- **NFR-20.** libSQL via Drizzle locally (`file:./.data/omnimind.db`); driver-swappable to
  Turso/Neon without query changes. Integration tests invoke Route Handlers directly against a
  temp/in-memory DB; e2e via Playwright against `next dev`.

---

## 7. Data & Privacy

### Core entities (libSQL via Drizzle; ids `crypto.randomUUID()`, timestamps epoch-ms UTC; money in micro-cents)
- **users** — `id, email (unique), name, passwordHash, salt, planId, createdAt`.
- **sessions** — `id, userId, expiresAt, createdAt` (opaque token in httpOnly cookie).
- **preferences** — `userId, theme, lang, mode, auto, mainModel, trio (json), deepResearch,
  deepAgents`.
- **model_state** — `userId, modelId, enabled` (per-user enable map; main model lives in preferences).
- **conversations** — `id, userId, title, color, createdAt, updatedAt`.
- **messages** — `id, conversationId, role, turnId?, mode?, promptText?, routeText?, payload (json:
  experts/fusion/single text + per-call usage), createdAt`.
- **ledger / turns** — derived from `usage_records` grouped by `turnId` (prompt, mode, calls).
- **subscriptions** — `userId, planId, includedCreditMicro, balanceMicro, periodStart`.
- **invoices** — `id, userId, date, plan, amountMicro, status`.
- **payment_methods** — `userId, brand, last4, expires` (no PAN/CVV ever).
- **activity_logs** — `requestId, userId, action, route, status, latencyMs, ts`.
- **usage_records** — `requestId, conversationId, turnId, modelId, role, inputTokens,
  outputTokens, reasoningTokens, costMicro, platformFeeMicro, latencyMs, ts`.

### Privacy
- **Data minimization.** No card numbers, no CVV; only a display descriptor. Passwords are
  hashed, never reversible, never logged.
- **Prompt content.** Prompts are stored under the user's conversation (needed for history and
  regenerate) and a short preview appears in the ledger; full prompt text is **not** copied into
  activity logs. With `LLM_MODE=gateway`, the chosen gateway is zero-data-retention.
- **Ownership & deletion.** A user's data is scoped to their `userId`; deleting a conversation
  removes its messages. Account deletion (future) cascades user-owned rows; `usage_records` may be
  retained in anonymized/aggregated form for billing integrity.
- **Localization of stored data.** Content is generated per the user's `lang` at turn time and
  stored as produced; switching language affects future turns, not historical records.

---

## 8. Success Metrics & Acceptance Criteria

### Success metrics
- **SM1 — UI parity:** 100% of `ViewModel` fields are backed by real APIs with byte-identical
  formatting (money/tokens/time) versus the current frontend.
- **SM2 — Cost exactness:** aggregate totals equal the sum of `usage_records` to the micro-cent
  across a randomized turn sequence (0 drift).
- **SM3 — Latency:** chat first SSE event p95 < 300 ms; non-streaming GET p95 < 200 ms locally.
- **SM4 — Observability completeness:** 100% of served requests have an `activity_logs` row; 100%
  of model calls have a `usage_records` row.
- **SM5 — Keyless runnability:** the full unit + integration suite passes with `LLM_MODE=mock`
  and **no** provider keys.

### Acceptance criteria (representative, per story)
- **AC-US1:** signup rejects invalid email / `<8`-char passwords; login sets an httpOnly session
  cookie; `me` returns the user; logout invalidates the session; SSO stub returns a session.
- **AC-US2:** a Fast turn streams a single model's answer and ends with per-turn tokens/cost/
  fee(=¥0.05)/total matching the UI footer; manual pick bypasses routing.
- **AC-US3:** a Multi-expert turn streams 3 experts concurrently, then a reasoning trace, then
  one rewritten final answer; turn total = sum of 4 calls × (cost + ¥0.05); regenerate replaces
  the turn and writes new usage.
- **AC-US4:** auto-routing returns the documented model per intent and a localized `routeText`;
  pinning a main model forces it; the trio is configurable to 3 enabled models; disabled models
  are never selected.
- **AC-US5:** `GET /api/models` returns 12 models with correct pricing/tier/context + OpenRouter
  list; enable/disable and set-as-main persist and gate the picker/routing.
- **AC-US6:** usage aggregates, 7-day trend (incl. empty days), cost-by-model shares, and the
  newest-first ledger reproduce the current Usage view values for the same ledger.
- **AC-US7:** subscription returns included credit ¥150 (Pro), used %, and remaining; plans list
  marks the current plan; invoices list renders; top-up increases balance; payment-method
  read/update works without storing card data.
- **AC-US8:** conversations create/list/rename/delete; message history rehydrates a chat turn
  (experts/fusion/single + usage); regenerate works in place.
- **AC-US9:** theme/lang/mode/toggles persist and are returned by `me`; switching `lang` localizes
  tags/route labels/plan features; defaults seed correctly for new users.
- **AC-US10:** activity and usage rows are written per request/call; query filters by user/time/
  status; export emits CSV/JSON; metrics return request count, error rate, p50/p95 latency, total
  cost.

---

## 9. Assumptions & Risks

### Assumptions
- **A1.** The frozen stack (Next.js Route Handlers, Drizzle/libSQL, Vercel AI SDK v6 + Gateway,
  session auth, mock mode) is final and is used as written.
- **A2.** Model names/prices are illustrative placeholders; the **server registry mirrors
  `lib/models.ts`** and is authoritative server-side.
- **A3.** Default platform fee is ¥0.05/call via `PLATFORM_FEE_CNY`; default Pro included credit
  is ¥150 (matching the UI's `agg.total / 150` usage bar).
- **A4.** Mock mode reuses the existing `content.ts` engine and `estTok` so values are deterministic
  and identical to today's UI.
- **A5.** A single seeded/Pro user is acceptable for v1 demos; multi-seat Team management is later.

### Risks
- **R1 — Registry drift.** Server and client model tables diverge → wrong cost. *Mitigation:* one
  authoritative server registry mirroring `lib/models.ts`, with a sync test asserting equality.
- **R2 — Cost rounding drift.** Float money causes penny mismatches. *Mitigation:* micro-cent
  integers end to end (NFR-6) + the SM2 zero-drift test.
- **R3 — Streaming under proxies/serverless.** Buffering or idle timeouts break SSE. *Mitigation:*
  Node runtime, no full-buffering, heartbeats (NFR-2), Fluid-Compute-compatible handlers.
- **R4 — Token-count mismatch mock vs gateway.** `estTok` ≠ real tokenizer. *Mitigation:* mock uses
  `estTok`; gateway uses SDK `usage`; both flow through the same cost engine; documented that exact
  counts differ only in live mode.
- **R5 — Partial expert failure.** One expert errors mid-fusion. *Mitigation:* graceful degradation
  (NFR-16) — fuse remaining experts, log the partial, still bill completed calls.
- **R6 — Observability gaps.** A code path skips logging. *Mitigation:* logging lives in the shared
  request wrapper and the single LLM gateway call site, not per-handler; SM4 verifies coverage.
- **R7 — SSO stub mistaken for real auth.** *Mitigation:* clearly contract-only in v1 (NG3), behind
  a flag, with the production handshake scoped later without breaking the contract.

---

## 10. Out of Scope (v1)

- **Real payments / PCI:** no card processing, real charges, refunds, proration, or PDF invoices
  (top-up and plan change mutate records only).
- **Real OAuth/SSO and SAML/SCIM:** SSO endpoints are stubs (NG3); enterprise IdP integration later.
- **Team/org RBAC & seat management:** shared-credit Team and Enterprise seat administration,
  roles, and member invitations are deferred (the plans exist; the admin surface does not).
- **True Deep Research / Deep Agents pipelines:** no web retrieval, tool-running agents, or vector
  store in v1; these remain turn-annotating flags (NG5).
- **Model fine-tuning / custom model onboarding** (an Enterprise feature noted in plan copy) is not
  built in v1.
- **Realtime collaboration / shared conversations / multi-device live sync** beyond ordinary
  persistence and reload.
- **Rate limiting / quota enforcement of the Free plan's "20 calls/day"** is advisory copy in v1,
  not enforced server-side.
- **Mobile/native clients, public API keys, and webhooks** for third-party integration.
- **Advanced analytics** (funnels, cohort retention, dashboards) beyond the Usage view and the
  basic admin metrics in FR-45.
