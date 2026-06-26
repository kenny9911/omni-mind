# Recorded User Prompts

Verbatim record of the prompts that drove this project, in order.

---

## Prompt 1 — Frontend implementation (2026-06-17)

> Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/s8KTY4391uExv4_oaIwbYg?open_file=OmniMind.dc.html
> Implement: OmniMind.dc.html
>
> ----
>
> use the latest version of Next.js, React, TypeScript

**Outcome:** Ported the Claude Design handoff (`多模型智能融合平台` / OmniMind) into Next.js 16 + React 19 + TypeScript — a fully interactive prototype with Chat (Fast / Multi-expert fusion), Usage, Models, Billing views, the `/login` auth screen, 4-language i18n, light/dark theming, simulated streaming, and a precise client-side token/cost ledger. See [README.md](../README.md).

---

## Prompt 2 — Backend services, APIs, and the full delivery program (2026-06-18)

> 1. now we need to implement the backend services and api to support all functionalities, please read the UI design and create a product PRD, create top 10 user stories, 5 use cases for each user story, create the architecture and the technical design, product task plan, and implement the code entirely, then have the test team to test, find the bugs and fix, make sure all use cases pass the test, also have the product owner review the product, and provide critic and insure it reaches the highest expectation, otherwise, continue the loop and start over with incremental improvements. Launch up to 12-15 workflows and multiple agents for each workflow to start the work.
>
> 1. Make sure to log every activities, log every user activities, token usages, token costs, lapse time, etc.
>
> 1. Evaluate whether to build the llm services and sdk or to use Vercel SDK with full flexibilities.
>
> 1. Document the design and implementation in markdown files, record my prompts as well.

**Interpretation / acceptance criteria derived from the prompt:**

1. Read the existing UI to drive a backend that supports **all** front-end functionality.
2. Produce: **PRD**, **10 user stories** with **5 use cases each (50 use cases)**, **architecture**, **technical design**, **product task plan**.
3. **Implement the backend entirely** (services + APIs + persistence).
4. **Test team** writes & runs tests; **find and fix bugs**; **all 50 use cases pass**.
5. **Product Owner** reviews, critiques, and confirms the product reaches the **highest expectation**; if not, **loop** with **incremental improvements**.
6. Orchestrate with **12–15 workflows**, **multiple agents per workflow**.
7. **Log everything**: user activities, token usage, token cost, elapsed/latency, per call and per request.
8. **Evaluate** building a custom LLM SDK vs. using the **Vercel AI SDK** (see [decisions/llm-sdk-evaluation.md](decisions/llm-sdk-evaluation.md)).
9. **Document** design + implementation in markdown, and **record these prompts** (this file).

---

## Prompt 3 — Real LLM wiring, system accounts, profile & user management (2026-06-20)

> so is the backend wired with the real stuff? let's get the real stuff to work. Demo only for demo accounts. other users all should be real data (no mock data), create a demo account: demo / demo123. other users all should be real data (no mock data), create an admin account call 'admin@robohire.io' with password 'Lightark@1'. admin should have all the rights. also design and implement the user profile and user management page. make sure test completely

**Outcome:** Per-account LLM mode (`useMock = user.isDemo || LLM_MODE==="mock"`) — **demo accounts** stream the deterministic mock engine with seeded history; **all other accounts** call the real **Vercel AI Gateway** (no mock fallback). Seeded the system accounts (`demo` / `demo123`, `admin@robohire.io` / `Lightark@1`, admin role) idempotently. Built the **Profile** page (account, plan, usage rollups) and admin-only **User Management** page (list, role, suspend/delete with system-account guards). See [technical-design.md](technical-design.md) §2.10–2.11.

---

## Prompt 4 — Restart script (2026-06-21)

> create a restart script and put in under scripts folder, which will stop all of the duplicate services and start new ones.

**Outcome:** [`scripts/restart.sh`](../scripts/restart.sh) (bash-3.2 / macOS safe) — stops every duplicate `next` dev server scoped to **this** repo's `node_modules/.bin/next` (never touches unrelated projects), PID-tree kill via `pgrep -P` (no process-group kill that would take down the launching shell), `find_free_port`, respects `.env.local` `PORT`, and `nohup`s a fresh server writing `.data/dev.pid`. Wired as `npm run restart` / `npm run stop`.

