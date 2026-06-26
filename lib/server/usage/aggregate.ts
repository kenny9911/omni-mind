import { and, eq, gte, lt, desc, lte } from "drizzle-orm";
import { MODEL_MAP } from "@/lib/models";
import type { DB } from "../db/client";
import { usageRecords, turns } from "../db/schema";
import { truncate, currentMonthRange } from "../util";

/**
 * Usage & cost aggregation — the single source of truth for analytics & billing math.
 * All sums are over integer micro-CNY so aggregate totals exactly equal the sum of
 * per-call usage_records (SM2 / NFR-6). See docs/technical-design.md §2.4.
 */

export interface Totals {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  modelCostMicro: number;
  platformFeeMicro: number;
  totalMicro: number;
  callCount: number;
  requestCount: number;
}

async function rowsInRange(db: DB, userId: string, from: number, to: number) {
  return db
    .select()
    .from(usageRecords)
    .where(and(eq(usageRecords.userId, userId), gte(usageRecords.createdAt, from), lt(usageRecords.createdAt, to)));
}

export async function summary(db: DB, userId: string, from: number, to: number): Promise<Totals> {
  const rows = await rowsInRange(db, userId, from, to);
  let inputTokens = 0, outputTokens = 0, reasoningTokens = 0, modelCostMicro = 0, platformFeeMicro = 0;
  const reqs = new Set<string>();
  for (const r of rows) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    reasoningTokens += r.reasoningTokens;
    modelCostMicro += r.costMicro;
    platformFeeMicro += r.platformFeeMicro;
    reqs.add(r.turnId);
  }
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    modelCostMicro,
    platformFeeMicro,
    totalMicro: modelCostMicro + platformFeeMicro,
    callCount: rows.length,
    requestCount: reqs.size,
  };
}

export interface TrendDay {
  key: number;
  label: string;
  totalMicro: number;
}

export async function trend(db: DB, userId: string, days: number): Promise<TrendDay[]> {
  const today = new Date();
  const buckets: TrendDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    buckets.push({ key: d.getTime(), label: d.getMonth() + 1 + "/" + d.getDate(), totalMicro: 0 });
  }
  const from = buckets[0].key;
  const rows = await rowsInRange(db, userId, from, Date.now() + 1);
  for (const r of rows) {
    const d = new Date(r.createdAt);
    d.setHours(0, 0, 0, 0);
    const b = buckets.find((x) => x.key === d.getTime());
    if (b) b.totalMicro += r.costMicro + r.platformFeeMicro;
  }
  return buckets;
}

export interface PerModel {
  modelId: string;
  name: string;
  color: string;
  calls: number;
  modelCostMicro: number;
  sharePct: number;
}

export async function byModel(
  db: DB,
  userId: string,
  from: number,
  to: number,
  limit = 6,
): Promise<{ models: PerModel[]; totalModelCostMicro: number }> {
  const rows = await rowsInRange(db, userId, from, to);
  const per = new Map<string, { calls: number; cost: number }>();
  let total = 0;
  for (const r of rows) {
    const e = per.get(r.modelId) || { calls: 0, cost: 0 };
    e.calls += 1;
    e.cost += r.costMicro;
    per.set(r.modelId, e);
    total += r.costMicro;
  }
  const models = [...per.entries()]
    .map(([modelId, e]) => ({
      modelId,
      name: MODEL_MAP[modelId]?.name ?? modelId,
      color: MODEL_MAP[modelId]?.color ?? "#8b8fa3",
      calls: e.calls,
      modelCostMicro: e.cost,
      sharePct: total > 0 ? Math.round((e.cost / total) * 100) : 0,
    }))
    .sort((a, b) => b.modelCostMicro - a.modelCostMicro)
    .slice(0, limit);
  return { models, totalModelCostMicro: total };
}

export interface LedgerRow {
  turnId: string;
  ts: number;
  prompt: string;
  mode: string;
  models: { modelId: string; name: string; color: string }[];
  inputTokens: number;
  outputTokens: number;
  modelCostMicro: number;
  platformFeeMicro: number;
  totalMicro: number;
}

export async function ledger(
  db: DB,
  userId: string,
  limit = 12,
  cursor?: number,
): Promise<{ rows: LedgerRow[]; nextCursor: number | null }> {
  const conds = [eq(turns.userId, userId)];
  if (cursor) conds.push(lte(turns.createdAt, cursor));
  const turnRows = await db
    .select()
    .from(turns)
    .where(and(...conds))
    .orderBy(desc(turns.createdAt))
    .limit(limit + 1);

  const page = turnRows.slice(0, limit);
  const nextCursor = turnRows.length > limit ? turnRows[limit].createdAt : null;
  const rows: LedgerRow[] = [];
  for (const t of page) {
    const urs = await db.select().from(usageRecords).where(eq(usageRecords.turnId, t.id));
    let inputTokens = 0, outputTokens = 0, modelCostMicro = 0, platformFeeMicro = 0;
    const seen = new Set<string>();
    const models: LedgerRow["models"] = [];
    for (const u of urs) {
      inputTokens += u.inputTokens;
      outputTokens += u.outputTokens + u.reasoningTokens;
      modelCostMicro += u.costMicro;
      platformFeeMicro += u.platformFeeMicro;
      if (!seen.has(u.modelId)) {
        seen.add(u.modelId);
        models.push({ modelId: u.modelId, name: MODEL_MAP[u.modelId]?.name ?? u.modelId, color: MODEL_MAP[u.modelId]?.color ?? "#8b8fa3" });
      }
    }
    rows.push({
      turnId: t.id,
      ts: t.createdAt,
      prompt: truncate(t.promptText, 80),
      mode: t.mode,
      models,
      inputTokens,
      outputTokens,
      modelCostMicro,
      platformFeeMicro,
      totalMicro: modelCostMicro + platformFeeMicro,
    });
  }
  return { rows, nextCursor };
}

/** Model cost + platform fee over the current calendar month (billing). */
export async function monthTotal(db: DB, userId: string, now = Date.now()): Promise<{ modelCostMicro: number; platformFeeMicro: number; totalMicro: number }> {
  const { start, end } = currentMonthRange(now);
  const t = await summary(db, userId, start, end);
  return { modelCostMicro: t.modelCostMicro, platformFeeMicro: t.platformFeeMicro, totalMicro: t.totalMicro };
}
