# OmniMind — 多模型智能融合平台

A compound multi-agent platform that routes to the right model, or fuses multiple
experts in parallel, with precise token-level cost accounting. Implemented from a
[Claude Design](https://claude.ai/design) handoff (`OmniMind.dc.html`) in **Next.js 16
(App Router) · React 19 · TypeScript**, with a **full backend** (REST + streaming APIs,
PostgreSQL/Drizzle persistence, scrypt auth, the Vercel AI SDK with a keyless mock mode, and
pervasive activity/usage logging) wired **end-to-end** to the UI.

**Status:** frontend + backend are integrated and verified — `npx tsc` clean, **194 tests
passing**, production build clean, and the live flow (signup → real SSE multi-expert chat →
usage/cost ledger → session persistence) confirmed in a browser.

## Features

- **Two modes** — 快速模式 (Fast: a single best model answers instantly) and
  多专家模式 (Multi-expert: multiple experts stream in parallel, then a **Final Compiler**
  rewrites one consolidated answer from their strongest points).
- **Live streaming** — wall-clock-paced token streaming with a collapsible
  **思考过程 / Thinking** trace before the **最终答案 / Final answer**.
- **Auto-orchestration** — a configurable main model reads intent and routes each prompt
  (code → DeepSeek, writing → Claude, …). Fast mode also has a manual model picker.
- **12 models + OpenRouter** — full library with brand colors, tiers, context windows,
  per-1M pricing, enable toggles, and set-as-main.
- **Precise token & cost accounting** — every call tracks in/out tokens × model price
  **plus a per-call platform fee**, surfaced per-turn, in a 7-day trend, a cost-by-model
  breakdown, and a detailed call ledger.
- **Subscription & billing** — Pro plan with included credit + usage bar, this-month
  bill, Free/Pro/Team/Enterprise tiers, invoices, payment method.
- **Theme + i18n** — full Light/Dark toggle and 简体中文 / 繁體中文 / English / 日本語,
  covering nav, pages, and the dynamically generated answer content.
- **Resizable / collapsible sidebar** and a matching **Sign-up / Login** screen at `/login`.

## Run

```bash
npm install
cp .env.example .env.local   # keyless mock LLM mode by default
npm run db:migrate           # create the PostgreSQL tables (auto-runs on first request too)
npm run dev                  # http://localhost:3000  → redirects to /login
npm run build                # production build
npm test                     # 194 backend + integration tests (Vitest)
```

**Accounts & LLM mode are per-account.** Two accounts are auto-seeded on first DB init:

| Login | Role | LLM | Data |
|---|---|---|---|
| `demo` / `demo123` | user | **mock** (keyless, deterministic) | rich seeded demo history; profile is read-only |
| `admin@robohire.io` / `Lightark@1` | **admin** | real (gateway) | clean; full **User Management** + metrics |

Every real account (signups, admin) uses **real models via the Vercel AI Gateway** and starts with a
clean ledger. Set `AI_GATEWAY_API_KEY` (or deploy on Vercel for OIDC) to enable them — until then real
chats return a clear `GATEWAY_NOT_CONFIGURED` error (never silent mock). Only the **demo** account uses
the mock engine, so you can explore the full flow keyless. Set `LLM_MODE=mock` to force mock for all
accounts (dev/test). A signed-in user can view/edit their **Profile**; admins get a **User Management**
page (roles, plans, delete) and `/api/admin/*`.

## Backend & APIs

The backend lives in the same Next.js app as **30 Route Handlers** under `app/api/**`, backed by
a framework-agnostic service layer in `lib/server/**`:

```
app/api/
  auth/{signup,login,logout,session,sso}     chat/{,route,regenerate}   activity{,/export}
  models{,/[id]}   usage/{summary,trend,by-model,ledger,export}   admin/metrics
  billing/{subscription,plans,invoices,topup,payment-method}   conversations{,/[id]{,/messages}}
  preferences   orchestration
lib/server/
  db/         Drizzle schema + PostgreSQL client (auto-migrating) + seed
  http.ts     route() wrapper: request-id, auth guard, zod, timing, one activity_logs row/request
  auth/       scrypt passwords + DB-backed sessions + guards
  llm/        registry · router · gateway · fusion (orchestrator) · mock · cost (micro-CNY)
  usage/      aggregation (summary/trend/by-model/ledger) — zero-drift integer money
  billing/    plan catalog + credit math   log/ structured logger + activity/usage writers
  contracts/  zod request/response schemas shared with the client
lib/client/   api.ts (typed client + SSE consumer) · live.ts (bootstrap + stream → store)
```

- **Two chat modes over SSE** — Fast (single, with auto intent-routing or a manual model) and
  Multi-expert (trio streams in parallel → reasoning trace → Final Compiler synthesis). The store
  consumes the SSE event stream directly, so the UI you see is driven by the real backend.
- **Exact cost accounting** — every model call writes one `usage_records` row in integer
  **micro-CNY**; aggregate totals equal the sum of per-call rows with zero float drift. A per-call
  platform fee (¥0.05, single-sourced from `PLATFORM_FEE_CNY`) means an N-expert turn bills N+1 fees.
- **Pervasive logging** — every served request (incl. 4xx/5xx) writes one `activity_logs` row with
  latency + `x-request-id`; every model call writes token/cost/latency. Queryable via `/api/activity`,
  `/api/activity/export`, and `/api/admin/metrics` (p50/p95/error-rate).
- **Security** — session-cookie auth (HttpOnly, SameSite=Lax), ownership-scoped resources (404 on
  miss, no enumeration), admin-gated metrics, constant-time login, all DB access parameterized.

### LLM SDK decision

We **adopt the Vercel AI SDK v6 via the AI Gateway** rather than building a bespoke multi-provider
SDK, wrapped in our own gateway/orchestration/cost layer (and a deterministic mock for keyless runs).
Full rationale in [docs/decisions/llm-sdk-evaluation.md](docs/decisions/llm-sdk-evaluation.md).

## Documentation

| Doc | What |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Product requirements (FRs/NFRs, personas, metrics) |
| [docs/user-stories.md](docs/user-stories.md) · [part 2](docs/user-stories-part2.md) | 10 user stories × 5 use cases (50 UCs) with Given/When/Then |
| [docs/architecture.md](docs/architecture.md) | C4 + sequence diagrams, streaming & observability design |
| [docs/technical-design.md](docs/technical-design.md) | Data model, full API contract, SSE format, error codes |
| [docs/api-reference.md](docs/api-reference.md) | Per-endpoint REST reference (generated from the handlers) |
| [docs/observability-and-logging.md](docs/observability-and-logging.md) | Activity/usage logging + cost-exactness |
| [docs/task-plan.md](docs/task-plan.md) | Workstreams + 50-use-case traceability matrix |
| [docs/implementation-guide.md](docs/implementation-guide.md) | Module map, request lifecycle, env, local run |
| [docs/test-report.md](docs/test-report.md) | 194-test coverage map + improvement-round changelog |
| [docs/po-review.md](docs/po-review.md) | Product-owner review (82→ post-fixes), gap list, GO verdict |
| [docs/decisions/](docs/decisions/) | LLM-SDK evaluation + frozen tech-stack |
| [docs/prompts.md](docs/prompts.md) | Recorded user prompts that drove the project |

## Architecture

The design prototype's logic was ported into a small framework-agnostic store, kept
separate from the React presentation layer:

```
app/
  layout.tsx            fonts + metadata
  globals.css           design tokens (dark/light + auth deltas) + keyframes
  page.tsx              → <OmniApp/>
  login/page.tsx        → <AuthScreen/>
lib/
  types.ts              domain types
  models.ts             12 model defs + price/tag maps
  i18n.ts               4-language dictionary + pick()
  content.ts            route / persona / answer / reason / fusion content engine
  accounting.ts         token estimate, cost, formatting, seed + aggregate ledger
  store.ts              OmniStore — state + streaming engine (the "brain")
  OmniContext.tsx       provider + hooks (useViewModel via useSyncExternalStore)
  viewModel.ts          selectViewModel — derives the typed ViewModel each render
components/
  OmniApp.tsx           shell: sidebar + view switch
  Sidebar.tsx
  chat/ChatView.tsx     mode bar, streaming messages, fusion card, composer
  UsageView.tsx · ModelsView.tsx · BillingView.tsx
  AuthScreen.tsx        self-contained login/signup
  Icons.tsx             SVG icon set
```

`OmniStore` is a vanilla observable consumed through `useSyncExternalStore`; the
streaming loop mutates message objects in place and bumps a render tick, while
`selectViewModel` turns store state into a fully-typed `ViewModel` that the (mostly
pure) view components render. Model names and prices are illustrative placeholders.

> The original design handoff lives under `_handoff/` (gitignored) for reference.