---

## Prompt 5 — Runtime 500 bug-fix + full test (2026-06-24)

> [pasted runtime 500 logs: "table users has no column named is_demo" …] — bugs in runtime, please fully test it!

**Outcome:** Root cause: `CREATE TABLE IF NOT EXISTS` never alters an existing table, so new columns (`is_demo`, `turns.main_model/trio_json`) were missing on already-migrated DBs. Added idempotent **additive `ALTER TABLE` migrations** to `ensureSchema`; made `getDb()` retry on init failure (a cached rejected promise had wedged every request at 500); made system-account seeding best-effort. Hunted live 5xx across all endpoints with both accounts.

---

## Prompt 6 — UI/feature completion round (2026-06-26)

> 1. 让用户可以更改多专家组合。 2. 如果某个模型关闭，这不要选作专家组合。 3. 选择历史对话要还原对话历史与结果。 4. Terminal Console 里面有许多错误要修。 5. 多模型调用要并行，run in parallel。 6. 继续完善未完成的其他阶段的功能。

**Interpretation / acceptance criteria:**

1. **Editable expert trio** — users can change the three fusion experts.
2. **Disabled models excluded** — a model that's turned off must not be selectable as an expert.
3. **Restore history** — selecting a past conversation rehydrates its full transcript and results.
4. **Console errors** — fix the many errors in the terminal/browser console.
5. **Parallel calls** — the multi-model expert calls must run concurrently.
6. **Continue completing** remaining/unfinished features.

**Outcome:** See [improvement-round-2.md](improvement-round-2.md). All six addressed: an in-bar trio picker (only enabled models; replace-oldest at 3) persisting via `PATCH /api/preferences {trio}`; disabling a trio member now auto-removes + backfills (server + client) instead of blocking; clickable recents restore the full transcript (3 expert panels + fusion, incl. inline compiler errors) and thread new turns into the same conversation; gateway failures collapsed from raw stack traces to clean `warn` lines with inline UI errors (browser console verified clean); experts confirmed running via `Promise.all`; plus sidebar **conversation rename/delete** and a **G24** SSE error-leak hardening. 212 tests green.

---

## Prompt 7 — Dynamic empty-state suggestions (2026-06-26)

> [screenshot of the four hard-coded suggestion cards] every time, call any cheaper LLM to show
> different useful examples, not always these four.

**Outcome:** The empty-chat suggestion cards are now generated fresh on each load instead of the
four hard-coded prompts. New `GET /api/suggestions` ([route](../app/api/suggestions/route.ts),
[helper](../lib/server/llm/suggestions.ts)) asks a cheap non-reasoning model (`deepseek-flash`,
override via `SUGGESTIONS_MODEL`) for 4 short, concrete prompts — one per *random* domain, in the
user's language, capped at 400 output tokens (not billed, not in the ledger). Demo/mock accounts —
and any LLM failure — get a randomized pick from a 12-entry curated pool, so the four still vary and
never break. The store fetches on bootstrap + each New Chat; the viewModel prefers the dynamic set
and falls back to the static one until it lands. Verified live: real accounts get genuinely fresh,
distinct suggestions each call (e.g. "plan a 20min home workout", "南京三日游路线推荐"); demo rotates
the curated pool; browser shows the swap with 0 console errors. `tsc` clean · 225 tests pass
(+`tests/suggestions.test.ts`).

---

## Prompt 8 — Input-box edit/copy icons + context-engineering memory (2026-06-26)

> allow user's input text box to have edit and copy icons
>
> design and implement a context engineering mechanism, a memory of user's context, try to learn
> from the user's and create a memory (but not all of the historical context), it should be a
> compact memory, so that we don't pollute the current context and over spend on the tokens.

**Outcome (two features):**

1. **User-message copy + edit.** Each sent message now has hover **Copy** (clipboard) and **Edit**
   (revise & resend — loads the text back into the composer and focuses it) affordances
   ([ChatView.tsx](../components/chat/ChatView.tsx), store `editUserMessage` + `composerFocusTick`).

