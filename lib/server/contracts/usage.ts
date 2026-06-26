import { z } from "zod";

/** Usage & Cost Analytics query contracts (docs/technical-design.md §2.4). */

export const UsageWindowEnum = z.enum(["7d", "30d", "all"]);
export type UsageWindowT = z.infer<typeof UsageWindowEnum>;

/**
 * GET /api/usage/summary query — `?window` (default 7d) OR an explicit `?from&?to`
 * epoch-ms range. When both `from` and `to` are present they take precedence.
 */
export const SummaryQuery = z.object({
  window: UsageWindowEnum.default("7d"),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
});
export type SummaryQueryT = z.infer<typeof SummaryQuery>;

/** GET /api/usage/trend query. */
export const TrendQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});
export type TrendQueryT = z.infer<typeof TrendQuery>;

/** GET /api/usage/by-model query. */
export const ByModelQuery = z.object({
  window: UsageWindowEnum.default("7d"),
  limit: z.coerce.number().int().min(1).max(50).default(6),
});
export type ByModelQueryT = z.infer<typeof ByModelQuery>;

/** GET /api/usage/ledger query — keyset pagination by `turn.created_at` (epoch-ms). */
export const LedgerQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(12),
  cursor: z.coerce.number().int().nonnegative().optional(),
});
export type LedgerQueryT = z.infer<typeof LedgerQuery>;

/** GET /api/usage/export query. */
export const ExportQuery = z.object({
  format: z.enum(["csv", "json"]),
  window: UsageWindowEnum.default("7d"),
});
export type ExportQueryT = z.infer<typeof ExportQuery>;

/** GET /api/usage (alias) query — dispatches to the matching sub-aggregator. */
export const AliasQuery = z.object({
  trend: z.string().optional(), // e.g. "7d" → trend view (days parsed below)
  by: z.string().optional(), // "model" → by-model view
  view: z.string().optional(), // "ledger" → ledger view
  window: UsageWindowEnum.default("7d"),
  days: z.coerce.number().int().min(1).max(90).default(7),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.coerce.number().int().nonnegative().optional(),
});
export type AliasQueryT = z.infer<typeof AliasQuery>;

/**
 * Resolve a summary window into a `[from, to)` epoch-ms range. An explicit
 * `from`+`to` pair overrides the named window.
 */
export function resolveRange(
  q: { window: UsageWindowT; from?: number; to?: number },
  windowRange: (w: UsageWindowT, now?: number) => { from: number; to: number },
): { from: number; to: number } {
  if (q.from !== undefined && q.to !== undefined) return { from: q.from, to: q.to };
  return windowRange(q.window);
}

/** RFC-4180 cell escaping for CSV export. */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
