## US6 — Usage & Cost Analytics

**As a** signed-in OmniMind user
**I want** precise, per-call token and cost analytics — a per-turn ledger, running totals, a 7-day trend, a cost-by-model breakdown, and a drill-down call ledger
**so that** I can understand exactly what I spent, on which model, for which request, down to the token.

**Priority:** P0 (core differentiator — "precise token-level cost accounting")

All amounts are computed server-side from persisted `usage_records` rows (micro-cents CNY, integer) so analytics never re-derive cost from the client. Money is formatted at the edge per `fmtMoney`. The platform fee is `PLATFORM_FEE_CNY` (default ¥0.05) per model call. All read endpoints are wrapped by the standard handler (requestId, auth guard, zod validation, timing) and write an `activity_logs` row.

### US6.UC1 — Usage summary aggregates (totals)
- **id:** US6.UC1
- **actor:** Authenticated user (account owner)
- **preconditions:** Valid session cookie; user has ≥0 persisted `usage_records`.
- **trigger:** User opens the **用量 / Usage** view; client calls the aggregate endpoint.
- **main flow:**
  1. `GET /api/usage/summary?window=7d` (default `7d`; also `30d`, `all`, or explicit `from`/`to` epoch-ms).
  2. Handler authenticates via `auth/guard.ts`, validates query with `UsageSummaryQuery` zod schema.
  3. `usage/aggregate.ts` sums the user's `usage_records` in-window: `totalInputTokens`, `totalOutputTokens`, `totalReasoningTokens`, `modelCostMicro` (Σ costMicro), `platformFeeMicro` (Σ platformFeeMicro), `totalMicro` (= modelCost+fee), `callCount` (rows), `requestCount` (distinct `turnId`).
  4. Returns `{ ok:true, data:{ window, totals:{ inputTokens, outputTokens, reasoningTokens, modelCostMicro, platformFeeMicro, totalMicro, callCount, requestCount }, platformFeePerCallMicro } }`. This maps 1:1 to the five Usage stat cards (Total tokens, Model cost, Platform fees, Total cost, Requests).
  - **logging:** `activity_logs` row `{ requestId, userId, action:"usage.summary", route, status:200, latencyMs, meta:{ window, requestCount } }`. No new `usage_records` (read-only).
- **alt/error:**
  - No records in window → all totals `0`, `callCount:0`, HTTP 200 (empty-but-valid, mirrors the seeded-then-empty client state).
  - Invalid `window`/`from`/`to` → `400 VALIDATION_ERROR` with zod `details`.
  - Missing/expired session → `401 AUTH_REQUIRED`.
- **postconditions:** No state change; one `activity_logs` row appended.
- **acceptance criteria:**
  - **Given** a user with persisted calls totalling ¥X model cost and N calls, **When** they GET `/api/usage/summary?window=7d`, **Then** `modelCostMicro` equals Σ of in-window `costMicro` and `platformFeeMicro` equals `N × platformFeePerCallMicro`, and `totalMicro = modelCostMicro + platformFeeMicro`.
  - **Given** a brand-new user, **When** they request the summary, **Then** all totals are `0` and the response is `200 ok:true`.
  - **Given** any summary request, **Then** exactly one `activity_logs` row with `action:"usage.summary"` is written.

### US6.UC2 — 7-day cost trend
- **id:** US6.UC2
- **actor:** Authenticated user
- **preconditions:** Valid session.
- **trigger:** Usage view renders the 7-day bar trend.
- **main flow:**
  1. `GET /api/usage/trend?days=7` (1–90; default 7).
  2. `aggregate.ts` buckets in-window `usage_records` by **local-day** boundaries (server computes day keys at `00:00` for the last `days` days inclusive of today), summing `costMicro + platformFeeMicro` per day.
  3. Returns `{ ok:true, data:{ days:[ { key (epoch-ms day-start), label ("M/D"), totalMicro } … ] } }` — always exactly `days` entries, zero-filled for empty days, oldest→newest, matching `TrendDayVM`.
  - **logging:** `activity_logs` `action:"usage.trend"`, `meta:{ days }`.
- **alt/error:**
  - `days` out of range → `400 VALIDATION_ERROR`.
  - Records older than the window are excluded (not clamped into day 0).
- **postconditions:** No state change.
- **acceptance criteria:**
  - **Given** `days=7`, **Then** the response contains exactly 7 day buckets ending today, oldest first, each with a zero-filled `totalMicro`.
  - **Given** two calls on the same calendar day, **Then** their `costMicro+platformFeeMicro` are summed into one bucket.
  - **Given** a call 8 days ago with `days=7`, **Then** it appears in no bucket.

### US6.UC3 — Cost-by-model breakdown
- **id:** US6.UC3
- **actor:** Authenticated user
- **preconditions:** Valid session; ≥1 `usage_records` row in window.
- **trigger:** Usage view renders the "cost by model" bars.
- **main flow:**
  1. `GET /api/usage/by-model?window=7d&limit=6`.
  2. `aggregate.ts` groups in-window rows by `modelId`: per model `{ modelId, calls, modelCostMicro }`; sorted by `modelCostMicro` desc; top `limit` returned.
  3. For each model the response includes registry display fields (`name`, `color`) and a `sharePct` = `modelCostMicro / Σ modelCostMicro` (server-rounded), matching `PerModelVM`.
  4. Returns `{ ok:true, data:{ models:[…], totalModelCostMicro } }`.
  - **logging:** `activity_logs` `action:"usage.by_model"`, `meta:{ distinctModels }`.