2. **Compact context memory ("context engineering").** A bounded per-user memory of distilled
   facts — not raw history. A cheap model (`deepseek-flash`) extracts 0–3 durable USER facts from
   each real send and merges them in (deduped, capped to 16 facts × 120 chars ≈ ~500 tokens), then
   injects them as a tiny preamble into the single + fusion calls (not the 3 experts; tokens
   counted into the ledger). Skipped for demo/mock; never records sensitive PII; viewable + clearable
   on the Profile page via `GET`/`DELETE /api/memory`. Proven with cross-conversation recall.
   Full design: [context-memory.md](context-memory.md). `tsc` clean · 233 tests · adversarially reviewed.

---

## Prompt 9 — Real Deep Research sources + model-id footers (2026-06-26)

> [screenshot of the Deep Research panel "检索网页 12 篇 …" and response cards]
> 真的有检索网页12篇？有的话，请列出 sources (in a compact way)
> show the model id at the bottom of each LLM response window as well

**Honest answer:** No — "检索网页 12 篇" was a hard-coded label; Deep Research did no web retrieval
(only a +600 fake-token bump). So I made it **real**.

**Outcome (two features):**

1. **Real Deep Research.** [`research.ts`](../lib/server/llm/research.ts) calls OpenRouter's web
   plugin → actual `url_citation` results. When Deep Research is on (real account + OpenRouter key),
   `runTurn` retrieves real pages, emits `research.sources`, injects the findings (cited `[n]`) into
   the answer, and bills the retrieval (`role="research"`). The panel now shows the **real** count
   ("检索网页 N 篇", or "联网检索" when none) + clickable source chips; sources persist across reloads.
   Verified live: 8 real Vercel-AI-Gateway sources retrieved, cited, and rendered. See
   [deep-research.md](deep-research.md).

2. **Model id in every response footer.** Single, expert, and fusion cards now show the model id
   (monospace, faint) at the bottom of each response window.

Also fixed a regression the test surfaced: the logger's secret-redaction matched "token" as a
substring of `inputTokens`/`outputTokens`, redacting harmless token counts — now matched precisely.
`tsc` clean · 240 tests (+`tests/research.test.ts`).

---

## Prompt 10 — Remove all mock/hardcode for production (2026-06-26)

> please remove hardcode and mock code, mock data, we are production live now

**Decision (asked):** keep the demo account but make it real (no mock engine anywhere); rewire tests
to stub the provider.

**Outcome:** the production app no longer contains any mock engine, simulated streaming, or seeded
fake data.
- **Mock engine deleted** (`lib/server/llm/mock.ts`); `streamOne` always calls a real provider
  (dedicated → OpenRouter → gateway). All `useMock` plumbing removed (gateway, fusion, chat route,
  regenerate, memory, suggestions). A real provider is now required for every chat (clear 503 if none).
