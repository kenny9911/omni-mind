import { randomUUID } from "node:crypto";
import type { DB } from "../db/client";
import { activityLogs, usageRecords } from "../db/schema";
import { log } from "./logger";

/**
 * The two DB-backed observability sinks (docs/technical-design.md §2.8, §3.5):
 *  - activity_logs : one row PER REQUEST (written by http.ts for every served request)
 *  - usage_records : one row PER MODEL CALL (written by the LLM gateway)
 */

export interface ActivityInput {
  requestId: string;
  userId: string | null;
  action: string;
  route: string;
  method: string;
  status: number;
  latencyMs: number;
  meta?: Record<string, unknown> | null;
}

export async function writeActivity(db: DB, a: ActivityInput): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      id: randomUUID(),
      requestId: a.requestId,
      userId: a.userId,
      action: a.action,
      route: a.route,
      method: a.method,
      status: a.status,
      latencyMs: a.latencyMs,
      metaJson: a.meta ? JSON.stringify(a.meta) : null,
      createdAt: Date.now(),
    });
  } catch (err) {
    // Never let logging break a request.
    log.error("activity.write_failed", { err: String(err), action: a.action });
  }
  log.info("request", {
    requestId: a.requestId,
    userId: a.userId,
    action: a.action,
    route: a.route,
    method: a.method,
    status: a.status,
    latencyMs: a.latencyMs,
  });
}

export interface UsageInput {
  requestId: string;
  userId: string;
  conversationId: string | null;
  turnId: string;
  messageId: string | null;
  modelId: string;
  role: "single" | "expert" | "fusion" | "research";
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costMicro: number;
  platformFeeMicro: number;
  latencyMs: number;
  status?: "ok" | "error" | "partial";
  meta?: Record<string, unknown> | null;
}

export async function writeUsage(db: DB, u: UsageInput): Promise<string> {
  const id = randomUUID();
  await db.insert(usageRecords).values({
    id,
    requestId: u.requestId,
    userId: u.userId,
    conversationId: u.conversationId,
    turnId: u.turnId,
    messageId: u.messageId,
    modelId: u.modelId,
    role: u.role,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    reasoningTokens: u.reasoningTokens,
    costMicro: u.costMicro,
    platformFeeMicro: u.platformFeeMicro,
    latencyMs: u.latencyMs,
    status: u.status ?? "ok",
    metaJson: u.meta ? JSON.stringify(u.meta) : null,
    createdAt: Date.now(),
  });
  log.info("usage", {
    requestId: u.requestId,
    userId: u.userId,
    turnId: u.turnId,
    modelId: u.modelId,
    role: u.role,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    reasoningTokens: u.reasoningTokens,
    costMicro: u.costMicro,
    platformFeeMicro: u.platformFeeMicro,
    latencyMs: u.latencyMs,
  });
  return id;
}
