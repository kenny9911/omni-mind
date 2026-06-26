# OmniMind Backend — Technical Design

**Status:** Draft for implementation · **Date:** 2026-06-18
**Owners:** Backend Engineering
**Frozen inputs:** [tech-stack.md](decisions/tech-stack.md), [llm-sdk-evaluation.md](decisions/llm-sdk-evaluation.md)
**Behavioral contract:** [PRD.md](PRD.md), [user-stories.md](user-stories.md), [user-stories-part2.md](user-stories-part2.md)

> This document is **implementation-ready**. It specifies the data model, the full API
> contract for all 50 use cases (US1.UC1 … US10.UC5), the LLM Gateway (registry, intent
> router, fusion/compiler, mock provider, cost engine), the auth design, the error
> envelope, and the streaming/SSE event format. It honors the **frozen** stack exactly:
> Next.js 16 Route Handlers (Node runtime) · Drizzle ORM over libSQL · Vercel AI SDK v6
> via AI Gateway with deterministic `LLM_MODE=mock` · session auth with `node:crypto`
> scrypt. All times are **epoch-ms integers (UTC)**; all money is **integer micro-cents
> CNY**; all ids are `crypto.randomUUID()` unless noted.

---

## 0. Conventions & invariants (the rules every section obeys)

| Concept | Rule |
|---|---|
| **Money** | `micro-cents CNY` = ¥ × 1,000,000. `¥0.05` fee = `50000`. Stored as SQLite `INTEGER`. Never persist floats. Format at the edge with `fmtMoney`. |
| **Tokens** | Stored as `INTEGER`. Mock mode derives counts from `estTok(s) = round(len/1.8)`; gateway mode uses the SDK's normalized `usage`. |
| **Cost engine** | `costMicro = round(inputTokens × pin) + round((outputTokens + reasoningTokens) × pout)` (since `pin`/`pout` are ¥ per 1M, micro-cents-per-token = price). **Reasoning tokens are billed at the output price** — they are generated output. Plus `platformFeeMicro = PLATFORM_FEE_MICRO` (default `50000`) **per model call**. Unknown model → fallback price `{in:5,out:15}` + `pricingFallback:true`. Mirrors `cost.ts` (`modelCostMicro`) exactly. |
| **Time** | `Date.now()` epoch-ms. Day buckets computed at server-local `00:00`, mirroring `aggregate()`'s `setHours(0,0,0,0)`. |
| **IDs** | `crypto.randomUUID()` (text). `messages.id` / `turnId` are uuids; the client's numeric message id is a presentation concern only. |
| **Envelope** | Success `{ ok: true, data }`; failure `{ ok: false, error: { code, message, details? } }`. Always includes `x-request-id` response header. |
| **Auth** | Opaque DB-backed session id in `httpOnly; SameSite=Lax; Path=/; Secure(prod)` cookie named `omni_session`. |
| **Validation** | Every body/query parsed by a **zod** schema in `lib/server/contracts/`. Failure → `400 VALIDATION_ERROR` with `details` = `z.flatten()`. |
| **Logging** | Exactly one `activity_logs` row per request (the `http.ts` wrapper). Exactly one `usage_records` row per model call (the gateway). Both also emit JSON to stdout. |
| **Ownership** | Every read/write is scoped to `session.userId`. Cross-user access → `404 NOT_FOUND` (never reveal existence) or `403 FORBIDDEN` for explicit admin-only attempts. |
| **Localization** | `lang ∈ {zh, zh-TW, en, ja}`, `en→zh` fallback via `pick()`. Applies to route labels, model tags, plan/feature copy, mode labels. |

**Environment**

| Var | Default | Meaning |
|---|---|---|
| `LLM_MODE` | `mock` | `mock` (keyless, deterministic) or `gateway` (Vercel AI SDK v6 + AI Gateway). |
| `AI_GATEWAY_API_KEY` | — | Required only when `LLM_MODE=gateway`. |
| `PLATFORM_FEE_CNY` | `0.05` | Per-call platform fee in ¥; converted to `PLATFORM_FEE_MICRO = round(× 1e6)`. |
| `DATABASE_URL` | `file:./.data/omnimind.db` | libSQL connection string. |
| `SESSION_TTL_MS` | `2592000000` (30d) | Default session lifetime; `7d` when `remember=false`. |
| `MOCK_STREAM_CPS` | `360` | Mock streaming pace (chars/sec) — mirrors store `RATE`. |
| `SEED_PLAN` | `pro` | Plan seeded for new users; Pro included credit `¥150`. |

---

## 1. DATA MODEL

### 1.1 ER diagram

```mermaid
erDiagram
    users ||--o{ sessions : "has"
    users ||--|| preferences : "has 1"
    users ||--o{ model_state : "per-model enable"
    users ||--|| subscriptions : "has 1"
    users ||--o{ conversations : "owns"
    users ||--o{ invoices : "billed"
    users ||--o| payment_methods : "has 0..1"
    users ||--o{ activity_logs : "acts"
    users ||--o{ usage_records : "incurs"
    conversations ||--o{ messages : "contains"
    conversations ||--o{ turns : "contains"
    turns ||--o{ messages : "user+assistant"
    turns ||--o{ usage_records : "1..N calls"
    messages ||--o{ usage_records : "assistant calls"

    users {
        text id PK
        text email UK
        text name
        text password_hash
        text salt
        text plan_id
        text role
        int created_at
        int updated_at
    }
    sessions {
        text id PK
        text user_id FK
        int expires_at
        int created_at
        text user_agent
    }
    preferences {
        text user_id PK_FK
        text theme
        text lang
        text mode
        int auto
        text main_model
        text trio_json
        int deep_research
        int deep_agents
        int platform_fee_display_micro
        int updated_at
    }
    model_state {
        text user_id FK
        text model_id
        int enabled
        int updated_at
    }
    conversations {
        text id PK
        text user_id FK
        text title
        text color
        int created_at
        int updated_at
    }
    turns {
        text id PK
        text conversation_id FK
        text user_id FK
        text mode
        text prompt_text
        text route_text
        int deep_research
        int deep_agents
        text status
        int created_at
    }
    messages {
        text id PK
        text conversation_id FK
        text turn_id FK
        text role
        text mode
        text payload_json
        int seq
        int created_at
    }
    usage_records {
        text id PK
        text request_id
        text user_id FK
        text conversation_id
        text turn_id
        text message_id
        text model_id
        text role
        int input_tokens
        int output_tokens
        int reasoning_tokens
        int cost_micro
        int platform_fee_micro
        int latency_ms
        text status
        text meta_json
        int created_at
    }
    activity_logs {
        text id PK
        text request_id
        text user_id FK
        text action
        text route
        text method
        int status
        int latency_ms
        text meta_json
        int created_at
    }
    subscriptions {
        text user_id PK_FK
        text plan_id
        int included_credit_micro
        int credit_balance_micro
        text status
        int period_start
        int period_end
        int updated_at
    }
    invoices {
        text id PK
        text user_id FK
        int date
        text plan_label
        text kind
        int amount_micro
        text status
        text line_items_json
        int created_at
    }
    payment_methods {
        text user_id PK_FK
        text brand
        text last4
        int exp_month
        int exp_year
        int updated_at
    }
```

