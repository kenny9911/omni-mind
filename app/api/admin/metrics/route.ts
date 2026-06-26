import { and, gte } from "drizzle-orm";
import { route, parseQuery } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { activityLogs, usageRecords } from "@/lib/server/db/schema";
import { MetricsQuery, WINDOW_MS } from "@/lib/server/contracts/activity";

/** Percentile (linear, nearest-rank-ish) over a sorted ascending number[]. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * GET /api/admin/metrics — observability dashboard (US10.UC5), §2.8. Admin only.
 * errorRate = count(status>=500)/count(*); p50/p95 over activity_logs.latency_ms
 * computed in JS; activeUsers = distinct user_id; usage rollups from usage_records.
 */
export const GET = route(
  "admin.metrics",
  async (ctx) => {
    requireAdmin(ctx);
    const { window } = parseQuery(ctx.url, MetricsQuery);
    const since = ctx.now - WINDOW_MS[window];

    const logs = await ctx.db
      .select()
      .from(activityLogs)
      .where(and(gte(activityLogs.createdAt, since)));

    const requests = logs.length;
    let serverErrors = 0;
    const latencies: number[] = [];
    const activeUserSet = new Set<string>();
    const actionCounts = new Map<string, number>();
    for (const l of logs) {
      if (l.status >= 500) serverErrors++;
      latencies.push(l.latencyMs);
      if (l.userId) activeUserSet.add(l.userId);
      actionCounts.set(l.action, (actionCounts.get(l.action) ?? 0) + 1);
    }
    latencies.sort((a, b) => a - b);

    const usage = await ctx.db
      .select()
      .from(usageRecords)
      .where(and(gte(usageRecords.createdAt, since)));

    let totalTokens = 0;
    let totalCostMicro = 0;
    let totalFeeMicro = 0;
    const byModel = new Map<string, { calls: number; costMicro: number }>();
    for (const u of usage) {
      totalTokens += u.inputTokens + u.outputTokens + u.reasoningTokens;
      totalCostMicro += u.costMicro;
      totalFeeMicro += u.platformFeeMicro;
      const m = byModel.get(u.modelId) ?? { calls: 0, costMicro: 0 };
      m.calls++;
      m.costMicro += u.costMicro;
      byModel.set(u.modelId, m);
    }

    const callsByModel = [...byModel.entries()]
      .map(([modelId, v]) => ({ modelId, calls: v.calls, costMicro: v.costMicro }))
      .sort((a, b) => b.costMicro - a.costMicro);

    const requestsByAction = [...actionCounts.entries()]
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);

    return {
      window,
      metrics: {
        requests,
        errorRate: requests ? serverErrors / requests : 0,
        p50LatencyMs: percentile(latencies, 50),
        p95LatencyMs: percentile(latencies, 95),
        activeUsers: activeUserSet.size,
        totalCalls: usage.length,
        totalTokens,
        totalCostMicro,
        totalFeeMicro,
        callsByModel,
        requestsByAction,
      },
    };
  },
  { auth: "admin" },
);