- **alt/error:**
  - Empty window → `models:[]`, `totalModelCostMicro:0`, HTTP 200.
  - Unknown `modelId` in old rows (model later removed) → still grouped; `name`/`color` fall back to a generic registry default.
- **postconditions:** No state change.
- **acceptance criteria:**
  - **Given** calls across 3 models, **When** GET `/api/usage/by-model`, **Then** results are sorted by cost desc and each `sharePct` sums to ~100%.
  - **Given** `limit=6` with 9 models used, **Then** only the 6 costliest are returned but `totalModelCostMicro` reflects all 9.
  - **Given** a model that was used then deleted from the registry, **Then** its row still appears with a fallback name and no error.

### US6.UC4 — Per-turn ledger detail (call drill-down)
- **id:** US6.UC4
- **actor:** Authenticated user
- **preconditions:** Valid session; user owns the turns.
- **trigger:** Usage view renders the call-ledger table (latest 12) / user paginates.
- **main flow:**
  1. `GET /api/usage/ledger?limit=12&cursor=<turnId|null>`.
  2. `usage/ledger.ts` selects the user's turns newest-first; for each turn joins its `usage_records` rows.
  3. Each ledger row returns `{ turnId, ts, prompt (truncated), mode (fast|expert), models:[{ modelId, name, color }] (de-duped, role-ordered), inputTokens, outputTokens, modelCostMicro, platformFeeMicro, totalMicro }`, matching `LedgerRowVM`.
  4. Returns `{ ok:true, data:{ rows:[…], nextCursor } }` for cursor pagination.
  - **logging:** `activity_logs` `action:"usage.ledger"`, `meta:{ limit, returned }`.
- **alt/error:**
  - `cursor` referencing a turn the user does not own → ignored (starts from newest); never leaks others' turns.
  - `limit` > 100 → clamped to 100 (or `400` if you prefer strict; contract clamps).
- **postconditions:** No state change.
- **acceptance criteria:**
  - **Given** an expert-mode turn with 3 experts + 1 fusion call, **Then** its ledger row shows 4 `usage_records` summed and `models` lists the distinct model ids in role order (experts then compiler).
  - **Given** `limit=12` and 30 turns, **Then** 12 rows return with a non-null `nextCursor`, and following the cursor returns the next page with no overlap.
  - **Given** user A requests the ledger, **Then** no row belonging to user B is ever returned (ownership-scoped query).

### US6.UC5 — Export usage as CSV/JSON
- **id:** US6.UC5
- **actor:** Authenticated user (Team/Enterprise feature surfaced; allowed for all here)
- **preconditions:** Valid session.
- **trigger:** User clicks "Export" on the Usage view.
- **main flow:**
  1. `GET /api/usage/export?format=csv&window=30d` (`format` ∈ `csv|json`).
  2. Handler streams the user's in-window `usage_records` joined to turn metadata: one row per model call with columns `ts, turnId, mode, modelId, modelName, role, inputTokens, outputTokens, reasoningTokens, modelCostMicro, platformFeeMicro, totalMicro`.
  3. Money columns are emitted as integer micro-cents **and** a formatted `¥` column for human readers; response `Content-Type: text/csv` (or `application/json`) with `Content-Disposition: attachment; filename="omnimind-usage-<window>.csv"`.
  - **logging:** `activity_logs` `action:"usage.export"`, `meta:{ format, window, rowCount }`.
- **alt/error:**
  - Unknown `format` → `400 VALIDATION_ERROR`.
  - Very large window → streamed (no full buffering); export remains ownership-scoped.
- **postconditions:** No state change; export is reproducible from persisted ledger.
- **acceptance criteria:**
  - **Given** `format=csv`, **Then** the response has CSV content-type, a header row, and one data row per `usage_records` row in window.
  - **Given** `format=json`, **Then** the body is a valid JSON array of the same rows with integer micro-cent money fields.
  - **Given** any export, **Then** an `activity_logs` `usage.export` row records `rowCount`.

---

## US7 — Billing & Subscription

**As a** signed-in OmniMind user
**I want** to see my current plan, included credit and usage bar, this-month bill, browse plans (Free/Pro/Team/Enterprise), view invoices, top up credit, and manage my payment method
**so that** I control my subscription and never lose track of spend against my included credit.

**Priority:** P0

Billing reads derive month-to-date spend from `usage_records` (authoritative), not the client. The default seeded account is on **Pro** with **¥150 included credit**; the usage bar is `min(100%, monthTotal / includedCredit)`. All money is micro-cents CNY. Payment is a **stub** (no real PSP) but persisted so state survives reloads.

