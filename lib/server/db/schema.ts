import { pgTable, text, integer, bigint, boolean, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * OmniMind data model (PostgreSQL) — authoritative per docs/technical-design.md §1.2.
 * ids: uuid strings (TEXT) · times: epoch-ms (BIGINT, UTC) · money: micro-CNY (BIGINT, 1¥ = 1e6).
 * booleans: BOOLEAN · json columns: TEXT (JSON.stringify) · counts/tokens: INTEGER.
 *
 * Times and money are BIGINT because epoch-ms (~1.78e13) and aggregate micro-CNY both exceed
 * INT4. Drizzle `bigint(..., { mode: "number" })` maps them to JS numbers (safe < 2^53).
 */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(), // normalized: trim + lowercase
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull().default(""), // scrypt hex; '' for SSO-only
    salt: text("salt").notNull().default(""),
    planId: text("plan_id").notNull().default("free"),
    role: text("role").notNull().default("user"), // user | admin
    // account lifecycle: "active" accounts log in normally; "suspended" accounts are blocked
    // at login and on every authenticated request (session resolves to null) until reactivated.
    status: text("status").notNull().default("active"), // active | suspended
    // marks the shared demo/demo123 showcase account (read-only profile, no-delete)
    isDemo: boolean("is_demo").notNull().default(false),
    // OAuth identity (null for password-only accounts). Set when the user signs in with Google.
    oauthProvider: text("oauth_provider"), // 'google' | null
    googleSub: text("google_sub"), // Google's stable subject id; null unless linked
    avatarUrl: text("avatar_url"), // provider profile picture URL; null otherwise
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  // google_sub is unique among non-null values (Postgres treats NULLs as distinct).
  (t) => [uniqueIndex("ux_users_email").on(t.email), uniqueIndex("ux_users_google_sub").on(t.googleSub)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("ix_sessions_user").on(t.userId), index("ix_sessions_expires").on(t.expiresAt)],
);

export const preferences = pgTable("preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("dark"),
  lang: text("lang").notNull().default("zh"),
  mode: text("mode").notNull().default("expert"),
  auto: boolean("auto").notNull().default(true),
  mainModel: text("main_model").notNull().default("gpt-55"),
  trioJson: text("trio_json").notNull().default('["deepseek-pro","gpt-55","claude-opus"]'),
  deepResearch: boolean("deep_research").notNull().default(false),
  deepAgents: boolean("deep_agents").notNull().default(false),
  platformFeeDisplayMicro: bigint("platform_fee_display_micro", { mode: "number" }).notNull().default(50000),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const modelState = pgTable(
  "model_state",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.modelId] })],
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    color: text("color").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("ix_conv_user_updated").on(t.userId, t.updatedAt)],
);

export const turns = pgTable(
  "turns",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    promptText: text("prompt_text").notNull(),
    routeText: text("route_text"),
    // settings captured AT SEND TIME so regenerate replays the original turn (US3.UC4)
    mainModel: text("main_model"),
    trioJson: text("trio_json"),
    auto: boolean("auto"),
    deepResearch: boolean("deep_research").notNull().default(false),
    deepAgents: boolean("deep_agents").notNull().default(false),
    status: text("status").notNull().default("streaming"), // streaming|done|failed|partial
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("ix_turns_conv").on(t.conversationId, t.createdAt), index("ix_turns_user").on(t.userId, t.createdAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    turnId: text("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    mode: text("mode"),
    payloadJson: text("payload_json").notNull(),
    seq: integer("seq").notNull(), // 0=user, 1=assistant
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("ix_msg_conv").on(t.conversationId, t.createdAt, t.seq), index("ix_msg_turn").on(t.turnId)],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    userId: text("user_id").notNull(), // retained on conversation delete (no FK)
    conversationId: text("conversation_id"),
    turnId: text("turn_id").notNull(),
    messageId: text("message_id"),
    modelId: text("model_id").notNull(),
    role: text("role").notNull(), // single | expert | fusion
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    costMicro: bigint("cost_micro", { mode: "number" }).notNull(),
    platformFeeMicro: bigint("platform_fee_micro", { mode: "number" }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    status: text("status").notNull().default("ok"), // ok|error|partial
    metaJson: text("meta_json"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("ix_usage_user_time").on(t.userId, t.createdAt),
    index("ix_usage_turn").on(t.turnId),
    index("ix_usage_user_model").on(t.userId, t.modelId),
    index("ix_usage_request").on(t.requestId),
  ],
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    userId: text("user_id"),
    action: text("action").notNull(),
    route: text("route").notNull(),
    method: text("method").notNull(),
    status: integer("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    metaJson: text("meta_json"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("ix_act_user_time").on(t.userId, t.createdAt),
    index("ix_act_action").on(t.action, t.createdAt),
    index("ix_act_status").on(t.status, t.createdAt),
    index("ix_act_request").on(t.requestId),
  ],
);

export const subscriptions = pgTable("subscriptions", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().default("free"),
  includedCreditMicro: bigint("included_credit_micro", { mode: "number" }).notNull().default(150000000),
  creditBalanceMicro: bigint("credit_balance_micro", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("active"),
  periodStart: bigint("period_start", { mode: "number" }).notNull(),
  periodEnd: bigint("period_end", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: bigint("date", { mode: "number" }).notNull(),
    planLabel: text("plan_label").notNull(),
    kind: text("kind").notNull().default("subscription"), // subscription|topup|overage
    amountMicro: bigint("amount_micro", { mode: "number" }).notNull(),
    status: text("status").notNull().default("paid"),
    lineItemsJson: text("line_items_json"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("ix_inv_user_date").on(t.userId, t.date)],
);

export const paymentMethods = pgTable("payment_methods", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  brand: text("brand").notNull(),
  last4: text("last4").notNull(),
  expMonth: integer("exp_month").notNull(),
  expYear: integer("exp_year").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

/** Compact, distilled long-term memory about a user (bounded list of short facts). */
export const userMemory = pgTable("user_memory", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  factsJson: text("facts_json").notNull().default("[]"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(0),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Preference = typeof preferences.$inferSelect;
export type ModelState = typeof modelState.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Turn = typeof turns.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