### 1.2 DDL (libSQL / SQLite dialect, authored via Drizzle `sqliteTable`)

> All booleans are stored as `INTEGER` (`0|1`). JSON columns are `TEXT` holding
> `JSON.stringify(...)`. Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`,
> `CREATE INDEX IF NOT EXISTS`) and self-apply on first run (`lib/server/db/migrate.ts`).

```sql
-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                      -- uuid
  email         TEXT NOT NULL,                         -- normalized: trim + lowercase
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,                         -- scrypt hex; '' for SSO-only users
  salt          TEXT NOT NULL,                         -- 16-byte random hex
  plan_id       TEXT NOT NULL DEFAULT 'pro',           -- free|pro|team|ent (denormalized cache of subscriptions.plan_id)
  role          TEXT NOT NULL DEFAULT 'user',          -- user|admin (admin gates US10 admin endpoints)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users (email);

-- ── sessions ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,                         -- opaque 32-byte random hex (the cookie value)
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_user    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions (expires_at); -- lazy GC sweep

-- ── preferences (1:1 user) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS preferences (
  user_id                    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme                      TEXT    NOT NULL DEFAULT 'dark',     -- dark|light
  lang                       TEXT    NOT NULL DEFAULT 'zh',       -- zh|zh-TW|en|ja
  mode                       TEXT    NOT NULL DEFAULT 'expert',   -- fast|expert (defaultMode)
  auto                       INTEGER NOT NULL DEFAULT 1,          -- 0|1
  main_model                 TEXT    NOT NULL DEFAULT 'gpt-55',
  trio_json                  TEXT    NOT NULL DEFAULT '["deepseek-pro","gpt-55","claude-opus"]',
  deep_research              INTEGER NOT NULL DEFAULT 0,
  deep_agents                INTEGER NOT NULL DEFAULT 0,
  platform_fee_display_micro INTEGER NOT NULL DEFAULT 50000,      -- display/default only; NEVER changes billed fee
  updated_at                 INTEGER NOT NULL
);

-- ── model_state (per-user enable map; main lives in preferences) ──────────────
CREATE TABLE IF NOT EXISTS model_state (
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id   TEXT    NOT NULL,                         -- registry id (one of the 12) or openrouter id
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, model_id)
);
-- Absence of a row ⇒ enabled=true (seed inserts all 12 enabled on signup; FR-40).

-- ── conversations ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,                            -- derived from first prompt if not given
  color      TEXT NOT NULL,                            -- deterministic accent (RecentVM), e.g. hashed from id
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL                          -- bumped on each turn/rename → drives recents ordering
);
CREATE INDEX IF NOT EXISTS ix_conv_user_updated ON conversations (user_id, updated_at DESC);