### US7.UC1 — Get current subscription + credit usage
- **id:** US7.UC1
- **actor:** Authenticated user
- **preconditions:** Valid session; a `subscriptions` row exists (seeded `pro`).
- **trigger:** User opens the **账单 / Billing** view.
- **main flow:**
  1. `GET /api/billing/subscription`.
  2. Handler loads the user's `subscriptions` row and computes month-to-date via `usage/aggregate.ts` over the **current calendar month**.
  3. Returns `{ ok:true, data:{ plan:{ id, name, includedCreditMicro, periodStart, periodEnd, renewsOn }, usage:{ modelCostMicro, platformFeeMicro, monthTotalMicro }, includedCreditMicro, remainingMicro (= max(0, included − monthTotal)), usedPct } }` — maps to the Billing header, usage bar, and "this month" panel (model cost / platform fee / month total).
  - **logging:** `activity_logs` `action:"billing.subscription"`, `meta:{ planId, usedPct }`.
- **alt/error:**
  - No subscription row → lazily create/return a `free` default; HTTP 200.
  - Missing session → `401 AUTH_REQUIRED`.
- **postconditions:** No state change (or idempotent free-plan backfill).
- **acceptance criteria:**
  - **Given** a Pro user with ¥45 month-to-date spend, **Then** `remainingMicro` equals `¥150 − ¥45` in micro-cents and `usedPct` = `30%` (clamped to 100%).
  - **Given** month-to-date exceeds included credit, **Then** `usedPct` is `100%` and `remainingMicro` is `0` (overage tracked separately).
  - **Given** a user with no subscription, **Then** a Free plan is returned with `includedCreditMicro:0`.

### US7.UC2 — List plans (Free/Pro/Team/Enterprise)
- **id:** US7.UC2
- **actor:** Authenticated user
- **preconditions:** Valid session.
- **trigger:** Billing view renders the plan cards.
- **main flow:**
  1. `GET /api/billing/plans`.
  2. `billing/plans.ts` returns the four canonical plans `[free, pro, team, ent]` with `{ id, name, priceMicro|null (Enterprise = custom/null), period, includedCreditMicro, featureKeys[] }`; the user's current plan id is flagged.
  3. Localized labels/feature copy are resolved client-side via i18n keys; the API returns stable `id`/`featureKeys`, matching `PlanVM` (current badge, choose/contact CTA).
  - **logging:** `activity_logs` `action:"billing.plans"`.
- **alt/error:**
  - Enterprise has `priceMicro:null` → client renders "Custom"/"Contact".
- **postconditions:** No state change.
- **acceptance criteria:**
  - **Given** a Pro user, **When** GET `/api/billing/plans`, **Then** exactly 4 plans return and the `pro` plan has `current:true`.
  - **Given** the `ent` plan, **Then** its `priceMicro` is `null` and its CTA resolves to "Contact".
  - **Given** the `pro` plan, **Then** `includedCreditMicro` equals ¥150 in micro-cents.

### US7.UC3 — Change / subscribe to a plan
- **id:** US7.UC3
- **actor:** Authenticated user
- **preconditions:** Valid session; target plan id is valid and not Enterprise (Enterprise routes to "contact sales").
- **trigger:** User clicks "Choose" on a non-current plan card.
- **main flow:**
  1. `POST /api/billing/subscription` body `{ planId }` validated by `ChangePlanBody` zod schema.
  2. `billing/subscription.ts` updates the user's `subscriptions` row: new `planId`, `includedCreditMicro`, `periodStart=now`, `periodEnd=now+1mo`; (stub PSP — no charge captured, marked `pending` for paid upgrades).
  3. Returns the refreshed subscription payload (same shape as US7.UC1).
  - **logging:** `activity_logs` `action:"billing.change_plan"`, `meta:{ fromPlan, toPlan }`. **No** `usage_records` (not a model call).
- **alt/error:**
  - `planId:"ent"` → `409 PLAN_REQUIRES_SALES` (or `200` with `{ contactSales:true }` per contract) — never auto-provisions Enterprise.
  - Unknown `planId` → `400 VALIDATION_ERROR`.
  - Down/upgrade keeps existing usage; included credit changes prospectively.
- **postconditions:** `subscriptions` row updated; subsequent `GET` reflects new plan and credit.
- **acceptance criteria:**
  - **Given** a Free user POSTing `{planId:"pro"}`, **Then** the subscription becomes `pro` with ¥150 included credit and `renewsOn` ≈ +1 month.
  - **Given** `{planId:"ent"}`, **Then** the API does not change the plan and signals contact-sales.
  - **Given** any plan change, **Then** an `activity_logs` `billing.change_plan` row records `fromPlan`/`toPlan`.

### US7.UC4 — List & download invoices
- **id:** US7.UC4
- **actor:** Authenticated user
- **preconditions:** Valid session; ≥0 `invoices` rows (seeded: 3 monthly Pro invoices).
- **trigger:** Billing view renders the invoice list / user clicks an invoice.
- **main flow:**
  1. `GET /api/billing/invoices` → `{ ok:true, data:{ invoices:[ { id, date, planLabel, amountMicro, status (paid|due|void) } … ] } }`, newest-first, matching `InvoiceVM`.
  2. `GET /api/billing/invoices/:id` returns a single invoice with line items (subscription fee + any top-ups + overage).
  - **logging:** `activity_logs` `action:"billing.invoices"` / `"billing.invoice_detail"`, `meta:{ invoiceId? }`.