- **Demo is a real account** — `demo`/`demo123` uses live models like everyone else; `isDemo` now only
  marks it read-only (shared password can't be changed) and undeletable. Seed no longer creates fake
  invoices, a "visa 4242" card, or usage history — **every new account starts genuinely clean**.
- **Dead non-live simulation removed** from `lib/store.ts` (the prototype typewriter sim,
  `seedInitial`, `seedLedger`); `lib/content.ts` moved to `tests/helpers/` (test-only).
- **Frontend hardcode removed** (`lib/viewModel.ts`): placeholder "recent chats", the "Zoe Chen"
  name, and the static suggestion set are gone; Billing invoices now come from
  `/api/billing/invoices` and the current plan reflects the real subscription.
- **Tests** stub the provider in `tests/setup.ts` (deterministic, keyless) — the production code has
  no mock. `tsc` clean · **240 tests pass**. Verified live: fresh signup has empty invoices/card/recents;
  demo chats on real models; no fake data or console errors. See [mock-removal.md](mock-removal.md).

**Flagged for the user:** (1) accounts created BEFORE this change still hold their old seeded
invoices/usage until a one-time cleanup; (2) the Usage page + Billing credit numbers still derive from
the session ledger rather than the all-time `/api/usage` data — a worthwhile follow-up; (3) new signups
still default to the **Pro** plan (a product default, not fake data) — switch to **Free** if desired.

## Prompt 11 — Resolve the three production follow-ups (2026-06-26)

> yes all three

Implemented all three items flagged at the end of Prompt 10.
- **(1) One-time seed cleanup** — added `scripts/cleanup-seed.ts` (`npm run cleanup:seed`), an
  idempotent purge of pre-existing fake data by exact seed signature only (subscription invoices,
  the `visa •••• 4242` card, the demo's three seeded conversations + their usage). Real data
  (`topup` invoices, user-added cards, real turns) is never touched. Ran on the dev DB.
- **(2) Usage + Billing wired to the real backend** — `lib/store.ts` gained `loadUsage()`
  (summary/trend/by-model/ledger from `/api/usage`) and `loadBilling()` now also fetches
  `/api/billing/subscription`; both fire from `setView`. `lib/viewModel.ts` now builds every Usage
  stat, the 7-day trend, cost-by-model, and the call ledger from `s.usageData`, and the Billing
  credit bar / month totals from `s.billingSub` (all converted micro-CNY → ¥). The plan-card
  highlight bug (hardcoded `current`) is fixed to derive from the live subscription plan id. The
  client-side session ledger is now unread (flagged for removal).
- **(3) Free plan default** — `seedNewUser` / `ensureSystemUser` / signup now default `planId`
  to `free`; tests updated (added a `proUser` helper + a free-default assertion).

**Outcome:** `tsc` clean · **239 tests pass**. Verified live (port 3439, demo account):
`/api/billing/subscription` and all four `/api/usage/*` endpoints return real all-time data and the
view models consume the exact shapes.

## Prompt 12 — Implement Google login (2026-06-26)

> now implement Google login

Real "Sign in with Google" via OAuth 2.0 **Authorization Code flow + PKCE**, replacing the SSO
placeholder for Google (the other providers still 503).
- **New routes**: `GET /api/auth/google` (start — mints state + PKCE, sets a signed HttpOnly
  `omni_oauth` cookie, 302s to Google), `GET /api/auth/google/callback` (validate state, exchange
  code, decode/verify the id_token, require `email_verified`, find-or-create by verified email, mint
  a 30-day session), and `GET /api/auth/providers` (gates the button).
- **OAuth helper** `lib/server/auth/google.ts`: HMAC-signed (`APP_SECRET`) state cookie carrying
  `{state, verifier, iat}`, S256 PKCE, `aud`/`iss`/`exp` id_token checks, redirect-URI resolution.
- **Schema**: additive `users.oauth_provider` / `google_sub` (unique) / `avatar_url` columns; the
  `google_sub` index is created in `ADDITIVE_MIGRATIONS` (after the column) so old DBs migrate cleanly.
- **Frontend**: the Google button now does a full-page redirect to `/api/auth/google` (enabled only
  when `/api/auth/providers` reports it configured); `/login?sso_error=<code>` surfaces failures.
- **Security**: signed+short-lived CSRF/state cookie, PKCE, OIDC nonce binding, verified-email-only,
  no open redirect, no secret/token logging.

**Adversarial review** (6 lenses → per-finding skeptic verification, 21 agents) confirmed 10 real
findings; the false positives (no open redirect, PKCE correct, suspended-bypass) were dropped. Fixed:
- **HIGH** — refuse to auto-merge a Google identity into a pre-existing *password* account (Workspace
  email-reuse takeover); only new emails are auto-created, only credential-less rows auto-linked.
- **MEDIUM** — require `id_token.sub === users.google_sub` on linked-account sign-in (recycled-address
  guard) → `account_conflict`.
- **LOW** — mandatory numeric `exp` (+60 s skew); OIDC `nonce` binding; `__Host-` cookie prefix in
  prod; truncate the attacker-controlled `?error` meta; catch the unique-index insert race (no 500);
  block suspended accounts at the callback.

**Outcome:** `tsc` clean · **255 tests pass** (13 in `tests/google-oauth.test.ts`). Verified live
(port 3439): routes wired, `/api/auth/providers` returns `google:false` until configured, start +
callback 302 to `/login?sso_error=not_configured`, and the additive columns are present on the live
DB. See [google-login.md](google-login.md). Setup requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.