-- ── turns (one per user prompt; owns its user + assistant messages & usage) ───
CREATE TABLE IF NOT EXISTS turns (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL,                        -- fast|expert
  prompt_text     TEXT NOT NULL,
  route_text      TEXT,                                 -- localized routeText (fast+auto only); null otherwise
  deep_research   INTEGER NOT NULL DEFAULT 0,
  deep_agents     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'streaming',    -- streaming|done|failed|partial
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_turns_conv ON turns (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ix_turns_user ON turns (user_id, created_at DESC); -- ledger/usage newest-first

-- ── messages (user + assistant; assistant payload rehydrates the chat view) ───
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id         TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,                        -- user|assistant
  mode            TEXT,                                 -- fast|expert (assistant only)
  payload_json    TEXT NOT NULL,                        -- see §1.3 message payload shapes
  seq             INTEGER NOT NULL,                     -- 0=user, 1=assistant within a turn
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_msg_conv ON messages (conversation_id, created_at, seq);
CREATE INDEX IF NOT EXISTS ix_msg_turn ON messages (turn_id);

-- ── usage_records (one row PER MODEL CALL — the billing source of truth) ──────
CREATE TABLE IF NOT EXISTS usage_records (
  id                 TEXT PRIMARY KEY,
  request_id         TEXT NOT NULL,
  user_id            TEXT NOT NULL,                     -- retained even if conversation deleted (no FK cascade)
  conversation_id    TEXT,                              -- nullable: survives conversation deletion (US8.UC4)
  turn_id            TEXT NOT NULL,
  message_id         TEXT,
  model_id           TEXT NOT NULL,
  role               TEXT NOT NULL,                     -- single|expert|fusion
  input_tokens       INTEGER NOT NULL,
  output_tokens      INTEGER NOT NULL,
  reasoning_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_micro         INTEGER NOT NULL,                  -- model cost only (NOT incl. fee)
  platform_fee_micro INTEGER NOT NULL,                  -- = PLATFORM_FEE_MICRO per call
  latency_ms         INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ok',        -- ok|error|partial
  meta_json          TEXT,                              -- {usageEstimated?, pricingFallback?, gateway?, error?}
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_usage_user_time  ON usage_records (user_id, created_at DESC); -- aggregates/trend
CREATE INDEX IF NOT EXISTS ix_usage_turn       ON usage_records (turn_id);                  -- ledger join
CREATE INDEX IF NOT EXISTS ix_usage_user_model ON usage_records (user_id, model_id);        -- by-model
CREATE INDEX IF NOT EXISTS ix_usage_request    ON usage_records (request_id);

-- ── activity_logs (one row PER REQUEST — the observability source of truth) ───
CREATE TABLE IF NOT EXISTS activity_logs (
  id         TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  user_id    TEXT,                                      -- null for unauthenticated / failed auth
  action     TEXT NOT NULL,                             -- stable id e.g. "chat.send", "auth.login"
  route      TEXT NOT NULL,                             -- "/api/chat"
  method     TEXT NOT NULL,                             -- GET|POST|PATCH|DELETE|PUT
  status     INTEGER NOT NULL,                          -- HTTP status
  latency_ms INTEGER NOT NULL,
  meta_json  TEXT,                                      -- action-specific {modelId?, mode?, filters?, code?}
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_act_user_time ON activity_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_act_action    ON activity_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_act_status    ON activity_logs (status, created_at DESC); -- error rate / metrics
CREATE INDEX IF NOT EXISTS ix_act_request   ON activity_logs (request_id);

-- ── subscriptions (1:1 user) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id               TEXT    NOT NULL DEFAULT 'pro',  -- free|pro|team|ent
  included_credit_micro INTEGER NOT NULL DEFAULT 150000000, -- ¥150 for Pro
  credit_balance_micro  INTEGER NOT NULL DEFAULT 0,      -- top-up balance (separate from included credit)
  status                TEXT    NOT NULL DEFAULT 'active', -- active|pending|canceled
  period_start          INTEGER NOT NULL,
  period_end            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

-- ── invoices ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            INTEGER NOT NULL,                      -- invoice date epoch-ms
  plan_label      TEXT NOT NULL,                         -- "Pro · Monthly"
  kind            TEXT NOT NULL DEFAULT 'subscription',  -- subscription|topup|overage
  amount_micro    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'paid',          -- paid|due|void
  line_items_json TEXT,                                  -- [{label, amountMicro}]
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_inv_user_date ON invoices (user_id, date DESC);

-- ── payment_methods (1:1 user; NO PAN/CVV ever) ──────────────────────────────
CREATE TABLE IF NOT EXISTS payment_methods (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  brand      TEXT NOT NULL,                              -- visa|mastercard|unionpay|alipay|...
  last4      TEXT NOT NULL,
  exp_month  INTEGER NOT NULL,
  exp_year   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 1.3 Message payload shapes (`messages.payload_json`)

The assistant payload persists the **completed** text of each call so history reload is
instant (no re-stream) and rehydrates `AssistantMsgVM` exactly (`lib/viewModel.ts`).

```ts
// role="user"
type UserPayload = { text: string };

// role="assistant", mode="fast"
type FastAssistantPayload = {
  routeText: string | null;                 // present only when auto routing ran
  single: { modelId: string; text: string; inputTokens: number;
            outputTokens: number; costMicro: number; platformFeeMicro: number };
};

// role="assistant", mode="expert"
type ExpertAssistantPayload = {
  experts: Array<{ modelId: string; text: string; inputTokens: number;
                   outputTokens: number; costMicro: number; platformFeeMicro: number;
                   status: "ok" | "error" }>;
  fusion: { modelId: string; reasonText: string; answerText: string;
            inputTokens: number; outputTokens: number; reasoningTokens: number;
            costMicro: number; platformFeeMicro: number };
};
// Per-turn rollup (turnTok/turnCost/turnFee/turnTotal/callCount) is DERIVED at read time
// from usage_records (the billing source of truth) — never stored redundantly.
```

### 1.4 Notes on keys, retention, and derivation

- **Ledger / "turns"** are not a separate physical aggregate table: a ledger row = a
  `turns` row joined to its `usage_records` (grouped by `turn_id`). This guarantees
  "aggregate totals equal the sum of per-call records" (SM2, NFR-6) with zero drift.
- **`usage_records` are never deleted** when a conversation is removed (US8.UC4). They
  carry `user_id` directly and a nullable `conversation_id`, so billing/analytics remain
  accurate after a conversation delete. The `DELETE` cascades `conversations → turns →
  messages` only.
- **`model_state` sparse rows:** a missing `(user_id, model_id)` row means *enabled*. The
  signup seed inserts 12 enabled rows so the picker/registry merge is a left join with a
  `COALESCE(enabled, 1)`.
- **`users.plan_id`** is a denormalized cache of `subscriptions.plan_id` to avoid a join on
  `me`; the subscriptions row is authoritative for credit math.

---

## 2. API CONTRACT

All routes live under `app/api/**` (Node runtime). Every row in the tables below is wrapped
by `http.ts` (request-id, auth guard, zod validation, timing, `activity_logs` write).
`Auth` column: **Y** = valid session required (`401 AUTH_REQUIRED` otherwise), **N** = public,
**Admin** = `users.role='admin'` (`403 FORBIDDEN` otherwise). `Logs` = the `activity_logs.action`
written; `usage_records` are written only by chat/regenerate (noted explicitly).

### 2.1 Authentication & Session (US1)

| # | Method · Path | Auth | Request (zod) | Response `data` | Errors | Logs (`action`) |
|---|---|---|---|---|---|---|
| US1.UC1 | `POST /api/auth/signup` | N | `{ name: z.string().min(1), email: z.string().regex(EMAIL_RE), password: z.string().min(8) }` | `{ user:{id,name,email}, plan, preferences }` + `Set-Cookie` | `409 AUTH_EMAIL_TAKEN`, `400 VALIDATION_ERROR` | `auth.signup` |
| US1.UC2 | `POST /api/auth/login` | N | `{ email: z.string(), password: z.string(), remember: z.boolean().default(false) }` | `{ user, plan }` + `Set-Cookie` | `401 AUTH_INVALID` (same msg for unknown email/bad password), `400 VALIDATION_ERROR` | `auth.login` |
| US1.UC3 | `POST /api/auth/logout` | Y* | `—` | `{ loggedOut: true }` + cleared cookie | — (idempotent `200`) | `auth.logout` |
| US1.UC4 | `GET /api/auth/session` | Y | `—` | `{ user, plan, preferences }` | `401 AUTH_REQUIRED` (+ deletes expired session) | `auth.session` |
| US1.UC5 | `POST /api/auth/sso` | N | `{ provider: z.enum(["google","github","wechat","apple"]) }` | `{ user, plan, sso:{provider, stub:true} }` + `Set-Cookie` | `400 VALIDATION_ERROR`, `503 SSO_UNAVAILABLE` (gateway mode, no provider) | `auth.sso` |

\* logout is idempotent: returns `200` even with no/invalid session. `EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/`.

**Signup side effects (one transaction):** insert `users` (scrypt hash), `preferences`
(FR-40 defaults; `lang` from body or `Accept-Language`), 12 `model_state` rows (enabled),
`subscriptions` (`SEED_PLAN`, Pro→¥150 included), and 3 seeded monthly Pro `invoices`
(¥199 paid) so Billing renders immediately. Then open a session.

### 2.2 Chat, Streaming & Orchestration (US2, US3, US4)

| # | Method · Path | Auth | Request (zod) | Response | Errors | Logs |
|---|---|---|---|---|---|---|
| US2.UC1 / US3.UC1 | `POST /api/chat` | Y | `ChatBody` (below) | **SSE stream** `text/event-stream` (see §6) | `400 VALIDATION_ERROR` (empty prompt), `409 STREAM_IN_PROGRESS`, `400 MODEL_NOT_AVAILABLE`, `400 INVALID_TRIO`, `409 COMPILER_UNAVAILABLE` | `chat.send` + N `usage_records` |
| US2.UC2 | (same, `auto:true,mode:"fast"`) | Y | — | stream begins with `route` event | as above | `chat.send` (meta.routedModelId) |
| US2.UC3 | (same, `auto:false,mainModel`) | Y | — | stream has **no** `route` event | `400 MODEL_NOT_AVAILABLE` | `chat.send` |
| US4.UC1 | `POST /api/chat/route` | Y | `{ prompt: z.string().min(1), lang: LangEnum.optional() }` | `{ modelId, label, routeText, fallback?:true }` | `400 VALIDATION_ERROR` | `chat.route` (**no** usage) |
| US3.UC4 / US8.UC5 | `POST /api/chat/regenerate` | Y | `{ conversationId: z.string(), turnId: z.string() }` (alias: `POST /api/chat {regenerateTurnId}`) | **SSE stream** (replaces turn in place) | `404 TURN_NOT_FOUND`, `409 STREAM_IN_PROGRESS` | `chat.regenerate` + fresh `usage_records` |
| US2.UC4 / US8.UC5 | `POST /api/activity` | Y | `{ action: z.enum(["chat.copy","result.copy"]), turnId: z.string().optional(), meta: z.record(z.any()).optional() }` | `{ logged: true }` | `400 VALIDATION_ERROR` | `<action>` (**no** usage) |

```ts
// ChatBody (lib/server/contracts/chat.ts)
const ChatBody = z.object({
  conversationId: z.string().uuid().optional(),        // created implicitly if absent (US8.UC1)
  mode: z.enum(["fast", "expert"]).optional(),         // falls back to preferences.mode
  prompt: z.string().trim().min(1),
  auto: z.boolean().optional(),                         // fast only; falls back to preferences.auto
  mainModel: z.string().optional(),                     // falls back to preferences.main_model
  trio: z.array(z.string()).length(3).optional(),       // expert only; falls back to preferences.trio
  deepResearch: z.boolean().optional(),
  deepAgents: z.boolean().optional(),
  regenerateTurnId: z.string().uuid().optional(),
}).refine(b => !(b.trio && new Set(b.trio).size !== 3), { message: "trio must be 3 distinct ids" });
```

**Resolution & guards (server-side, before streaming):**
1. If `conversationId` absent → create a conversation (title = first ~40 chars of prompt; deterministic `color`).
2. Per-conversation single-flight: if a turn with `status='streaming'` exists for the conversation → `409 STREAM_IN_PROGRESS` (mirrors store `if (streaming) return`).
3. **Fast:** if `auto` → `router.route(prompt, lang)` over **enabled** models (FR-13); emit `route`. Else require `mainModel` enabled+known → else `400 MODEL_NOT_AVAILABLE`.
4. **Expert:** validate `trio` = 3 distinct **enabled** ids → else `400 INVALID_TRIO`; compiler = `mainModel`; if compiler disabled at fusion start → `409 COMPILER_UNAVAILABLE` (experts already billed; turn `partial`).
5. Insert `turns` (`status='streaming'`), then `user` message (`seq=0`). On `turn.done`, upsert assistant message (`seq=1`) and flip `turns.status='done'`.

### 2.3 Model Library (US5)

| # | Method · Path | Auth | Request (zod) | Response `data` | Errors | Logs |
|---|---|---|---|---|---|---|
| US5.UC1 / UC4 | `GET /api/models` | Y | `?lang` (optional) | `{ models: ModelDTO[12], openRouter: string[] }` | `401 AUTH_REQUIRED` | `models.list` |
| US5.UC5 | `GET /api/models?gateway=openrouter` | Y | `?lang` | `{ models: OpenRouterDTO[] }` | `503 GATEWAY_UNAVAILABLE` (gateway mode, no key) | `models.list` (meta.gateway) |
| US5.UC2 | `PATCH /api/models/:id` | Y | `{ enabled: z.boolean() }` | `{ model: ModelDTO }` | `404 MODEL_NOT_FOUND`, `409 CANNOT_DISABLE_MAIN`, `409 MODEL_IN_TRIO` | `models.toggle` |
| US5.UC3 | `PATCH /api/models/:id` | Y | `{ setMain: z.literal(true) }` | `{ model: ModelDTO, mainModel: id }` | `404 MODEL_NOT_FOUND`, `400 MODEL_NOT_AVAILABLE` (disabled) | `models.setMain` |

```ts
type ModelDTO = {
  id; name; vendor; color; initials; tier;       // from registry (authoritative)
  tags: string[];                                 // localized for caller lang via pick()
  ctx; pin; pout;                                 // pricing/context from registry
  enabled: boolean;                               // per-user model_state (COALESCE 1)
  isMain: boolean;                                // id === preferences.main_model
};
```
`PATCH` body is a union: exactly one of `{enabled}` or `{setMain:true}`. Disabling the main → `409 CANNOT_DISABLE_MAIN`; disabling a trio member → `409 MODEL_IN_TRIO`.

### 2.4 Usage & Cost Analytics (US6)

| # | Method · Path | Auth | Request (zod) | Response `data` | Errors | Logs |
|---|---|---|---|---|---|---|
| US6.UC1 | `GET /api/usage/summary` | Y | `?window=z.enum(["7d","30d","all"]).default("7d")` or `?from&?to` (epoch-ms) | `{ window, totals:{ inputTokens, outputTokens, reasoningTokens, modelCostMicro, platformFeeMicro, totalMicro, callCount, requestCount }, platformFeePerCallMicro }` | `400 VALIDATION_ERROR` | `usage.summary` |
| US6.UC2 | `GET /api/usage/trend` | Y | `?days=z.coerce.number().int().min(1).max(90).default(7)` | `{ days:[{ key, label("M/D"), totalMicro }] }` (exactly `days`, zero-filled, oldest→newest) | `400 VALIDATION_ERROR` | `usage.trend` |
| US6.UC3 | `GET /api/usage/by-model` | Y | `?window&?limit=z.coerce.number().default(6)` | `{ models:[{ modelId, name, color, calls, modelCostMicro, sharePct }], totalModelCostMicro }` (sorted cost desc) | `400 VALIDATION_ERROR` | `usage.by_model` |
| US6.UC4 | `GET /api/usage/ledger` | Y | `?limit=z.coerce.number().max(100).default(12)&?cursor` | `{ rows: LedgerRowDTO[], nextCursor }` (newest-first, cursor by `turn.created_at,id`) | `400 VALIDATION_ERROR` | `usage.ledger` |
| US6.UC5 | `GET /api/usage/export` | Y | `?format=z.enum(["csv","json"])&?window` | streamed file (`Content-Disposition: attachment`) | `400 VALIDATION_ERROR` | `usage.export` (meta.rowCount) |

`GET /api/usage` (no sub-path) is a convenience alias accepting `?trend=7d` / `?by=model` /
`?view=ledger` (per FR-21..24) and dispatches to the same aggregator. `LedgerRowDTO` =
`{ turnId, ts, prompt(truncated 80), mode, models:[{modelId,name,color}](deduped,role-ordered),
inputTokens, outputTokens, modelCostMicro, platformFeeMicro, totalMicro }`.

### 2.5 Billing & Subscription (US7)

| # | Method · Path | Auth | Request (zod) | Response `data` | Errors | Logs |
|---|---|---|---|---|---|---|
| US7.UC1 | `GET /api/billing/subscription` | Y | `—` | `{ plan:{id,name,includedCreditMicro,periodStart,periodEnd,renewsOn}, usage:{modelCostMicro,platformFeeMicro,monthTotalMicro}, includedCreditMicro, remainingMicro, usedPct, creditBalanceMicro }` | `401 AUTH_REQUIRED` | `billing.subscription` |
| US7.UC2 | `GET /api/billing/plans` | Y | `?lang` | `{ plans:[{ id, name, priceMicro\|null, period, includedCreditMicro, featureKeys[], features[](localized), current }] }` | — | `billing.plans` |
| US7.UC3 | `POST /api/billing/subscription` | Y | `{ planId: z.enum(["free","pro","team","ent"]) }` | refreshed subscription (US7.UC1 shape) | `409 PLAN_REQUIRES_SALES` (ent), `400 VALIDATION_ERROR` | `billing.change_plan` (meta.fromPlan,toPlan) |
| US7.UC4 | `GET /api/billing/invoices` | Y | `—` | `{ invoices:[{ id, date, planLabel, kind, amountMicro, status }] }` (newest-first) | — | `billing.invoices` |
| US7.UC4 | `GET /api/billing/invoices/:id` | Y | `—` | `{ invoice:{ ...lineItems } }` | `404 NOT_FOUND` (not owner) | `billing.invoice_detail` |
| US7.UC5 | `POST /api/billing/topup` | Y | `{ amountMicro: z.number().int().min(1000000).max(1000000000) }` (¥1–¥1000) | `{ creditBalanceMicro, invoice }` | `400 VALIDATION_ERROR`, `402 PAYMENT_FAILED` (stub) | `billing.topup` (meta.amountMicro) |
| US7.UC5 | `GET /api/billing/payment-method` | Y | `—` | `{ method:{ brand, last4, expMonth, expYear } \| null }` | — | `billing.payment_method` |
| US7.UC5 | `PUT /api/billing/payment-method` | Y | `{ brand: z.string(), last4: z.string().length(4), expMonth: z.number().int().min(1).max(12), expYear: z.number().int() }` (future expiry) | `{ method }` (masked) | `400 VALIDATION_ERROR` (past expiry) | `billing.payment_method` |

`usedPct = min(100, round(monthTotalMicro / includedCreditMicro × 100))`;
`remainingMicro = max(0, includedCreditMicro − monthTotalMicro)`. `monthTotal` is computed
over the **current calendar month** from `usage_records`. Plan→credit map:
`free→0, pro→¥150, team→¥750, ent→null/custom`. Enterprise never auto-provisions.

### 2.6 Conversations & History (US8)

| # | Method · Path | Auth | Request (zod) | Response `data` | Errors | Logs |
|---|---|---|---|---|---|---|
| US8.UC1 | `POST /api/conversations` | Y | `{ title: z.string().max(120).optional() }` | `{ conversation:{ id, title, color, createdAt, updatedAt } }` | `400 VALIDATION_ERROR` | `conversation.create` |
| US8.UC2 | `GET /api/conversations` | Y | `?limit=z.coerce.number().max(100).default(20)&?cursor` | `{ conversations:[{ id, title, color, updatedAt, lastPrompt, turnCount }], nextCursor }` (updatedAt desc) | — | `conversation.list` |
| US8.UC3 | `PATCH /api/conversations/:id` | Y | `{ title: z.string().min(1).max(120) }` | `{ conversation }` | `404 NOT_FOUND`, `400 VALIDATION_ERROR` | `conversation.rename` |
| US8.UC4 | `DELETE /api/conversations/:id` | Y | `—` | `{ id, deleted: true }` | `404 NOT_FOUND` | `conversation.delete` (meta.turnCount) |
| US8.UC5 | `GET /api/conversations/:id/messages` | Y | `—` | `{ turns:[{ turnId, user:{text}, assistant:{ mode, routeText?, single?\|experts?, fusion?, deepResearch }, perTurn:{ inputTokens, outputTokens, modelCostMicro, platformFeeMicro, totalMicro, callCount } }] }` | `404 NOT_FOUND` | `conversation.messages` |

`DELETE` removes conversation + turns + messages (cascade) but **retains `usage_records`**
(billing integrity, US8.UC4). `perTurn` is derived from `usage_records` for the turn.

### 2.7 Preferences & Localization (US9)

| # | Method · Path | Auth | Request (zod) | Response `data` | Errors | Logs |
|---|---|---|---|---|---|---|
| US9.UC1 | `GET /api/preferences` | Y | `—` | `{ theme, lang, mode, auto, mainModel, trio, deepResearch, deepAgents, platformFeePerCallMicro, platformFeeDisplayMicro }` | `401 AUTH_REQUIRED` | `prefs.get` |
| US9.UC2–UC5 | `PATCH /api/preferences` | Y | `PreferencesPatch` (partial) | full preferences payload | `400 VALIDATION_ERROR`, `409 MODEL_DISABLED`, `400 INVALID_TRIO`, `400 MODEL_NOT_AVAILABLE` | `prefs.set` (meta = changed fields) |

```ts
const PreferencesPatch = z.object({
  theme: z.enum(["dark","light"]).optional(),
  lang: z.enum(["zh","zh-TW","en","ja"]).optional(),
  mode: z.enum(["fast","expert"]).optional(),
  auto: z.boolean().optional(),
  mainModel: z.string().optional(),                 // must be enabled+known else 400 MODEL_NOT_AVAILABLE
  trio: z.array(z.string()).length(3).optional(),   // 3 distinct enabled ids else 400 INVALID_TRIO
  deepResearch: z.boolean().optional(),
  deepAgents: z.boolean().optional(),
  platformFeeDisplayMicro: z.number().int().min(0).max(1000000).optional(), // display-only; never bills
}).strict();
```
`PATCH /api/orchestration` is an alias accepting the same `{mainModel,auto,trio,mode}` subset
(FR-14). Setting `mainModel` implies `auto=false` semantics per US4.UC2.

### 2.8 Activity Logging & Observability (US10)

| # | Method · Path | Auth | Request (zod) | Response `data` | Errors | Logs |
|---|---|---|---|---|---|---|
| US10.UC3 | `GET /api/activity` | Y | `ActivityQuery`: `?from&?to&?action&?route&?status&?limit=50&?cursor` (`?userId` admin-only) | `{ logs:[{ requestId, action, route, method, status, latencyMs, createdAt }], nextCursor }` (newest-first) | `400 VALIDATION_ERROR`, `403 FORBIDDEN` (non-admin cross-user) | `activity.query` |
| US10.UC4 | `GET /api/activity/export` | Y | `?type=z.enum(["activity","usage"])&format=z.enum(["csv","json"])&?from&?to` | streamed file | `400 VALIDATION_ERROR` | `activity.export` (meta.rowCount) |
| US10.UC5 | `GET /api/admin/metrics` | Admin | `?window=z.enum(["1h","24h","7d","30d"]).default("24h")` | `{ window, metrics:{ requests, errorRate, p50LatencyMs, p95LatencyMs, activeUsers, totalCalls, totalTokens, totalCostMicro, totalFeeMicro, callsByModel[], requestsByAction[] } }` | `403 FORBIDDEN` | `admin.metrics` |

Non-admin `GET /api/activity` / `export` is force-scoped to `userId = session.userId`
(an injected `WHERE`, not a client-trusted filter). `errorRate = count(status≥500)/count(*)`.
`p50/p95` computed over `latency_ms` in window. `activeUsers = COUNT(DISTINCT user_id)`.

### 2.9 Use-case → endpoint coverage matrix (all 50)

| US | UC1 | UC2 | UC3 | UC4 | UC5 |
|---|---|---|---|---|---|
| **1** | `POST /auth/signup` | `POST /auth/login` | `GET /auth/session` (me) | `POST /auth/logout` | `POST /auth/sso` |
| **2** | `POST /chat` (fast) | `POST /chat` (auto route) | `POST /chat` (manual) | `POST /activity` (copy) | `POST /chat`→`turn.usage` |
| **3** | `POST /chat` (expert) | `POST /chat`→`reason.*` | `POST /chat`→`answer.*` | `POST /chat/regenerate` | `GET /usage/ledger` |
| **4** | `POST /chat/route` | `PATCH /preferences{mainModel}` | `PATCH /preferences{trio}` | `PATCH /preferences{mode}` | `PATCH /preferences{auto}` |
| **5** | `GET /models` | `PATCH /models/:id{enabled}` | `PATCH /models/:id{setMain}` | `GET /models` (tier/price) | `GET /models?gateway=openrouter` |
| **6** | `GET /usage/summary` | `GET /usage/trend` | `GET /usage/by-model` | `GET /usage/ledger` | `GET /usage/export` |
| **7** | `GET /billing/subscription` | `GET /billing/plans` + `POST` | `GET /billing/invoices` | `POST /billing/topup` | `GET/PUT /billing/payment-method` |
| **8** | `POST /conversations` | `GET /conversations` | `PATCH/DELETE /conversations/:id` | `GET /conversations/:id/messages` | `POST /chat/regenerate` |
| **9** | `PATCH /preferences{theme}` | `PATCH /preferences{lang}` | `PATCH /preferences{deep*}` | `PATCH /preferences{defaults}` | `GET /auth/session` echoes prefs |
| **10** | `http.ts` wrapper (auto) | gateway `usage_records` | `GET /activity` | `GET /activity/export` | `GET /admin/metrics` |

---

## 3. LLM GATEWAY DESIGN (`lib/server/llm/`)

A thin product layer wrapping Vercel AI SDK v6. **Nothing calls a provider directly** — all
calls flow through `gateway.ts`, which is the single site that writes `usage_records`.

### 3.1 Registry (`registry.ts`) — authoritative source for pricing/tier/context

Mirrors `lib/models.ts` exactly (the 12 models with `pin`/`pout`/`tier`/`ctx`/`color`/tags
in 4 languages) and the `OPENROUTER_MODELS` list. A `vitest` sync test asserts
`registry === lib/models.ts` (ids, prices, tiers) to prevent drift (R1). The registry maps
each model id to a gateway provider string for `LLM_MODE=gateway`:

```ts
const GATEWAY_ID: Record<string,string> = {
  "deepseek-pro":"deepseek/deepseek-v4", "claude-opus":"anthropic/claude-opus-4.8",
  "gpt-55":"openai/gpt-5.5", "gemini-pro":"google/gemini-3.1-pro", "qwen":"alibaba/qwen", /* … */
};
// OpenRouter entries → "openrouter/<vendor>/<model>"; pricing falls back to {in:5,out:15} if unlisted (FR-19).
export function priceOf(id): {pin:number;pout:number} { return PRICE_MAP[id] ?? {pin:5,pout:15}; }
export function isEnabledFor(userId, id): boolean   // COALESCE(model_state.enabled, 1)
```

### 3.2 Intent router (`router.ts`) — algorithm

Server mirror of `lib/content.ts route()`, made enablement-aware (FR-13, US4.UC5):

```
route(prompt, lang, enabledSet):
  s = prompt.toLowerCase()
  candidate, label =
    /code|代码|函数|程序|python|javascript|rust|bug|算法|排序|sql|并发/ → "deepseek-pro", L("Code")
    /写|润色|文案|创作|story|poem|诗|邮件|email|小说|营销/           → "claude-opus",  L("Writing")
    /翻译|translate|多语|语言/                                      → "qwen",        L("Translation")
    /总结|summary|摘要|快/                                          → "deepseek-flash", L("Quick")
    /旅行|规划|计划|plan|行程|策略/                                  → "gemini-pro",  L("Planning")
    else                                                           → "gpt-55",      L("General")
  if candidate ∉ enabledSet:                       // fallback (US2.UC2 alt-flow)
    candidate = firstEnabledByTier(enabledSet, prefer=[flagship,balanced,fast]); fallback = true
  routeText = pick(lang, { zh:"已识别意图："+label+" · 自动路由至 "+name,
                           en:"Intent: "+label+" · routed to "+name, ... })  // mirrors store
  return { id: candidate, label, routeText, fallback }
```

The regex ordering is **significant** (code is tested before writing, etc.) — it is a verbatim
port so US4.UC1 / US2.UC2 acceptance criteria hold byte-for-byte.

### 3.3 Orchestration & fusion/compiler (`fusion.ts`, `gateway.ts`)

```
runTurn(turn, emit):                               // emit = SSE event sink
  emit("turn.start", { turnId, mode })
  if mode == "fast":
    model = auto ? router.route(...).id : mainModel
    if auto: emit("route", { modelId, label, routeText })
    call = stream(model, prompt, role="single", emit)   // §3.4
    persist usage_records(call); rollup = [call]
  else:  // expert
    experts = trio.map(id => stream(id, prompt, role="expert", emit))   // PARALLEL (Promise.all)
    await all; surviving = experts.filter(ok)                            // NFR-16 degrade
    emit("reason.start", { modelId: compiler })
    reason = stream(compiler, reasonPrompt(surviving), role="fusion-reason", emit)  // reasoning tokens
    emit("reason.done")
    answer = streamFusion(compiler, prompt, surviving, emit)             // final consolidated answer
    persist usage_records(...experts, fusionCall);  // fusion row carries reasoningTokens
    rollup = [...experts, fusionCall]
  emit("turn.usage", rollupFrom(rollup))            // §3.5
  emit("turn.done", { turnId, status })
```

- **Parallelism (NFR-3):** experts run with `Promise.all`; fusion starts only after
  `experts.every(done)` (mirrors store gate). Wall-clock ≈ slowest expert + fusion.
- **Fusion content:** in mock mode the reason trace = `buildReason(trio, compilerName, lang)`
  and the final answer = `buildFusion(prompt, trio, lang)` — a fresh rewrite, not a
  meta-summary (US3.UC3). Reasoning tokens are tracked separately and stored as
  `reasoning_tokens` on the fusion row (US3.UC2).
- **Degraded turn:** a failed expert emits `call.error`, is excluded from fusion, and is
  **not** billed; the turn proceeds and is marked `partial` (US3.UC1/UC5 alt-flows).
- **Compiler disabled at fusion time** → `409 COMPILER_UNAVAILABLE`; already-run experts
  remain billed; turn `partial`.

### 3.4 Mock provider (`mock.ts`) — keyless determinism

Implements a Vercel AI SDK `MockLanguageModelV2` over `simulateReadableStream`, backed by the
existing content engine:

```ts
function mockStream(modelId, prompt, role, lang): AsyncIterable<{delta}> {
  const full = role === "fusion-answer" ? buildFusion(prompt, trio, lang)
             : role === "fusion-reason" ? buildReason(trio, name, lang)
             : buildAnswer(prompt, modelId, lang);                 // verbatim content.ts
  // pace at MOCK_STREAM_CPS (≈360 cps) with per-call stagger (delay 4 + i*5) to mirror store UX (NFR-1)
  yield* chunked(full, cps);
  return { usage: { inputTokens: estTok(prompt)+180, outputTokens: estTok(full), reasoningTokens } };
}
```

Mock token counts use `estTok` so analytics values are byte-identical to today's UI
(A4, NFR-5). `inputTokens = estTok(prompt) + 180` mirrors the store's `inBase`. Deep Research
adds research-step annotations and inflates `inputTokens` (FR-39).

### 3.5 Cost engine (`cost.ts`) — usage → micro-cents + fee

```ts
const PLATFORM_FEE_MICRO = Math.round(Number(process.env.PLATFORM_FEE_CNY ?? 0.05) * 1e6); // 50000

function costMicro(inputTokens, outputTokens, reasoningTokens, modelId): {costMicro; pricingFallback} {
  const p = priceOf(modelId);                       // {pin,pout} ¥/1M  (== micro-cents per token)
  // ¥/1M × tokens / 1e6 × 1e6(micro) == price × tokens; integer-exact.
  // Reasoning tokens bill at the output price (they are generated output).
  const c = Math.round(inputTokens * p.pin) + Math.round((outputTokens + reasoningTokens) * p.pout);
  return { costMicro: c, pricingFallback: !PRICE_MAP[modelId] };
}

function billCall(usage, modelId): UsageRow {
  const { costMicro: cm } = costMicro(usage.inputTokens, usage.outputTokens, usage.reasoningTokens, modelId);
  return { ...usage, modelId, costMicro: cm, platformFeeMicro: PLATFORM_FEE_MICRO };
}
```

This reproduces `respCost()` and `aggregate()` to the micro-cent (SM2, NFR-6/7/8): a Fast turn
= 1 fee; an N-expert turn = N+1 fees. In gateway mode, `usage` comes from the SDK's normalized
object; if the provider returns no `usage`, fall back to `estTok` and set
`meta.usageEstimated=true` (US10.UC2 alt-flow).

---

## 4. AUTH DESIGN (`lib/server/auth/`)

### 4.1 Password hashing (`password.ts`) — `node:crypto` scrypt

```ts
function hashPassword(pw): { hash; salt } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return { hash, salt };
}
function verifyPassword(pw, hash, salt): boolean {
  const cand = scryptSync(pw, salt, 64, {N:16384,r:8,p:1});
  return timingSafeEqual(cand, Buffer.from(hash, "hex"));   // constant-time (US1.UC2)
}
```
Passwords are never logged or returned (NFR-9). Login returns an identical `AUTH_INVALID`
message and equivalent timing for unknown-email vs wrong-password (no enumeration, US1.UC2).

### 4.2 Sessions (`session.ts`)

- `createSession(userId, ttlMs)`: `id = randomBytes(32).toString("hex")`; insert
  `{ id, userId, expiresAt: now+ttl, createdAt, userAgent }`; set cookie
  `omni_session=<id>; HttpOnly; SameSite=Lax; Path=/; Max-Age=ttl/1000; Secure(prod)`.
  `ttl = remember ? SESSION_TTL_MS : 7d`.
- `resolveSession(req)`: read cookie → lookup row → if missing/expired → **delete row**
  (lazy GC, US1.UC3) → `null`. Else load user. Multi-device: login creates a new session and
  leaves prior sessions valid (US1.UC2). Logout deletes only the current session (US1.UC4).
- `ssoUpsert(provider)`: deterministic demo identity `email = "${provider}.demo@omnimind.dev"`;
  upsert user (empty `password_hash`), seed prefs/subscription/models if new, open a session
  (same cookie contract). `stub:true` in the response (US1.UC5).

### 4.3 Guard (`guard.ts`)

`requireUser(req)` → `User | throws ApiError(401, AUTH_REQUIRED)`. `requireAdmin(req)` →
checks `role='admin'` else `ApiError(403, FORBIDDEN)`. Ownership helpers assert
`row.user_id === session.userId` else `NOT_FOUND`. The guard runs inside `http.ts` before the
handler body, so an unauthenticated protected request still produces an `activity_logs` row
with `status=401, userId=null`.

---

## 5. ERROR ENVELOPE & CODES

**Envelope (all responses):**
```jsonc
// success
{ "ok": true, "data": { /* … */ } }
// failure
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "human-readable",
                          "details": { /* zod flatten or field hints */ } } }
```
Every response carries header `x-request-id: <uuid>`; failures echo it in logs for traceability
(NFR-14). `ApiError(status, code, message?, details?)` is thrown anywhere and caught by
`http.ts`, which maps it to the envelope + HTTP status and logs `status` + `meta.code`.

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | zod parse failure; empty prompt; bad enum. `details` = `z.flatten()`. |
| 400 | `MODEL_NOT_AVAILABLE` | `mainModel`/setMain target unknown or disabled (US2.UC3, US4.UC2, US5.UC3). |
| 400 | `INVALID_TRIO` | trio ≠ 3 distinct enabled ids (US3.UC1, US4.UC3). |
| 401 | `AUTH_REQUIRED` | protected route, no/expired session (a.k.a. `UNAUTHENTICATED`). |
| 401 | `AUTH_INVALID` | login bad credentials (identical for unknown email / wrong password). |
| 402 | `PAYMENT_FAILED` | stub PSP failure simulation on top-up (US7.UC5). |
| 403 | `FORBIDDEN` | non-admin cross-user query / admin endpoint (US10.UC3/UC5). |
| 404 | `NOT_FOUND` | resource not owned / missing (conversations, invoices, ownership scope). |
| 404 | `MODEL_NOT_FOUND` | unknown model id on `PATCH /api/models/:id` (US5.UC2). |
| 404 | `TURN_NOT_FOUND` | regenerate target turn missing (US3.UC4). |
| 409 | `AUTH_EMAIL_TAKEN` | signup duplicate email (US1.UC1). |
| 409 | `STREAM_IN_PROGRESS` | second chat/regenerate while a turn streams in that conversation. |
| 409 | `CANNOT_DISABLE_MAIN` | disabling the current main model (US5.UC2). |
| 409 | `MODEL_IN_TRIO` | disabling a model in the active trio (US5.UC2). |
| 409 | `MODEL_DISABLED` | setting a disabled model via preferences/orchestration (FR-14). |
| 409 | `COMPILER_UNAVAILABLE` | compiler disabled at fusion start (US3.UC2). |
| 409 | `PLAN_REQUIRES_SALES` | `POST /billing/subscription {planId:"ent"}` (US7.UC3). |
| 503 | `GATEWAY_UNAVAILABLE` | gateway mode, OpenRouter/provider unconfigured (US5.UC5). |
| 503 | `SSO_UNAVAILABLE` | gateway/real-OAuth mode configured but unavailable (US1.UC5). |
| 500 | `INTERNAL` | unhandled error; wrapper still logs `status:500`, returns the envelope. |

---

## 6. STREAMING / SSE EVENT FORMAT

`POST /api/chat` and `POST /api/chat/regenerate` return `Content-Type: text/event-stream`
(Node runtime, no full-buffering, heartbeats). Each SSE message uses an `event:` line + a
JSON `data:` line. First event (`turn.start`) is emitted within 300 ms (NFR-1). A heartbeat
comment `: ping` is sent every ~15 s to defeat idle-proxy timeouts (NFR-2).

```
event: turn.start
data: {"turnId":"…","conversationId":"…","mode":"expert","ts":1750200000000}

event: route                         # fast + auto only (US2.UC2); omitted when auto=false (US2.UC3)
data: {"modelId":"deepseek-pro","label":"Code","routeText":"Intent: Code · routed to DeepSeek V4 Pro","fallback":false}

event: call.start
data: {"callId":"…","modelId":"deepseek-pro","role":"expert"}

event: call.delta                    # incremental output tokens (the visible answer)
data: {"callId":"…","modelId":"deepseek-pro","role":"expert","delta":"从第一性原理…"}

event: call.usage                    # per-call final usage (mirrors usage_records row)
data: {"callId":"…","modelId":"deepseek-pro","role":"expert","inputTokens":312,"outputTokens":640,
       "reasoningTokens":0,"costMicro":8928,"platformFeeMicro":50000,"status":"ok"}

event: call.error                    # a failed expert (degraded turn proceeds, US3.UC1)
data: {"callId":"…","modelId":"qwen","role":"expert","code":"PROVIDER_ERROR"}

event: reason.start                  # expert mode only — fusion thinking trace begins (US3.UC2)
data: {"modelId":"gpt-55"}
event: reason.delta
data: {"delta":"融合器（GPT-5.5）正在对比…"}
event: reason.done
data: {"reasoningTokens":410}

event: answer.delta                  # fast: single answer; expert: consolidated fusion answer (US3.UC3)
data: {"delta":"综合多位专家的回答…"}

event: turn.usage                    # turn rollup — matches the UI per-turn footer exactly (FR-11)
data: {"turnTok":4210,"turnCostMicro":31200,"turnFeeMicro":200000,"turnTotalMicro":231200,"callCount":4}

event: turn.done
data: {"turnId":"…","status":"done","messageId":"…"}

event: error                         # fatal turn error (e.g. fast call failed) — closes the stream
data: {"code":"PROVIDER_ERROR","message":"…","requestId":"…"}
```

**Event sequence by mode**

- **Fast (auto):** `turn.start → route → call.start → call.delta* → call.usage → turn.usage → turn.done`.
- **Fast (manual):** same, **without** `route`.
- **Expert:** `turn.start → [per expert: call.start, interleaved call.delta*, call.usage] (×3 concurrent) → reason.start → reason.delta* → reason.done → answer.delta* (fusion) → call.usage (fusion) → turn.usage → turn.done`.

> **Fast mode streams the single answer via `call.delta`** (`role:"single"`), **not** `answer.delta` — matching `fusion.ts` and the ViewModel mapping (`call.delta` → `CallVM.text`). `answer.delta` is emitted **only** in expert mode, for the fused answer. There is no `answer.delta` in a Fast-mode stream.

**Client mapping.** `call.delta`/`answer.delta`/`reason.delta` drive `CallVM.text` /
`FusionVM.answerText` / `FusionVM.reasonText`. `call.usage` and `turn.usage` carry micro-cent
fields the client formats with `fmtMoney`. On client disconnect mid-stream, the server cancels
in-flight work and persists `usage_records` for any **completed** calls; the turn is marked
`partial` (no orphaned in-flight turns, NFR-17).

---

## 7. Traceability & cross-checks

- **UI parity (SM1).** Every `ViewModel` field maps to a DTO above: turn footer →
  `turn.usage`; `usageStats` → `GET /usage/summary`; `trendDays` → `/usage/trend`; `perModel`
  → `/usage/by-model`; `ledgerRows` → `/usage/ledger`; `modelCards` → `/models`; `plans` /
  `invoices` / `usedPct` / `remaining` → `/billing/*`. Money/number/time formatting reuse
  `fmtMoney`/`fmtNum`/`fmtTime` unchanged.
- **Cost exactness (SM2/NFR-6).** `cost.ts` uses integer micro-cents; `GET /usage/summary`
  totals = `SUM(cost_micro)` + `SUM(platform_fee_micro)` over `usage_records` — equal to the
  sum of per-call rows with zero rounding drift.
- **Observability completeness (SM4).** `http.ts` writes one `activity_logs` row per served
  request (incl. 4xx/5xx); the gateway writes one `usage_records` row per model call. Both
  derive admin metrics (FR-45) with no extra tables.
- **Keyless runnability (SM5).** `LLM_MODE=mock` + the seed make the full unit/integration
  suite pass with no provider keys; the registry sync test guards against drift.
