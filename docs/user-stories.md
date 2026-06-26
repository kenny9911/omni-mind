# OmniMind — User Stories & Use Cases

**Status:** Living · **Owner:** Product + Engineering · **Date:** 2026-06-18

This document is the **behavioral contract** for the OmniMind backend. The Next.js 16 +
React 19 + TypeScript frontend (under `components/`, `lib/`) is already built and is the
**source of truth for required functionality**; every user story below traces to real UI
and store behavior in that frontend. The backend (see
[`docs/decisions/tech-stack.md`](decisions/tech-stack.md) and
[`docs/decisions/llm-sdk-evaluation.md`](decisions/llm-sdk-evaluation.md), both **FROZEN**)
must support all of it.

## How to read this document

- **10 user stories** (`US1`..`US10`), each with **exactly 5 use cases** (`US{n}.UC{m}`).
- Every use case names the **concrete API endpoint(s)** it exercises and **what is logged**.
- Acceptance criteria are written **Given / When / Then** and are intended to be testable
  with Vitest (Route-Handler invocation) and Playwright (e2e), per the frozen testing stack.

## Conventions referenced throughout

These are fixed by the frozen stack and assumed by every use case:

- **Response envelope** — `{ ok: true, data }` on success, `{ ok: false, error: { code, message, details? } }` on failure.
- **Auth** — session-based: opaque DB-backed session id in an `httpOnly`, `SameSite=Lax` cookie. Protected routes return `401 AUTH_REQUIRED` without a valid session.
- **Validation** — every request body/query is validated with **zod**; invalid input returns `400 VALIDATION_ERROR` with `details`.
- **Activity log** — every request writes one `activity_logs` row: `{ requestId, userId, action, route, status, latencyMs, ... }`.
- **Usage log** — every model call writes one `usage_records` row: `{ requestId, conversationId, turnId, modelId, role(expert|fusion|single), inputTokens, outputTokens, reasoningTokens, costMicro, platformFeeMicro, latencyMs }`.
- **Money** — currency **CNY (¥)**; stored as **micro-cents (integer)**; the platform fee is **¥0.05 per model call** (`PLATFORM_FEE_CNY`, default `0.05`).
- **LLM mode** — `LLM_MODE=mock` (default, deterministic, keyless) or `gateway` (Vercel AI SDK v6 via AI Gateway). Behavior/shape is identical across modes; only token/text content differs.
- **IDs / time** — `crypto.randomUUID()` for ids; timestamps are epoch-ms integers (UTC).

## Table of contents (all 10 stories)

