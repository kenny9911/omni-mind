/**
 * Idempotent DDL kept in lock-step with schema.ts (docs/technical-design.md §1.2).
 * PostgreSQL dialect. Applied by ensureSchema() at first DB access and by the migrate script.
 * times: epoch-ms BIGINT (UTC) · money: micro-CNY BIGINT · booleans: BOOLEAN · json: TEXT.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL DEFAULT '',
  salt           TEXT NOT NULL DEFAULT '',
  plan_id        TEXT NOT NULL DEFAULT 'free',
  role           TEXT NOT NULL DEFAULT 'user',
  status         TEXT NOT NULL DEFAULT 'active',
  is_demo        BOOLEAN NOT NULL DEFAULT FALSE,
  oauth_provider TEXT,
  google_sub     TEXT,
  avatar_url     TEXT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users (email);
-- ux_users_google_sub is created in ADDITIVE_MIGRATIONS (after the column exists), so an
-- OLD-schema DB that lacks google_sub can still run this DDL block without error.

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_user    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS preferences (
  user_id                    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme                      TEXT    NOT NULL DEFAULT 'dark',
  lang                       TEXT    NOT NULL DEFAULT 'zh',
  mode                       TEXT    NOT NULL DEFAULT 'expert',
  auto                       BOOLEAN NOT NULL DEFAULT TRUE,
  main_model                 TEXT    NOT NULL DEFAULT 'gpt-55',
  trio_json                  TEXT    NOT NULL DEFAULT '["deepseek-pro","gpt-55","claude-opus"]',
  deep_research              BOOLEAN NOT NULL DEFAULT FALSE,
  deep_agents                BOOLEAN NOT NULL DEFAULT FALSE,
  platform_fee_display_micro BIGINT  NOT NULL DEFAULT 50000,
  updated_at                 BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS model_state (
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id   TEXT    NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at BIGINT  NOT NULL,
  PRIMARY KEY (user_id, model_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  color      TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_conv_user_updated ON conversations (user_id, updated_at);

CREATE TABLE IF NOT EXISTS turns (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL,
  prompt_text     TEXT NOT NULL,
  route_text      TEXT,
  main_model      TEXT,
  trio_json       TEXT,
  auto            BOOLEAN,
  deep_research   BOOLEAN NOT NULL DEFAULT FALSE,
  deep_agents     BOOLEAN NOT NULL DEFAULT FALSE,
  status          TEXT NOT NULL DEFAULT 'streaming',
  created_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_turns_conv ON turns (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ix_turns_user ON turns (user_id, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id         TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  mode            TEXT,
  payload_json    TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  created_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_msg_conv ON messages (conversation_id, created_at, seq);
CREATE INDEX IF NOT EXISTS ix_msg_turn ON messages (turn_id);

CREATE TABLE IF NOT EXISTS usage_records (
  id                 TEXT PRIMARY KEY,
  request_id         TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  conversation_id    TEXT,
  turn_id            TEXT NOT NULL,
  message_id         TEXT,
  model_id           TEXT NOT NULL,
  role               TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL,
  output_tokens      INTEGER NOT NULL,
  reasoning_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_micro         BIGINT NOT NULL,
  platform_fee_micro BIGINT NOT NULL,
  latency_ms         INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ok',
  meta_json          TEXT,
  created_at         BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_usage_user_time  ON usage_records (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_usage_turn       ON usage_records (turn_id);
CREATE INDEX IF NOT EXISTS ix_usage_user_model ON usage_records (user_id, model_id);
CREATE INDEX IF NOT EXISTS ix_usage_request    ON usage_records (request_id);

CREATE TABLE IF NOT EXISTS activity_logs (
  id         TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  user_id    TEXT,
  action     TEXT NOT NULL,
  route      TEXT NOT NULL,
  method     TEXT NOT NULL,
  status     INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  meta_json  TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_act_user_time ON activity_logs (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_act_action    ON activity_logs (action, created_at);
CREATE INDEX IF NOT EXISTS ix_act_status    ON activity_logs (status, created_at);
CREATE INDEX IF NOT EXISTS ix_act_request   ON activity_logs (request_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id               TEXT    NOT NULL DEFAULT 'free',
  included_credit_micro BIGINT  NOT NULL DEFAULT 150000000,
  credit_balance_micro  BIGINT  NOT NULL DEFAULT 0,
  status                TEXT    NOT NULL DEFAULT 'active',
  period_start          BIGINT  NOT NULL,
  period_end            BIGINT  NOT NULL,
  updated_at            BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            BIGINT NOT NULL,
  plan_label      TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'subscription',
  amount_micro    BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'paid',
  line_items_json TEXT,
  created_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_inv_user_date ON invoices (user_id, date);

CREATE TABLE IF NOT EXISTS payment_methods (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  brand      TEXT NOT NULL,
  last4      TEXT NOT NULL,
  exp_month  INTEGER NOT NULL,
  exp_year   INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_memory (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  facts_json TEXT NOT NULL DEFAULT '[]',
  updated_at BIGINT NOT NULL DEFAULT 0
);
`;

/**
 * Additive column migrations for DBs created before a column existed. CREATE TABLE IF NOT
 * EXISTS never alters an existing table, so each new column is added here. Postgres supports
 * ADD COLUMN IF NOT EXISTS, so these are naturally idempotent (no duplicate-column errors).
 */
export const ADDITIVE_MIGRATIONS: string[] = [
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE turns ADD COLUMN IF NOT EXISTS main_model TEXT",
  "ALTER TABLE turns ADD COLUMN IF NOT EXISTS trio_json TEXT",
  "ALTER TABLE turns ADD COLUMN IF NOT EXISTS auto BOOLEAN",
  // Google OAuth identity columns (null for pre-existing password accounts).
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT",
  "CREATE UNIQUE INDEX IF NOT EXISTS ux_users_google_sub ON users (google_sub)",
  // Account lifecycle: existing rows default to 'active' (login unaffected).
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'",
];