- **alt/error:**
  - `:id` not owned by user → `404 NOT_FOUND` (never reveal existence of others' invoices).
  - No invoices → empty array, HTTP 200.
- **postconditions:** No state change.
- **acceptance criteria:**
  - **Given** a seeded Pro account, **When** GET `/api/billing/invoices`, **Then** 3 paid monthly invoices return newest-first, each `¥199.00` with `status:"paid"`.
  - **Given** an invoice id owned by another user, **Then** the detail endpoint returns `404`.
  - **Given** any invoice read, **Then** an `activity_logs` row is written.

### US7.UC5 — Top up credit & manage payment method
- **id:** US7.UC5
- **actor:** Authenticated user
- **preconditions:** Valid session.
- **trigger:** User clicks "充值 / Top up" or "Manage" payment method.
- **main flow:**
  1. **Top-up:** `POST /api/billing/topup` body `{ amountMicro }` (validated; min/max bounds). `billing/subscription.ts` credits the account's top-up balance, creates a `paid` `invoices` row of type `topup`, and returns the new `creditBalanceMicro` + the invoice.
  2. **Payment method:** `PUT /api/billing/payment-method` body `{ brand, last4, expMonth, expYear }` (stub — no PAN stored; only display fields). `GET /api/billing/payment-method` returns the masked method (`•••• last4`, expiry) for the "Payment method" panel.
  - **logging:** `activity_logs` `action:"billing.topup"` (`meta:{ amountMicro }`) / `"billing.payment_method"` (`meta:{ brand, last4 }`). Never log full card data.
- **alt/error:**
  - `amountMicro` ≤ 0 or above cap → `400 VALIDATION_ERROR`.
  - Invalid expiry (past) → `400 VALIDATION_ERROR`.
  - Stub PSP failure simulation → `402 PAYMENT_FAILED`, no balance change, no invoice.
- **postconditions:** Top-up: credit balance increased + invoice persisted. Payment method: masked method persisted and survives reload.
- **acceptance criteria:**
  - **Given** a successful `topup` of ¥100, **Then** `creditBalanceMicro` increases by ¥100 (micro-cents) and a `topup` invoice with `status:"paid"` is created.
  - **Given** `{amountMicro:0}`, **Then** the API returns `400` and balance is unchanged.
  - **Given** a PUT payment-method, **Then** GET returns only masked display fields (`last4`, expiry, brand) and never a full card number, and the value persists across requests.

---

## US8 — Conversations & History

**As a** signed-in OmniMind user
**I want** to create, list, rename, and delete conversations, see my recents and full message history, and copy or regenerate any assistant result
**so that** my work is organized, persistent, and resumable across sessions.

**Priority:** P0

A conversation owns ordered turns; each turn owns a user message and an assistant message (fast: one `single` call; expert: `experts[]` + `fusion`). Turns and their `usage_records` are the source of truth for history and the per-turn cost shown inline. All endpoints are ownership-scoped.

### US8.UC1 — Create a conversation
- **id:** US8.UC1
- **actor:** Authenticated user
- **preconditions:** Valid session.
- **trigger:** User clicks "新对话 / New chat" or sends the first prompt with no active conversation.
- **main flow:**
  1. `POST /api/conversations` body `{ title? }` (optional; auto-derived from first prompt if omitted).
  2. Handler inserts a `conversations` row `{ id (uuid), userId, title, createdAt, updatedAt }`.
  3. Returns `{ ok:true, data:{ conversation:{ id, title, createdAt, updatedAt } } }`. The chat composer then targets this `conversationId` for `POST /api/chat`.
  - **logging:** `activity_logs` `action:"conversation.create"`, `meta:{ conversationId }`.
- **alt/error:**
  - `title` too long → `400 VALIDATION_ERROR` (trim/limit).
  - Missing session → `401`.
- **postconditions:** New empty conversation persisted and owned by the user; appears at top of the list.
- **acceptance criteria:**
  - **Given** a POST with no title, **Then** a conversation is created with a placeholder title and a fresh uuid.
  - **Given** a POST with a title, **Then** that title is stored verbatim (trimmed).
  - **Given** creation, **Then** an `activity_logs` `conversation.create` row is written.

### US8.UC2 — List conversations & recents
- **id:** US8.UC2
- **actor:** Authenticated user
- **preconditions:** Valid session.
- **trigger:** App shell mounts (sidebar recents) / user opens conversation list.
- **main flow:**
  1. `GET /api/conversations?limit=20&cursor=…` → conversations owned by the user, ordered by `updatedAt` desc, each `{ id, title, updatedAt, lastPrompt (preview), turnCount }`.
  2. The first few power the sidebar **最近 / Recents** (title + accent color derived deterministically), matching `RecentVM`.
  3. Returns `{ ok:true, data:{ conversations:[…], nextCursor } }`.
  - **logging:** `activity_logs` `action:"conversation.list"`, `meta:{ returned }`.
- **alt/error:**
  - No conversations → empty array, HTTP 200.
  - `cursor` not owned by user → ignored, list from newest.
- **postconditions:** No state change.
- **acceptance criteria:**
  - **Given** 5 conversations, **When** GET `/api/conversations`, **Then** they return newest-`updatedAt` first with `turnCount` per row.
  - **Given** user A lists conversations, **Then** none of user B's conversations appear.
  - **Given** `limit=20` with 50 conversations, **Then** a `nextCursor` is returned and following it pages with no overlap.

### US8.UC3 — Rename a conversation
- **id:** US8.UC3
- **actor:** Authenticated user (owner)
- **preconditions:** Valid session; conversation exists and is owned by the user.
- **trigger:** User edits a conversation title.
- **main flow:**
  1. `PATCH /api/conversations/:id` body `{ title }` (validated, non-empty, length-bounded).
  2. Handler verifies ownership, updates `title` and `updatedAt`.
  3. Returns the updated conversation summary.
  - **logging:** `activity_logs` `action:"conversation.rename"`, `meta:{ conversationId, titleLen }`.
- **alt/error:**
  - Not owner / not found → `404 NOT_FOUND`.
  - Empty/oversized title → `400 VALIDATION_ERROR`.
- **postconditions:** Title persisted; conversation moves to top by `updatedAt`.
- **acceptance criteria:**
  - **Given** an owned conversation, **When** PATCH with a new title, **Then** GET reflects the new title and a bumped `updatedAt`.
  - **Given** another user's conversation id, **Then** PATCH returns `404` and nothing changes.
  - **Given** an empty title, **Then** PATCH returns `400`.

### US8.UC4 — Delete a conversation
- **id:** US8.UC4
- **actor:** Authenticated user (owner)
- **preconditions:** Valid session; conversation owned by user.
- **trigger:** User deletes a conversation.
- **main flow:**
  1. `DELETE /api/conversations/:id`.
  2. Handler verifies ownership and deletes the conversation and its turns/messages (cascade). **`usage_records` are retained** (or soft-detached) so historical billing/analytics remain accurate; they reference `turnId` but billing totals must not change.
  3. Returns `{ ok:true, data:{ id, deleted:true } }`.
  - **logging:** `activity_logs` `action:"conversation.delete"`, `meta:{ conversationId, turnCount }`.
- **alt/error:**
  - Not owner / not found → `404 NOT_FOUND`.
  - Idempotent: deleting an already-deleted id → `404` (or `200 deleted:true` per contract).
- **postconditions:** Conversation no longer listed; usage/billing totals unaffected.
- **acceptance criteria:**
  - **Given** an owned conversation with 4 turns, **When** DELETE, **Then** it disappears from the list and its turns are gone, but `GET /api/usage/summary` totals are unchanged.
  - **Given** another user's conversation, **Then** DELETE returns `404`.
  - **Given** deletion, **Then** an `activity_logs` `conversation.delete` row records `turnCount`.

### US8.UC5 — Fetch message history + copy/regenerate a result
- **id:** US8.UC5
- **actor:** Authenticated user (owner)
- **preconditions:** Valid session; conversation owned by user with ≥1 turn.
- **trigger:** User opens a conversation (load history), copies a result, or clicks "重新生成 / Regenerate".
- **main flow:**
  1. **History:** `GET /api/conversations/:id/messages` returns ordered turns: each `{ turnId, user:{ text }, assistant:{ mode, routeText?, single? | experts[]?, fusion?, deepResearch }, perTurn:{ inputTokens, outputTokens, modelCostMicro, platformFeeMicro, totalMicro, callCount } }`. The completed text of each call is persisted (not re-streamed) so reload is instant.
  2. **Copy:** client-side action on persisted text; optionally logged `activity_logs` `action:"result.copy"` `meta:{ turnId, role }` (no model call).
  3. **Regenerate:** `POST /api/chat` with `{ conversationId, regenerateTurnId }` re-runs the **same prompt, mode, model/trio** as the original turn, streams via SSE (US2/US3 flow), and **writes new `usage_records`** for the re-run (regeneration is billable — it is real model calls).
  - **logging:** History → `activity_logs` `conversation.messages`. Regenerate → `activity_logs` `chat.regenerate` **plus** one `usage_records` row per model call of the re-run.
- **alt/error:**
  - Conversation not owned / not found → `404`.
  - `regenerateTurnId` not in conversation → `400 VALIDATION_ERROR`.
  - Regenerate while a turn is streaming → `409 STREAM_IN_PROGRESS`.
- **postconditions:** History read: no change. Regenerate: original turn's assistant content replaced (or appended per contract); new usage rows persisted; per-turn cost recomputed.
- **acceptance criteria:**
  - **Given** a conversation with a completed expert turn, **When** GET `/messages`, **Then** the assistant payload includes 3 experts + fusion with persisted text and a correct `perTurn.totalMicro` = model cost + `callCount × fee`.
  - **Given** a regenerate request for an existing fast-mode turn, **Then** the same model is re-run, new `usage_records` are written, and the per-turn cost reflects the new call (history not double-counted on the original).
  - **Given** copy of a result, **Then** the returned/persisted text matches the full assistant output (not the partially-streamed slice).

---

## US9 — Preferences & Localization

**As a** signed-in OmniMind user
**I want** to set theme (light/dark), language (zh / zh-TW / en / ja), toggle Deep Research and Deep Agents, and configure my defaults (start mode, default language, and platform-fee display)
**so that** the product remembers how I like to work across devices and sessions.

**Priority:** P1

Preferences persist in a `preferences` row per user and seed the store config (`defaultMode`, `defaultLang`, `platformFee`). The platform fee itself is governed by `PLATFORM_FEE_CNY` server-side; a user-level override is display/default only and never changes billed amounts unless explicitly an admin setting.

### US9.UC1 — Get preferences
- **id:** US9.UC1
- **actor:** Authenticated user
- **preconditions:** Valid session.
- **trigger:** App boot / settings panel open.
- **main flow:**
  1. `GET /api/preferences`.
  2. Returns `{ ok:true, data:{ theme, lang, defaultMode, deepResearch, deepAgents, platformFeePerCallMicro } }`. If no row exists, server defaults (`theme:"dark"`, `lang:"zh"`, `defaultMode:"expert"`, both toggles `false`, fee = `PLATFORM_FEE_CNY`) are returned.
  - **logging:** `activity_logs` `action:"prefs.get"`.
- **alt/error:**
  - Missing session → `401 AUTH_REQUIRED`.
- **postconditions:** No state change (lazy default backfill is idempotent).
- **acceptance criteria:**
  - **Given** a new user, **When** GET `/api/preferences`, **Then** server defaults are returned (`dark`, `zh`, `expert`, fee ¥0.05).
  - **Given** a user who previously saved `light`/`en`, **Then** those values are returned.
  - **Given** any GET, **Then** an `activity_logs` `prefs.get` row is written.

### US9.UC2 — Set theme (light/dark)
- **id:** US9.UC2
- **actor:** Authenticated user
- **preconditions:** Valid session.
- **trigger:** User toggles the theme switch.
- **main flow:**
  1. `PATCH /api/preferences` body `{ theme:"light"|"dark" }` (validated by `PreferencesPatch` zod schema; partial update).
  2. Upserts the `preferences` row, sets `theme`, bumps `updatedAt`; returns the full preferences payload.
  - **logging:** `activity_logs` `action:"prefs.set"`, `meta:{ theme }`.
- **alt/error:**
  - Invalid theme value → `400 VALIDATION_ERROR`.
- **postconditions:** Theme persisted; reload restores it.
- **acceptance criteria:**
  - **Given** a dark-mode user PATCHing `{theme:"light"}`, **Then** subsequent GET returns `light`.
  - **Given** `{theme:"blue"}`, **Then** the API returns `400` and the stored theme is unchanged.
  - **Given** the toggle, **Then** exactly one `prefs.set` `activity_logs` row with `meta.theme` is written.

### US9.UC3 — Set language (4-language i18n)
- **id:** US9.UC3
- **actor:** Authenticated user
- **preconditions:** Valid session.
- **trigger:** User selects a language from the language menu.
- **main flow:**
  1. `PATCH /api/preferences` body `{ lang:"zh"|"zh-TW"|"en"|"ja" }`.
  2. Upserts `preferences.lang`; returns updated payload. Server-generated, language-dependent content (route text, persona, fusion reasoning) for **future** turns honors this default.
  - **logging:** `activity_logs` `action:"prefs.set"`, `meta:{ lang }`.
- **alt/error:**
  - Unsupported locale → `400 VALIDATION_ERROR` (only the 4 supported tags).
- **postconditions:** Language persisted as the user's default; nav, pages, and dynamically generated answer content render in it.
- **acceptance criteria:**
  - **Given** `{lang:"ja"}`, **Then** GET returns `ja` and new chat turns generate route/fusion text in Japanese.
  - **Given** `{lang:"fr"}`, **Then** the API returns `400`.
  - **Given** a language change, **Then** a `prefs.set` row with `meta.lang` is logged.

### US9.UC4 — Toggle Deep Research / Deep Agents
- **id:** US9.UC4
- **actor:** Authenticated user
- **preconditions:** Valid session.
- **trigger:** User flips the Deep Research or Deep Agents switch in the composer.
- **main flow:**
  1. `PATCH /api/preferences` body `{ deepResearch?:boolean, deepAgents?:boolean }`.
  2. Upserts the flag(s); these defaults are echoed onto each new assistant turn (`deepResearch` is persisted per turn for history, per `AssistantMessage.deepResearch`).
  3. When `deepResearch` is on, the chat turn includes research-step metadata in its SSE/orchestration (US3/US4); the preference only sets the **default** state.
  - **logging:** `activity_logs` `action:"prefs.set"`, `meta:{ deepResearch?, deepAgents? }`.
- **alt/error:**
  - Non-boolean value → `400 VALIDATION_ERROR`.
- **postconditions:** Toggle defaults persisted; future turns inherit them.
- **acceptance criteria:**
  - **Given** `{deepResearch:true}`, **Then** GET returns `deepResearch:true` and a new turn is created with `deepResearch:true`.
  - **Given** `{deepAgents:"yes"}`, **Then** the API returns `400`.
  - **Given** toggling both, **Then** both values persist independently and are logged.

### US9.UC5 — Configure defaults (start mode, default lang, platform-fee display)
- **id:** US9.UC5
- **actor:** Authenticated user
- **preconditions:** Valid session.
- **trigger:** User sets account defaults (the values that seed `OmniConfig`).
- **main flow:**
  1. `PATCH /api/preferences` body `{ defaultMode?:"fast"|"expert", defaultLang?:Lang, platformFeeDisplayMicro?:number }`.
  2. `defaultMode` and `defaultLang` seed the store on next boot (`OmniStore` constructor reads `defaultMode`/`defaultLang`). `platformFeeDisplayMicro` is a **display/default** override only; the **billed** fee remains `PLATFORM_FEE_CNY` and any divergence is flagged so analytics stay truthful.
  3. Returns the full preferences payload.
  - **logging:** `activity_logs` `action:"prefs.set"`, `meta:{ defaultMode?, defaultLang?, platformFeeDisplayMicro? }`.
- **alt/error:**
  - Invalid mode/lang → `400 VALIDATION_ERROR`.
  - `platformFeeDisplayMicro` < 0 or above cap → `400 VALIDATION_ERROR`.
- **postconditions:** Defaults persisted; next session boots with them. Billing fee unaffected.
- **acceptance criteria:**
  - **Given** `{defaultMode:"fast"}`, **Then** the next session starts in Fast mode.
  - **Given** `{defaultLang:"en"}`, **Then** the next session boots in English.
  - **Given** a `platformFeeDisplayMicro` override, **Then** billed `usage_records.platformFeeMicro` still equals `PLATFORM_FEE_CNY` (display-only override never changes charged amounts).

---

## US10 — Activity Logging & Observability

**As a** platform operator / account admin
**I want** every user activity, token usage, cost, and latency logged per call and per request, queryable and exportable, with basic admin metrics
**so that** we have full auditability, can debug, attribute spend, and monitor system health.

**Priority:** P0 (explicit product mandate: "log every activity")

Two tables underpin this (per the frozen stack): `activity_logs` (one row per **request**: `{ id, requestId, userId, action, route, method, status, latencyMs, meta(json), createdAt }`) and `usage_records` (one row per **model call**: `{ id, requestId, conversationId, turnId, userId, modelId, role(expert|fusion|single), inputTokens, outputTokens, reasoningTokens, costMicro, platformFeeMicro, latencyMs, createdAt }`). The structured logger also emits JSON to stdout. Admin endpoints require an `admin` role guard.

### US10.UC1 — Auto-log every request (activity middleware)
- **id:** US10.UC1
- **actor:** System (handler wrapper) on behalf of any user
- **preconditions:** Any API route handler is invoked.
- **trigger:** Any inbound request to `app/api/**`.
- **main flow:**
  1. `http.ts` wraps the handler: assigns `requestId = crypto.randomUUID()`, authenticates (where required), validates with zod, and records `t0 = performance.now()`.
  2. On completion (success or handled error), `log/activity.ts` writes one `activity_logs` row `{ requestId, userId|null, action (route-derived stable id e.g. "chat.send"), route, method, status, latencyMs = now−t0, meta }` and emits the same as structured JSON to stdout.
  3. The `requestId` is returned in a response header (`x-request-id`) and the envelope for client correlation.
  - **logging:** This IS the logging path; it must not throw — log writes are best-effort and never block the response.
- **alt/error:**
  - Handler throws unhandled → wrapper catches, returns `500 INTERNAL` envelope, still writes an `activity_logs` row with `status:500` and an error `meta.code`.
  - Log-write failure → swallowed and emitted to stderr; request still returns normally.
- **postconditions:** Exactly one `activity_logs` row per request; `x-request-id` present on the response.
- **acceptance criteria:**
  - **Given** any API call, **Then** exactly one `activity_logs` row exists for that `requestId` with a measured `latencyMs ≥ 0` and a populated `action`.
  - **Given** a handler that throws, **Then** the response is a `500` envelope **and** an `activity_logs` row with `status:500` is still written.
  - **Given** any response, **Then** it carries an `x-request-id` header equal to the logged `requestId`.

### US10.UC2 — Log token usage, cost & latency per model call
- **id:** US10.UC2
- **actor:** System (LLM gateway) during chat/regenerate turns
- **preconditions:** A chat turn invokes one or more model calls (US2/US3).
- **trigger:** Each model call completes (or each stream finalizes) inside `llm/gateway.ts`.
- **main flow:**
  1. The gateway reads the AI SDK's normalized `usage` (`inputTokens`, `outputTokens`, `reasoningTokens`) for the call (mock mode derives equivalent counts via `estTok` over generated text).
  2. `llm/cost.ts` computes `costMicro` from the model's per-1M pricing (`pin`/`pout`) and sets `platformFeeMicro = PLATFORM_FEE_CNY` (micro-cents) for that call.
  3. `log/activity.ts` writes one `usage_records` row tying `{ requestId, conversationId, turnId, modelId, role, inputTokens, outputTokens, reasoningTokens, costMicro, platformFeeMicro, latencyMs }`; emits structured JSON.
  - **logging:** One `usage_records` row **per model call** (3 experts + 1 fusion ⇒ 4 rows for one expert turn; 1 row for a fast turn).
- **alt/error:**
  - Provider returns no `usage` → fall back to `estTok`-based counts; flag `meta.usageEstimated:true`.
  - Stream errors mid-call → record partial tokens with `role` and an `error` flag; cost computed on emitted tokens.
- **postconditions:** Token/cost/latency for every model call is persisted and feeds US6/US7 aggregates.
- **acceptance criteria:**
  - **Given** an expert turn (3 experts + fusion), **Then** 4 `usage_records` rows are written with matching `turnId` and roles `expert,expert,expert,fusion`.
  - **Given** a fast turn, **Then** exactly 1 `usage_records` row with `role:"single"` is written and `platformFeeMicro` equals ¥0.05 in micro-cents.
  - **Given** a provider with no usage object, **Then** counts are estimated and `meta.usageEstimated` is `true`, with cost still computed.

### US10.UC3 — Query activity logs
- **id:** US10.UC3
- **actor:** Authenticated user (own logs) / admin (any user)
- **preconditions:** Valid session; admin scope for cross-user queries.
- **trigger:** User/admin opens an activity view or calls the API.
- **main flow:**
  1. `GET /api/activity?from=&to=&action=&status=&limit=&cursor=` validated by `ActivityQuery` zod schema.
  2. Non-admin: query is force-scoped to `userId = session.userId`. Admin: may pass `userId` or query all.
  3. Returns `{ ok:true, data:{ logs:[ { requestId, action, route, method, status, latencyMs, createdAt } … ], nextCursor } }`, newest-first.
  - **logging:** the query itself writes `activity_logs` `action:"activity.query"`, `meta:{ filters, returned }`.
- **alt/error:**
  - Non-admin passing another `userId` → ignored/forbidden (`403 FORBIDDEN` if explicit cross-user request).
  - Invalid filter → `400 VALIDATION_ERROR`.
- **postconditions:** No state change beyond the query's own log row.
- **acceptance criteria:**
  - **Given** a non-admin querying activity, **Then** only their own rows return regardless of any `userId` filter supplied.
  - **Given** an admin querying with `userId=B`, **Then** user B's rows return.
  - **Given** `action="chat.send"` filter, **Then** only rows with that action return, newest-first, with cursor paging.

### US10.UC4 — Export logs & usage records
- **id:** US10.UC4
- **actor:** Admin (or user for their own data)
- **preconditions:** Valid session; admin scope for full-tenant export.
- **trigger:** Operator exports for audit/billing reconciliation.
- **main flow:**
  1. `GET /api/activity/export?type=activity|usage&format=csv|json&from=&to=`.
  2. Streams `activity_logs` or `usage_records` rows (ownership-scoped for users; tenant-wide for admin), columns matching the table schema; money as integer micro-cents.
  3. `Content-Disposition: attachment; filename="omnimind-<type>-<range>.<ext>"`.
  - **logging:** `activity_logs` `action:"activity.export"`, `meta:{ type, format, rowCount }`.
- **alt/error:**
  - Non-admin requesting `type=usage` tenant-wide → scoped to own rows only.
  - Invalid `type`/`format` → `400 VALIDATION_ERROR`.
- **postconditions:** No state change; export reproducible from persisted tables.
- **acceptance criteria:**
  - **Given** `type=usage&format=csv`, **Then** a CSV of `usage_records` rows streams with integer micro-cent money columns and a header row.
  - **Given** a non-admin export, **Then** only that user's rows are included.
  - **Given** any export, **Then** an `activity.export` `activity_logs` row records `rowCount`.

### US10.UC5 — Admin metrics dashboard
- **id:** US10.UC5
- **actor:** Admin
- **preconditions:** Valid session with `admin` role.
- **trigger:** Admin opens the metrics endpoint.
- **main flow:**
  1. `GET /api/admin/metrics?window=24h` (admin guard required).
  2. Aggregates across `activity_logs` + `usage_records`: `{ requests, errorRate (status≥500 / total), p50/p95 latencyMs, activeUsers, totalCalls, totalTokens, totalCostMicro, totalFeeMicro, callsByModel[], requestsByAction[] }`.
  3. Returns `{ ok:true, data:{ window, metrics } }`.
  - **logging:** `activity_logs` `action:"admin.metrics"`, `meta:{ window }`.
- **alt/error:**
  - Non-admin → `403 FORBIDDEN`, no data leaked.
  - Empty window → all metrics `0`/empty, HTTP 200.
- **postconditions:** No state change.
- **acceptance criteria:**
  - **Given** an admin GET with `window=24h`, **Then** `p95 latencyMs`, `errorRate`, and `totalCostMicro` are computed from the last 24h of rows.
  - **Given** a non-admin, **Then** the endpoint returns `403` and no metrics.
  - **Given** requests across 3 actions and 4 models, **Then** `requestsByAction` has 3 entries and `callsByModel` has 4, each with counts.
