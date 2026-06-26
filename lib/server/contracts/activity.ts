import { z } from "zod";
import type { ActivityLog, UsageRecord } from "../db/schema";

/**
 * Contracts for Activity Logging & Observability (US10) + the copy-ping (US2.UC4).
 * docs/technical-design.md §2.8. All zod schemas + DTO mappers live here.
 */

/* ───────────────────────── POST /api/activity (copy ping, US2.UC4) ───────── */
// Body shape mirrors contracts/chat.ts ActivityPingBody; redeclared here so this
// domain owns its validation without a cross-file collision.
export const ActivityPingBody = z.object({
  action: z.enum(["chat.copy", "result.copy"]),
  turnId: z.string().optional(),
  meta: z.record(z.string(), z.any()).optional(),
});
export type ActivityPingBodyT = z.infer<typeof ActivityPingBody>;

/* ───────────────────────── GET /api/activity (US10.UC3) ──────────────────── */
export const ActivityQuery = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  action: z.string().optional(),
  route: z.string().optional(),
  status: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  userId: z.string().optional(), // admin-only; ignored/forbidden for non-admin
});
export type ActivityQueryT = z.infer<typeof ActivityQuery>;

export type ActivityLogDTO = {
  requestId: string;
  action: string;
  route: string;
  method: string;
  status: number;
  latencyMs: number;
  createdAt: number;
};

export function toActivityLogDTO(r: ActivityLog): ActivityLogDTO {
  return {
    requestId: r.requestId,
    action: r.action,
    route: r.route,
    method: r.method,
    status: r.status,
    latencyMs: r.latencyMs,
    createdAt: r.createdAt,
  };
}

/* ───────────────────────── GET /api/activity/export (US10.UC4) ───────────── */
export const ActivityExportQuery = z.object({
  type: z.enum(["activity", "usage"]),
  format: z.enum(["csv", "json"]),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
});
export type ActivityExportQueryT = z.infer<typeof ActivityExportQuery>;

/* ───────────────────────── GET /api/admin/metrics (US10.UC5) ─────────────── */
export const MetricsQuery = z.object({
  window: z.enum(["1h", "24h", "7d", "30d"]).default("24h"),
});
export type MetricsQueryT = z.infer<typeof MetricsQuery>;

export const WINDOW_MS: Record<MetricsQueryT["window"], number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/* ───────────────────────── cursor (createdAt,id) newest-first ────────────── */
export type ActivityCursor = { createdAt: number; id: string };

export function encodeCursor(c: ActivityCursor): string {
  return Buffer.from(`${c.createdAt}:${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): ActivityCursor | null {
  try {
    const s = Buffer.from(raw, "base64url").toString("utf8");
    const idx = s.indexOf(":");
    if (idx < 0) return null;
    const createdAt = Number(s.slice(0, idx));
    const id = s.slice(idx + 1);
    if (!Number.isFinite(createdAt) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/* ───────────────────────── CSV building (escape commas/quotes) ───────────── */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",");
}

/** Column projections for export, shared by csv + json branches. */
export const ACTIVITY_EXPORT_COLUMNS = [
  "requestId",
  "userId",
  "action",
  "route",
  "method",
  "status",
  "latencyMs",
  "createdAt",
] as const;

export function activityExportRow(r: ActivityLog): Record<string, unknown> {
  return {
    requestId: r.requestId,
    userId: r.userId,
    action: r.action,
    route: r.route,
    method: r.method,
    status: r.status,
    latencyMs: r.latencyMs,
    createdAt: r.createdAt,
  };
}

export const USAGE_EXPORT_COLUMNS = [
  "id",
  "requestId",
  "userId",
  "conversationId",
  "turnId",
  "messageId",
  "modelId",
  "role",
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "costMicro",
  "platformFeeMicro",
  "latencyMs",
  "status",
  "createdAt",
] as const;

export function usageExportRow(r: UsageRecord): Record<string, unknown> {
  return {
    id: r.id,
    requestId: r.requestId,
    userId: r.userId,
    conversationId: r.conversationId,
    turnId: r.turnId,
    messageId: r.messageId,
    modelId: r.modelId,
    role: r.role,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    reasoningTokens: r.reasoningTokens,
    costMicro: r.costMicro,
    platformFeeMicro: r.platformFeeMicro,
    latencyMs: r.latencyMs,
    status: r.status,
    createdAt: r.createdAt,
  };
}