| ID | Title | Priority | Primary endpoints |
|----|-------|----------|-------------------|
| [US1](#us1--account--authentication) | Account & Authentication | P0 | `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` |
| [US2](#us2--fast-mode-single-model-chat) | Fast-mode single-model chat | P0 | `POST /api/chat`, `GET /api/models` |
| [US3](#us3--multi-expert-fusion) | Multi-expert fusion | P0 | `POST /api/chat`, `POST /api/chat/regenerate` |
| [US4](#us4--intent-routing--orchestration) | Intent routing & orchestration | P0 | `POST /api/chat/route`, `POST /api/chat`, `GET/PATCH /api/preferences` |
| [US5](#us5--model-library-management) | Model library management | P0 | `GET /api/models`, `PATCH /api/models/:id` |
| US6 | Usage & cost analytics | P0 | `GET /api/usage`, `GET /api/usage/ledger` |
| US7 | Billing & subscription | P1 | `GET /api/billing/subscription`, `GET /api/billing/plans`, `GET /api/billing/invoices`, `POST /api/billing/topup` |
| US8 | Conversations & history | P0 | `GET/POST /api/conversations`, `PATCH/DELETE /api/conversations/:id`, `GET /api/conversations/:id/messages` |
| US9 | Preferences & localization | P1 | `GET/PATCH /api/preferences` |
| US10 | Activity logging & observability | P1 | `GET /api/activity`, `GET /api/activity/export`, `GET /api/admin/metrics` |

> **Scope of this file:** US1–US5 bodies are written below. US6–US10 are summarized in the
> table above and their full bodies are appended in a companion pass.

---

## US1 — Account & Authentication

**As a** new or returning OmniMind user, **I want** to sign up, log in, stay signed in across
requests, sign out, and optionally use SSO, **so that** my conversations, usage, billing, and
preferences are private to me and persist securely.

**Priority:** P0 (everything else is gated on an authenticated session).

**Notes from the frontend:** `components/AuthScreen.tsx` is a self-contained login/signup
screen at `/login` with `name` (signup only), `email`, and `password` fields, client-side
email validation, an **8-character minimum password**, and **Google / GitHub** SSO buttons.
Sessions are opaque, DB-backed, delivered in an `httpOnly; SameSite=Lax` cookie.

### US1.UC1 — Sign up with email & password
- **ID:** US1.UC1
- **Actor:** Visitor (unauthenticated)
- **Preconditions:** No session cookie; email not already registered.
- **Trigger:** Visitor submits the **Sign up** tab on `/login` with name, email, password.
- **Main flow:**
  1. Client `POST /api/auth/signup` with `{ name, email, password }`.
  2. Handler validates with zod: `name` non-empty, `email` RFC-valid, `password ≥ 8` chars.
  3. Email is normalized (trim + lowercase); uniqueness checked against `users`.
  4. Password hashed with **node:crypto scrypt** (random per-user salt); a `users` row is created.
  5. A DB-backed session is created and returned as an `httpOnly; SameSite=Lax` cookie.
  6. Response: `{ ok: true, data: { user: { id, name, email }, plan: "pro" } }`.
  7. **Logged:** `activity_logs` row `action="auth.signup"`, `status=201`, `userId` set, `latencyMs`; password and raw token never logged.
- **Alternate / error flows:**
  - Email already registered → `409 AUTH_EMAIL_TAKEN`; no user created.
  - Password `< 8` chars or invalid email → `400 VALIDATION_ERROR` with field `details`.
- **Postconditions:** A user exists; the client is authenticated for subsequent requests.
- **Acceptance criteria:**
  - **Given** a fresh email and an 8+ char password, **When** the client `POST /api/auth/signup`, **Then** a `users` row exists, a session cookie is set `httpOnly; SameSite=Lax`, and the body is `{ ok: true, data: { user, plan: "pro" } }`.
  - **Given** an email that already exists, **When** signup is attempted, **Then** the response is `409 AUTH_EMAIL_TAKEN`, no second user is created, and an `activity_logs` row with `status=409` is written.
  - **Given** a 6-character password, **When** signup is attempted, **Then** the response is `400 VALIDATION_ERROR` and `details` names the `password` field.

### US1.UC2 — Log in with existing credentials
- **ID:** US1.UC2
- **Actor:** Registered user (unauthenticated)
- **Preconditions:** A `users` row exists for the email; no active session.
- **Trigger:** User submits the **Log in** tab on `/login`.
- **Main flow:**
  1. Client `POST /api/auth/login` with `{ email, password }`.
  2. Handler validates with zod, normalizes email, loads the user by email.
  3. scrypt-verifies the password against the stored hash (constant-time compare).
  4. On success a new session is created; the cookie is set; prior sessions remain valid (multi-device).
  5. Response: `{ ok: true, data: { user: { id, name, email }, plan } }`.
  6. **Logged:** `activity_logs` `action="auth.login"`, `status=200`, `userId`, `latencyMs`.
- **Alternate / error flows:**
  - Unknown email **or** wrong password → `401 AUTH_INVALID` (identical message for both, to avoid user enumeration); `activity_logs` `status=401` with `userId=null`.
  - Malformed body → `400 VALIDATION_ERROR`.
- **Postconditions:** A valid session cookie is set.
- **Acceptance criteria:**
  - **Given** correct credentials, **When** `POST /api/auth/login`, **Then** the response is `{ ok: true, data: { user, plan } }` and a session cookie is set.
  - **Given** a wrong password, **When** login is attempted, **Then** the response is `401 AUTH_INVALID` with the **same** message as an unknown-email attempt, and no session is created.
  - **Given** an unknown email, **When** login is attempted, **Then** the timing and error are indistinguishable from a wrong-password attempt (no enumeration signal).

### US1.UC3 — Resolve current session (`/me`)
- **ID:** US1.UC3
- **Actor:** Authenticated user (page load / app bootstrap)
- **Preconditions:** Browser may or may not hold a session cookie.
- **Trigger:** App boots (`components/OmniApp.tsx` / `/login` guard) and asks "who am I?".
- **Main flow:**
  1. Client `GET /api/auth/session`.
  2. Handler reads the session cookie, looks up the session, checks expiry, loads the user.
  3. Response (authenticated): `{ ok: true, data: { user: { id, name, email }, plan } }`.
  4. **Logged:** `activity_logs` `action="auth.session"`, `status=200|401`, `latencyMs`.
- **Alternate / error flows:**
  - No / invalid / expired session → `401 AUTH_REQUIRED` with `data: null` semantics; the client routes to `/login`.
  - Expired session is deleted server-side on read (lazy cleanup).
- **Postconditions:** Client knows whether to render the app or redirect to `/login`.
- **Acceptance criteria:**
  - **Given** a valid session cookie, **When** `GET /api/auth/session`, **Then** the response is `200` with the matching `user` and `plan`.
  - **Given** no session cookie, **When** `GET /api/auth/session`, **Then** the response is `401 AUTH_REQUIRED` and the client redirects to `/login`.
  - **Given** an expired session id, **When** `GET /api/auth/session`, **Then** the response is `401`, and the expired session row is removed.

### US1.UC4 — Log out
- **ID:** US1.UC4
- **Actor:** Authenticated user
- **Preconditions:** A valid session exists.
- **Trigger:** User chooses "Log out" from the account menu.
- **Main flow:**
  1. Client `POST /api/auth/logout`.
  2. Handler deletes the current session row and clears the cookie (`Max-Age=0`).
  3. Response: `{ ok: true, data: { loggedOut: true } }`.
  4. **Logged:** `activity_logs` `action="auth.logout"`, `status=200`, `userId`, `latencyMs`.
- **Alternate / error flows:**
  - No session present → still returns `200` (idempotent logout); no-op delete.
- **Postconditions:** The session is invalid; the cookie is cleared; only that session is affected (other devices stay logged in).
- **Acceptance criteria:**
  - **Given** a valid session, **When** `POST /api/auth/logout`, **Then** the session row is deleted, the cookie is cleared, and a subsequent `GET /api/auth/session` returns `401`.
  - **Given** no session, **When** `POST /api/auth/logout`, **Then** the response is still `200` (idempotent).
  - **Given** two active sessions for one user, **When** one logs out, **Then** the other session still resolves to `200`.

### US1.UC5 — SSO sign-in (stub) & input validation gate
- **ID:** US1.UC5
- **Actor:** Visitor choosing **Google** or **GitHub**
- **Preconditions:** SSO is in stub mode (no real OAuth provider wired in mock/dev).
- **Trigger:** Visitor clicks a Google/GitHub SSO button on `/login`.
- **Main flow:**
  1. Client `POST /api/auth/sso` with `{ provider: "google" | "github" }`.
  2. Handler validates `provider` against an allowlist with zod.
  3. In stub mode it deterministically upserts a demo SSO user for that provider and creates a session (same cookie contract as password login).
  4. Response: `{ ok: true, data: { user, plan, sso: { provider, stub: true } } }`.
  5. **Logged:** `activity_logs` `action="auth.sso"`, `status=200`, `provider` in details, `latencyMs`.
- **Alternate / error flows:**
  - Unsupported `provider` → `400 VALIDATION_ERROR` (allowlist failure).
  - When `gateway`/real-OAuth mode is configured but unavailable → `503 SSO_UNAVAILABLE`.
- **Postconditions:** Visitor is authenticated via the stubbed SSO identity; subsequent protected calls succeed.
- **Acceptance criteria:**
  - **Given** `provider="google"` in stub mode, **When** `POST /api/auth/sso`, **Then** a session is created and the body includes `sso.stub === true`.
  - **Given** `provider="myspace"`, **When** `POST /api/auth/sso`, **Then** the response is `400 VALIDATION_ERROR`.
  - **Given** a successful SSO sign-in, **When** the client then calls a protected route, **Then** it succeeds with `200` using the SSO session.

---

## US2 — Fast-mode single-model chat

**As a** user who wants a quick answer, **I want** to send a prompt in **快速模式 (Fast mode)**
and stream one model's answer — either auto-routed or from a model I picked — then copy it and
see exactly what the turn cost, **so that** I get a fast, single-best-model response with precise,
transparent pricing.

**Priority:** P0.

**Notes from the frontend:** In Fast mode the store (`lib/store.ts` `send()`) builds a single
`StreamCall` for one model and streams it wall-clock-paced via SSE. With **auto** on, the
prompt is routed (`lib/content.ts` `route()`); with auto off, the **mainModel** is used. The
answer is copyable (`copyResult`), and the completed turn appends a `LedgerRecord` whose cost is
`tokens × per-1M price + ¥0.05` platform fee.

### US2.UC1 — Send a Fast-mode prompt and stream the answer
- **ID:** US2.UC1
- **Actor:** Authenticated user in Fast mode
- **Preconditions:** Valid session; a conversation exists or is created on first send; `mode="fast"`.
- **Trigger:** User types a prompt and presses Send.
- **Main flow:**
  1. Client `POST /api/chat` with `{ conversationId?, mode: "fast", prompt, auto, mainModel, deepResearch }`, `Accept: text/event-stream`.
  2. Handler validates with zod, authenticates, and (if `auto`) resolves the model via the intent router; otherwise uses `mainModel`.
  3. Handler opens an **SSE stream**, emitting events: `route` (if auto), `token` deltas, then `done` with final `usage` `{ inputTokens, outputTokens, costMicro, platformFeeMicro }`.
  4. On completion the turn is persisted (user + assistant messages) and one `usage_records` row (`role="single"`) is written; one `LedgerRecord`-equivalent is reflected in usage aggregates.
  5. **Logged:** `activity_logs` `action="chat.send"`, `mode="fast"`, `status=200`, `latencyMs`; `usage_records` for the single call.
- **Alternate / error flows:**
  - Empty/whitespace prompt → `400 VALIDATION_ERROR`; nothing streamed.
  - A send while a turn is already streaming for that conversation → `409 STREAM_IN_PROGRESS` (mirrors the store's `if (streaming) return` guard).
  - Model call failure mid-stream → an SSE `error` event + a `usage_records` row with `status` noted; turn marked failed.
- **Postconditions:** The assistant answer is persisted; usage updated; stream closed.
- **Acceptance criteria:**
  - **Given** a valid prompt in Fast mode, **When** `POST /api/chat`, **Then** the response is an SSE stream that ends with a `done` event carrying non-zero `outputTokens` and a `platformFeeMicro` equal to ¥0.05.
  - **Given** a streaming turn is already in progress, **When** a second `POST /api/chat` is sent for the same conversation, **Then** it returns `409 STREAM_IN_PROGRESS`.
  - **Given** a completed Fast turn, **When** usage is queried, **Then** exactly **one** `usage_records` row with `role="single"` exists for that turn.

### US2.UC2 — Auto-route picks the model from intent
- **ID:** US2.UC2
- **Actor:** Authenticated user with **auto** routing enabled
- **Preconditions:** `auto=true`, `mode="fast"`.
- **Trigger:** User sends a prompt whose content implies an intent (e.g. code, writing, translation).
- **Main flow:**
  1. Client `POST /api/chat` with `auto=true`.
  2. The router (server mirror of `route()`) classifies intent: code→`deepseek-pro`, writing→`claude-opus`, translation→`qwen`, summary/quick→`deepseek-flash`, planning→`gemini-pro`, else→`gpt-55`.
  3. The SSE stream first emits a `route` event `{ modelId, label }` (e.g. `label="Code"`), then streams the answer from that model.
  4. **Logged:** `activity_logs` records the resolved `modelId` and intent `label`; `usage_records` uses the routed model.
- **Alternate / error flows:**
  - Resolved model is **disabled** in the user's library → router falls back to the next eligible model and notes the fallback in the `route` event.
- **Postconditions:** The answer comes from the intent-appropriate model; the route is visible to the user.
- **Acceptance criteria:**
  - **Given** a prompt containing "python" / "代码", **When** sent with `auto=true`, **Then** the `route` event resolves `modelId="deepseek-pro"`.
  - **Given** a prompt containing "翻译" / "translate", **When** sent with `auto=true`, **Then** the `route` event resolves `modelId="qwen"`.
  - **Given** a prompt with no recognizable intent, **When** sent with `auto=true`, **Then** the router defaults to `modelId="gpt-55"`.

### US2.UC3 — Manually pick the main model (auto off)
- **ID:** US2.UC3
- **Actor:** Authenticated user who turned **auto** off and picked a model
- **Preconditions:** `auto=false`; `mainModel` set to an **enabled** model.
- **Trigger:** User sends a prompt with a manually selected model.
- **Main flow:**
  1. Client `POST /api/chat` with `auto=false, mainModel=<id>`.
  2. Handler skips routing and uses exactly `mainModel`; **no** `route` event is emitted.
  3. The answer streams from `mainModel`; `usage_records` `role="single"` uses `mainModel`.
  4. **Logged:** `activity_logs` `mode="fast"`, `auto=false`, `modelId=mainModel`.
- **Alternate / error flows:**
  - `mainModel` is disabled or unknown → `400 MODEL_NOT_AVAILABLE`; nothing streamed.
- **Postconditions:** The answer is attributable to the user's explicit model choice.
- **Acceptance criteria:**
  - **Given** `auto=false` and `mainModel="claude-opus"`, **When** `POST /api/chat`, **Then** the stream emits **no** `route` event and the `usage_records` row's `modelId` is `claude-opus`.
  - **Given** `auto=false` and a disabled `mainModel`, **When** `POST /api/chat`, **Then** the response is `400 MODEL_NOT_AVAILABLE`.
  - **Given** two Fast sends with different manual models, **When** each completes, **Then** each turn's `usage_records.modelId` matches the model chosen for that send.

### US2.UC4 — Copy the answer
- **ID:** US2.UC4
- **Actor:** Authenticated user viewing a completed Fast answer
- **Preconditions:** A completed assistant message exists.
- **Trigger:** User clicks the copy control on the answer.
- **Main flow:**
  1. Copy is a client-side action (`copyResult` writes to the clipboard and flips a transient `copied` flag for ~1.5s).
  2. No model call occurs; optionally the client may emit a lightweight `POST /api/activity` `{ action: "chat.copy", turnId }` for analytics.
  3. **Logged (optional):** `activity_logs` `action="chat.copy"`; **no** `usage_records` row.
- **Alternate / error flows:**
  - Clipboard API unavailable/denied → the action is a silent no-op (matches store's try/catch); the copied-state still toggles briefly.
- **Postconditions:** The exact answer text is on the clipboard; no billing impact.
- **Acceptance criteria:**
  - **Given** a completed answer, **When** the user clicks copy, **Then** the clipboard contains the **exact** final answer text and the copied indicator appears for ~1.5s.
  - **Given** a copy action, **When** it completes, **Then** **no** `usage_records` row is written and the turn cost is unchanged.
  - **Given** the optional copy beacon, **When** it is sent, **Then** an `activity_logs` row `action="chat.copy"` exists with the correct `turnId`.

### US2.UC5 — See per-turn token usage and cost
- **ID:** US2.UC5
- **Actor:** Authenticated user reviewing a completed Fast turn
- **Preconditions:** At least one completed Fast turn.
- **Trigger:** The turn completes (inline cost chip) or the user opens Usage.
- **Main flow:**
  1. On `done`, the SSE payload includes `usage` `{ inputTokens, outputTokens, costMicro, platformFeeMicro, totalMicro }`.
  2. Cost is computed as `inputTokens/1e6 × pin + outputTokens/1e6 × pout` for the model, **plus ¥0.05** platform fee, stored in micro-cents.
  3. `GET /api/usage` reflects this turn in totals and the call ledger.
  4. **Logged:** `usage_records` carries the precise per-call token and cost fields.
- **Alternate / error flows:**
  - Pricing for an unknown model id → server falls back to a default price (`in:5,out:15`) and flags `pricingFallback=true` in `details` (mirrors `respCost` default).
- **Postconditions:** The user can see exactly what the turn cost, down to micro-cents.
- **Acceptance criteria:**
  - **Given** a completed Fast turn on `gpt-55` (pin 20 / pout 80 per 1M), **When** the `done` event arrives, **Then** `costMicro` equals `inputTokens×20 + outputTokens×80` (per-1M, in micro-cents) **plus** `platformFeeMicro = ¥0.05`.
  - **Given** the same turn, **When** `GET /api/usage` is queried, **Then** the turn's tokens and cost are included in the aggregate totals.
  - **Given** any single Fast turn, **When** its fee is read, **Then** `platformFeeMicro` equals exactly one ¥0.05 unit (one model call).

---

## US3 — Multi-expert fusion

**As a** user with a hard or open-ended question, **I want** **多专家模式 (Multi-expert mode)** to
run several expert models in parallel, show me the **思考过程 / reasoning trace**, then have a
**Final Compiler** synthesize one consolidated answer — and let me **regenerate** it — **so that**
I get a higher-quality, deduplicated answer that draws on each model's strongest points.

**Priority:** P0.

**Notes from the frontend:** In Expert mode `send()` builds one `StreamCall` per model in the
**trio**, streams them in parallel, then a `FusionState` (compiler = `mainModel`) streams a
`buildReason()` trace followed by a `buildFusion()` final answer. The completed turn appends a
`LedgerRecord` with **N expert calls + 1 fusion call** (each billed with its own ¥0.05 fee).
`regenerate()` re-runs the **same** trio + compiler for the same prompt.

### US3.UC1 — Run the expert trio in parallel
- **ID:** US3.UC1
- **Actor:** Authenticated user in Expert mode
- **Preconditions:** Valid session; `mode="expert"`; a `trio` of 3 enabled models configured.
- **Trigger:** User sends a prompt in Expert mode.
- **Main flow:**
  1. Client `POST /api/chat` with `{ mode: "expert", prompt, trio, mainModel, deepResearch }`, `Accept: text/event-stream`.
  2. Handler validates with zod (trio of valid, enabled model ids), authenticates.
  3. Handler launches the trio **concurrently**; the SSE stream multiplexes `expert` token deltas tagged by `modelId`, each closing with its own per-expert `usage`.
  4. **Logged:** one `usage_records` row per expert (`role="expert"`), each with its own ¥0.05 fee; `activity_logs` `action="chat.send"`, `mode="expert"`.
- **Alternate / error flows:**
  - A trio with `< 3` or a disabled model → `400 INVALID_TRIO`.
  - One expert fails → its `expert` stream emits `error`; remaining experts continue; fusion proceeds with the survivors (degraded, flagged in `details`).
- **Postconditions:** Up to 3 expert answers are produced and individually billed.
- **Acceptance criteria:**
  - **Given** a valid 3-model trio, **When** `POST /api/chat` (expert), **Then** the stream interleaves token deltas from all three `modelId`s and writes **3** `usage_records` rows with `role="expert"`.
  - **Given** a trio containing a disabled model, **When** the request is sent, **Then** the response is `400 INVALID_TRIO`.
  - **Given** one expert errors mid-stream, **When** the turn proceeds, **Then** fusion still runs over the surviving experts and `details` notes the degraded count.

### US3.UC2 — Stream the reasoning / thinking trace
- **ID:** US3.UC2
- **Actor:** Authenticated user watching an Expert turn
- **Preconditions:** All experts have finished (the store gates fusion on `experts.every(done)`).
- **Trigger:** The trio completes; the compiler begins reasoning.
- **Main flow:**
  1. After experts finish, the SSE stream emits a `reason` phase: `reasonStart`, then `reason` token deltas (the `buildReason()` trace comparing the experts), then `reasonDone`.
  2. The trace is attributed to the compiler model (`fusion.modelId = mainModel`) and is collapsible in the UI (思考过程).
  3. Reasoning tokens are tracked separately and recorded as `reasoningTokens` on the fusion `usage_records` row.
  4. **Logged:** the fusion row's `reasoningTokens` is populated; `activity_logs` notes phase transitions.
- **Alternate / error flows:**
  - Compiler model disabled at fusion time → `409 COMPILER_UNAVAILABLE`; experts already billed; turn marked partial.
- **Postconditions:** The user can inspect how the compiler weighed each expert before the final answer.
- **Acceptance criteria:**
  - **Given** all experts finished, **When** the compiler runs, **Then** the stream emits a `reason` phase **before** any `final` token and the trace references each expert by name.
  - **Given** the fusion `usage_records` row, **When** inspected, **Then** `reasoningTokens > 0` and is separate from `outputTokens`.
  - **Given** the compiler model is disabled, **When** fusion is about to start, **Then** the response is `409 COMPILER_UNAVAILABLE`.

### US3.UC3 — Final Compiler synthesizes one answer
- **ID:** US3.UC3
- **Actor:** Authenticated user
- **Preconditions:** Reasoning trace complete.
- **Trigger:** Compiler transitions from reasoning to final synthesis.
- **Main flow:**
  1. The stream emits a `final` phase: `finalStart`, `final` token deltas (the `buildFusion()` consolidated answer), then `done` with the fusion `usage` and the **turn total**.
  2. The fusion answer is a **fresh rewrite** that dedupes overlapping points and keeps each expert's strongest contribution (not a meta-summary).
  3. One `usage_records` row (`role="fusion"`) is written with its own ¥0.05 fee.
  4. **Logged:** the turn's final `usage_records` row; `activity_logs` `status=200`, total `latencyMs` for the turn.
- **Alternate / error flows:**
  - Fusion fails after experts succeed → experts remain billed; an SSE `error` event closes the turn; total reflects only the successful calls.
- **Postconditions:** The conversation holds one consolidated assistant answer plus the expert traces.
- **Acceptance criteria:**
  - **Given** the experts and reasoning are done, **When** fusion completes, **Then** a single `final` answer is delivered and the turn's `usage_records` count is **N experts + 1 fusion**.
  - **Given** a completed Expert turn, **When** the `done` event arrives, **Then** the turn total equals the sum of all expert + fusion costs **plus N+1 × ¥0.05** platform fees.
  - **Given** the fusion answer, **When** compared to any single expert answer, **Then** it is a distinct consolidated text (not byte-identical to one expert).

### US3.UC4 — Regenerate an Expert turn
- **ID:** US3.UC4
- **Actor:** Authenticated user dissatisfied with a result
- **Preconditions:** A completed Expert assistant message exists; no turn currently streaming.
- **Trigger:** User clicks Regenerate on the assistant message.
- **Main flow:**
  1. Client `POST /api/chat/regenerate` with `{ conversationId, turnId }`.
  2. Handler reloads the original turn's `promptText`, **same trio**, and **same compiler** (mirrors `regenerate()`), then re-runs the full expert→reason→fusion pipeline as a new stream.
  3. The new result **replaces** the prior assistant message in place (same message id), but produces **new** `usage_records` rows (regeneration is billable).
  4. **Logged:** `activity_logs` `action="chat.regenerate"`; a fresh set of `usage_records` for the re-run.
- **Alternate / error flows:**
  - Regenerate while a stream is in progress → `409 STREAM_IN_PROGRESS` (mirrors `if (streaming) return`).
  - Original turn not found → `404 TURN_NOT_FOUND`.
  - Regenerate also applies to Fast turns (re-runs the same single model); the endpoint handles both modes.
- **Postconditions:** The turn shows a fresh answer; usage reflects both the original and the regeneration.
- **Acceptance criteria:**
  - **Given** a completed Expert turn, **When** `POST /api/chat/regenerate`, **Then** the same trio and compiler are re-run and the assistant message id is unchanged while its content updates.
  - **Given** a regeneration, **When** it completes, **Then** a **new** set of `usage_records` rows is written (the original rows are retained).
  - **Given** a turn already streaming, **When** regenerate is requested, **Then** the response is `409 STREAM_IN_PROGRESS`.

### US3.UC5 — Per-call accounting across the whole Expert turn
- **ID:** US3.UC5
- **Actor:** Authenticated user reviewing an Expert turn's cost
- **Preconditions:** A completed Expert turn with a trio + fusion.
- **Trigger:** Turn completes / user opens the call ledger.
- **Main flow:**
  1. Each expert and the fusion call are billed independently: `tokens × per-model price + ¥0.05` each.
  2. The `done` event and `GET /api/usage` expose the per-call breakdown and the turn total.
  3. **Logged:** `N+1` `usage_records` rows, one per model call, each with `costMicro` + `platformFeeMicro`.
- **Alternate / error flows:**
  - A degraded turn (one expert failed) bills only the calls that ran; the total and fee count reflect the actual number of calls.
- **Postconditions:** The ledger precisely attributes cost to each model call in the turn.
- **Acceptance criteria:**
  - **Given** a 3-expert turn, **When** it completes, **Then** the call ledger shows **4** rows (3 experts + 1 fusion) for that turn.
  - **Given** that turn, **When** the total fee is summed, **Then** it equals `4 × ¥0.05`.
  - **Given** a degraded turn where one expert failed, **When** its fees are summed, **Then** the fee count equals the number of calls that actually ran (e.g. `3 × ¥0.05`).

---

## US4 — Intent routing & orchestration

**As a** user, **I want** OmniMind to **auto-route** each prompt to the best model by intent, let me
**set the main model**, **configure the expert trio**, and **switch modes**, **so that** I control how
much orchestration happens and which models do the work.

**Priority:** P0.

**Notes from the frontend:** `auto` toggles intent routing; `mainModel` is both the Fast-mode
manual pick and the **compiler** in Expert mode; `trio` is the configurable list of 3 expert
models; `mode` switches between Fast and Expert. These are user preferences persisted server-side
and echoed into each `POST /api/chat` request.

### US4.UC1 — Auto-route a prompt by intent (preview)
- **ID:** US4.UC1
- **Actor:** Authenticated user with auto routing on
- **Preconditions:** `auto=true`.
- **Trigger:** User wants to see (or the client wants to pre-resolve) which model a prompt routes to.
- **Main flow:**
  1. Client `POST /api/chat/route` with `{ prompt, lang }` (a pure routing preview, no generation).
  2. The server router classifies intent and returns `{ modelId, label }` plus a localized route string.
  3. **Logged:** `activity_logs` `action="chat.route"`, resolved `modelId`; **no** `usage_records` (no model call).
- **Alternate / error flows:**
  - Empty prompt → `400 VALIDATION_ERROR`.
  - Routed model disabled → returns the next eligible model with `fallback=true`.
- **Postconditions:** The client can show the routing decision before sending.
- **Acceptance criteria:**
  - **Given** a code-intent prompt, **When** `POST /api/chat/route`, **Then** `data.modelId === "deepseek-pro"` and `data.label` is the localized "Code" label.
  - **Given** a planning prompt ("规划"/"plan"), **When** routed, **Then** `data.modelId === "gemini-pro"`.
  - **Given** a route preview call, **When** it returns, **Then** **no** `usage_records` row is written.

### US4.UC2 — Set the main model
- **ID:** US4.UC2
- **Actor:** Authenticated user
- **Preconditions:** Valid session; target model is enabled.
- **Trigger:** User picks a model as "main" (Fast pick / Expert compiler).
- **Main flow:**
  1. Client `PATCH /api/preferences` with `{ mainModel: <id> }` (also reachable via `PATCH /api/models/:id` with `setMain=true`, see US5).
  2. Handler validates the id exists and is enabled, persists it to the user's preferences.
  3. Subsequent `POST /api/chat` requests default to this `mainModel`.
  4. **Logged:** `activity_logs` `action="prefs.update"`, `field="mainModel"`.
- **Alternate / error flows:**
  - Unknown or disabled id → `400 MODEL_NOT_AVAILABLE`; preference unchanged.
- **Postconditions:** The user's default Fast pick / compiler is updated.
- **Acceptance criteria:**
  - **Given** an enabled model id, **When** `PATCH /api/preferences { mainModel }`, **Then** `GET /api/preferences` returns the new `mainModel`.
  - **Given** a disabled model id, **When** setting it as main, **Then** the response is `400 MODEL_NOT_AVAILABLE`.
  - **Given** a new `mainModel`, **When** an Expert turn runs, **Then** the fusion/compiler uses that model.

### US4.UC3 — Configure the expert trio
- **ID:** US4.UC3
- **Actor:** Authenticated user customizing Expert mode
- **Preconditions:** Valid session.
- **Trigger:** User edits the set of 3 expert models.
- **Main flow:**
  1. Client `PATCH /api/preferences` with `{ trio: [id1, id2, id3] }`.
  2. Handler validates: exactly 3 ids, all distinct, all valid and enabled.
  3. The new trio is persisted and used by subsequent Expert sends.
  4. **Logged:** `activity_logs` `action="prefs.update"`, `field="trio"`.
- **Alternate / error flows:**
  - Wrong length, duplicates, or a disabled id → `400 INVALID_TRIO` with offending ids in `details`.
- **Postconditions:** Expert mode uses the user's chosen experts.
- **Acceptance criteria:**
  - **Given** 3 distinct enabled ids, **When** `PATCH /api/preferences { trio }`, **Then** `GET /api/preferences` returns that exact trio.
  - **Given** a trio with a duplicate id, **When** saved, **Then** the response is `400 INVALID_TRIO`.
  - **Given** a saved trio, **When** an Expert turn runs, **Then** exactly those 3 models stream as experts.

### US4.UC4 — Switch between Fast and Expert modes
- **ID:** US4.UC4
- **Actor:** Authenticated user
- **Preconditions:** Valid session.
- **Trigger:** User toggles the mode bar between 快速模式 and 多专家模式.
- **Main flow:**
  1. Client `PATCH /api/preferences` with `{ mode: "fast" | "expert" }` to persist the default.
  2. The next `POST /api/chat` carries the chosen `mode`; the server branches to single-model or trio+fusion orchestration accordingly.
  3. **Logged:** `activity_logs` `action="prefs.update"`, `field="mode"`.
- **Alternate / error flows:**
  - Invalid mode value → `400 VALIDATION_ERROR`.
  - Mode change mid-stream does not affect the in-flight turn (the turn keeps the mode it started with).
- **Postconditions:** The active default mode is updated; chat orchestration follows it.
- **Acceptance criteria:**
  - **Given** `mode="expert"`, **When** persisted and a prompt is sent, **Then** the chat handler runs the trio+fusion pipeline.
  - **Given** `mode="fast"`, **When** persisted and a prompt is sent, **Then** the chat handler runs a single model.
  - **Given** an invalid mode string, **When** `PATCH /api/preferences`, **Then** the response is `400 VALIDATION_ERROR`.

### US4.UC5 — Toggle auto-routing on/off
- **ID:** US4.UC5
- **Actor:** Authenticated user
- **Preconditions:** Valid session; `mode="fast"` (auto governs Fast-mode model selection).
- **Trigger:** User flips the **auto** toggle.
- **Main flow:**
  1. Client `PATCH /api/preferences` with `{ auto: boolean }`.
  2. With `auto=true`, Fast sends route by intent and emit a `route` event; with `auto=false`, Fast sends use `mainModel` and emit no `route` event.
  3. **Logged:** `activity_logs` `action="prefs.update"`, `field="auto"`.
- **Alternate / error flows:**
  - Non-boolean value → `400 VALIDATION_ERROR`.
- **Postconditions:** Fast-mode model selection strategy reflects the toggle.
- **Acceptance criteria:**
  - **Given** `auto=true`, **When** a Fast prompt is sent, **Then** the chat stream includes a `route` event.
  - **Given** `auto=false`, **When** a Fast prompt is sent, **Then** no `route` event is emitted and `mainModel` is used.
  - **Given** a non-boolean `auto`, **When** `PATCH /api/preferences`, **Then** the response is `400 VALIDATION_ERROR`.

---

## US5 — Model library management

**As a** user, **I want** to browse all **12 models** with their tiers, pricing, and context windows,
**enable/disable** any of them, **set one as main**, and reach extra models through the **OpenRouter**
gateway, **so that** I curate exactly which models OmniMind can use and understand what each costs.

**Priority:** P0.

**Notes from the frontend:** `components/ModelsView.tsx` lists the 12 models from
`lib/models.ts` (id, name, vendor, color, initials, **tier** flagship/fast/balanced, tags,
`ctx`, `pin`/`pout` per-1M), with per-model **enable** toggles and **set-as-main**. The server
registry (`lib/server/llm/registry.ts`) is authoritative and mirrors the client list; OpenRouter
exposes additional models (`OPENROUTER_MODELS`).

### US5.UC1 — List all 12 models with metadata
- **ID:** US5.UC1
- **Actor:** Authenticated user opening the Models view
- **Preconditions:** Valid session.
- **Trigger:** User navigates to Models.
- **Main flow:**
  1. Client `GET /api/models`.
  2. Handler returns all 12 models from the server registry, merged with the user's enable flags and `mainModel`, including `{ id, name, vendor, color, initials, tier, tags, ctx, pin, pout, enabled, isMain }`.
  3. **Logged:** `activity_logs` `action="models.list"`, `status=200`.
- **Alternate / error flows:**
  - Unauthenticated → `401 AUTH_REQUIRED`.
- **Postconditions:** The full library is available for display.
- **Acceptance criteria:**
  - **Given** a valid session, **When** `GET /api/models`, **Then** `data.models.length === 12` and each item carries `tier`, `ctx`, `pin`, `pout`, and `enabled`.
  - **Given** the response, **When** inspected, **Then** exactly one model has `isMain === true`.
  - **Given** the registry, **When** compared to `lib/models.ts`, **Then** ids, prices, and tiers match (server is authoritative).

### US5.UC2 — Enable / disable a model
- **ID:** US5.UC2
- **Actor:** Authenticated user
- **Preconditions:** Valid session; target model exists.
- **Trigger:** User flips a model's enable toggle.
- **Main flow:**
  1. Client `PATCH /api/models/:id` with `{ enabled: boolean }`.
  2. Handler persists the per-user enable flag; disabled models are excluded from routing, trios, and main-model selection.
  3. **Logged:** `activity_logs` `action="models.toggle"`, `modelId`, `enabled`.
- **Alternate / error flows:**
  - Disabling the current `mainModel` → `409 CANNOT_DISABLE_MAIN` (must set a new main first).
  - Disabling a model that is part of the current `trio` → `409 MODEL_IN_TRIO` (must edit the trio first).
  - Unknown id → `404 MODEL_NOT_FOUND`.
- **Postconditions:** The model's availability for orchestration reflects the toggle.
- **Acceptance criteria:**
  - **Given** an enabled non-main, non-trio model, **When** `PATCH /api/models/:id { enabled:false }`, **Then** `GET /api/models` shows it `enabled:false` and the router never selects it.
  - **Given** the current main model, **When** disabling it, **Then** the response is `409 CANNOT_DISABLE_MAIN`.
  - **Given** a model in the active trio, **When** disabling it, **Then** the response is `409 MODEL_IN_TRIO`.

### US5.UC3 — Set a model as main
- **ID:** US5.UC3
- **Actor:** Authenticated user
- **Preconditions:** Valid session; target model is enabled.
- **Trigger:** User clicks "Set as main" on a model card.
- **Main flow:**
  1. Client `PATCH /api/models/:id` with `{ setMain: true }`.
  2. Handler verifies the model is enabled, sets it as the user's `mainModel`, clears the prior main's `isMain`.
  3. **Logged:** `activity_logs` `action="models.setMain"`, `modelId`.
- **Alternate / error flows:**
  - Disabled or unknown model → `400 MODEL_NOT_AVAILABLE` / `404 MODEL_NOT_FOUND`.
- **Postconditions:** Exactly one model is main; Fast picks and the Expert compiler default to it.
- **Acceptance criteria:**
  - **Given** an enabled model, **When** `PATCH /api/models/:id { setMain:true }`, **Then** `GET /api/models` shows exactly that model `isMain:true` and all others `false`.
  - **Given** a disabled model, **When** set as main, **Then** the response is `400 MODEL_NOT_AVAILABLE`.
  - **Given** a new main is set, **When** a Fast turn runs with `auto=false`, **Then** it uses the new main model.

### US5.UC4 — Inspect tiers, pricing, and context windows
- **ID:** US5.UC4
- **Actor:** Authenticated user comparing models
- **Preconditions:** Valid session.
- **Trigger:** User reviews a model's tier badge, per-1M prices, and context window.
- **Main flow:**
  1. The `GET /api/models` payload includes `tier` (flagship/fast/balanced), `pin`/`pout` (¥ per 1M in/out), and `ctx` (e.g. "128K", "1M", "2M").
  2. Tags are localized server-side per the user's language (zh / zh-TW / en / ja) to match the client tag maps.
  3. **Logged:** covered by `models.list`.
- **Alternate / error flows:**
  - Requested `lang` unsupported → server falls back en→zh (mirrors `pick()`).
- **Postconditions:** The user can compare cost/capability across the library.
- **Acceptance criteria:**
  - **Given** `gpt-55`, **When** `GET /api/models`, **Then** its `tier === "flagship"`, `pin === 20`, `pout === 80`, `ctx === "400K"`.
  - **Given** `lang="ja"`, **When** models are listed, **Then** tags are returned in Japanese (e.g. 推理→推論).
  - **Given** an unsupported `lang`, **When** listed, **Then** tags fall back to English then Chinese without error.

### US5.UC5 — Reach extra models via the OpenRouter gateway
- **ID:** US5.UC5
- **Actor:** Authenticated user who needs a model outside the core 12
- **Preconditions:** Valid session; OpenRouter gateway configured (or mock-listed in keyless mode).
- **Trigger:** User browses the OpenRouter section of the library.
- **Main flow:**
  1. Client `GET /api/models?gateway=openrouter` returns the OpenRouter catalog (e.g. Llama 4 405B, Mistral Large 3, Grok 4, Command R+) as additional, selectable models.
  2. Selecting an OpenRouter model routes calls through the AI Gateway using a `"provider/model"` string; cost accounting and the ¥0.05 fee apply identically.
  3. **Logged:** `activity_logs` `action="models.list"`, `gateway="openrouter"`; usage rows for OpenRouter calls carry the gateway model id.
- **Alternate / error flows:**
  - Gateway unconfigured in `gateway` mode → `503 GATEWAY_UNAVAILABLE`; in `mock` mode the catalog is returned deterministically.
- **Postconditions:** The user can use models beyond the core 12 with the same billing semantics.
- **Acceptance criteria:**
  - **Given** `GET /api/models?gateway=openrouter`, **When** in mock mode, **Then** the OpenRouter catalog (at least Llama 4 405B, Mistral Large 3, Grok 4, Command R+) is returned.
  - **Given** an OpenRouter model is used for a chat turn, **When** the turn completes, **Then** a `usage_records` row exists with that model id and a ¥0.05 platform fee.
  - **Given** `gateway` mode with no OpenRouter key, **When** the catalog is requested, **Then** the response is `503 GATEWAY_UNAVAILABLE`.

---

<!-- US6–US10 bodies are appended in a separate pass; see the table of contents above. -->
