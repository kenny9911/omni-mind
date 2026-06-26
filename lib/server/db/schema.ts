import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * OmniMind data model (libSQL / SQLite) — authoritative per docs/technical-design.md §1.2.
 * ids: uuid strings · times: epoch-ms integers (UTC) · money: integer micro-CNY (1¥ = 1e6).
 * booleans: INTEGER 0|1 · json columns: TEXT (JSON.stringify).
 */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(), // normalized: trim + lowercase
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull().default(""), // scrypt hex; '' for SSO-only
    salt: text("salt").notNull().default(""),
    planId: text("plan_id").notNull().default("free"),
    role: text("role").notNull().default("user"), // user | admin
    // marks the shared demo/demo123 showcase account (read-only profile, no-delete)
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("ux_users_email").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("ix_sessions_user").on(t.userId), index("ix_sessions_expires").on(t.expiresAt)],
);

export const preferences = sqliteTable("preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("dark"),
  lang: text("lang").notNull().default("zh"),
  mode: text("mode").notNull().default("expert"),
  auto: integer("auto", { mode: "boolean" }).notNull().default(true),
  mainModel: text("main_model").notNull().default("gpt-55"),
  trioJson: text("trio_json").notNull().default('["deepseek-pro","gpt-55","claude-opus"]'),
  deepResearch: integer("deep_research", { mode: "boolean" }).notNull().default(false),
  deepAgents: integer("deep_agents", { mode: "boolean" }).notNull().default(false),
  platformFeeDisplayMicro: integer("platform_fee_display_micro").notNull().default(50000),
  updatedAt: integer("updated_at").notNull(),
});

export const modelState = sqliteTable(
  "model_state",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.modelId] })],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    color: text("color").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("ix_conv_user_updated").on(t.userId, t.updatedAt)],
);

export const turns = sqliteTable(
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
    auto: integer("auto", { mode: "boolean" }),
    deepResearch: integer("deep_research", { mode: "boolean" }).notNull().default(false),
    deepAgents: integer("deep_agents", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("streaming"), // streaming|done|failed|partial
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_turns_conv").on(t.conversationId, t.createdAt), index("ix_turns_user").on(t.userId, t.createdAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    turnId: text("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    mode: text("mode"),
    payloadJson: text("payload_json").notNull(),
    seq: integer("seq").notNull(), // 0=user, 1=assistant
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_msg_conv").on(t.conversationId, t.createdAt, t.seq), index("ix_msg_turn").on(t.turnId)],
);

export const usageRecords = sqliteTable(
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
    costMicro: integer("cost_micro").notNull(),
    platformFeeMicro: integer("platform_fee_micro").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    status: text("status").notNull().default("ok"), // ok|error|partial
    metaJson: text("meta_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("ix_usage_user_time").on(t.userId, t.createdAt),
    index("ix_usage_turn").on(t.turnId),
    index("ix_usage_user_model").on(t.userId, t.modelId),
    index("ix_usage_request").on(t.requestId),
  ],
);

export const activityLogs = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("ix_act_user_time").on(t.userId, t.createdAt),
    index("ix_act_action").on(t.action, t.createdAt),
    index("ix_act_status").on(t.status, t.createdAt),
    index("ix_act_request").on(t.requestId),
  ],
);

export const subscriptions = sqliteTable("subscriptions", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().default("free"),
  includedCreditMicro: integer("included_credit_micro").notNull().default(150000000),
  creditBalanceMicro: integer("credit_balance_micro").notNull().default(0),
  status: text("status").notNull().default("active"),
  periodStart: integer("period_start").notNull(),
  periodEnd: integer("period_end").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: integer("date").notNull(),
    planLabel: text("plan_label").notNull(),
    kind: text("kind").notNull().default("subscription"), // subscription|topup|overage
    amountMicro: integer("amount_micro").notNull(),
    status: text("status").notNull().default("paid"),
    lineItemsJson: text("line_items_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_inv_user_date").on(t.userId, t.date)],
);

export const paymentMethods = sqliteTable("payment_methods", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  brand: text("brand").notNull(),
  last4: text("last4").notNull(),
  expMonth: integer("exp_month").notNull(),
  expYear: integer("exp_year").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Compact, distilled long-term memory about a user (bounded list of short facts). */
export const userMemory = sqliteTable("user_memory", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  factsJson: text("facts_json").notNull().default("[]"),
  updatedAt: integer("updated_at").notNull().default(0),
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
