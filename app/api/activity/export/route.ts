import { and, asc, eq, gte, lte } from "drizzle-orm";
import { route, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { activityLogs, usageRecords } from "@/lib/server/db/schema";
import {
  ActivityExportQuery,
  ACTIVITY_EXPORT_COLUMNS,
  USAGE_EXPORT_COLUMNS,
  activityExportRow,
  usageExportRow,
  csvRow,
} from "@/lib/server/contracts/activity";

/**
 * GET /api/activity/export — streamed export of activity_logs or usage_records
 * (US10.UC4), §2.8. Non-admin callers are force-scoped to their own userId via
 * an injected WHERE. Returns an attachment (csv or json). meta.rowCount is logged.
 */
export const GET = route(
  "activity.export",
  async (ctx) => {
    const user = requireUser(ctx);
    const q = parseQuery(ctx.url, ActivityExportQuery);
    const isAdmin = user.role === "admin";

    // Build rows + projected records for whichever source was requested.
    let records: Record<string, unknown>[];
    let columns: readonly string[];

    if (q.type === "usage") {
      const conds = [];
      if (!isAdmin) conds.push(eq(usageRecords.userId, user.id));
      if (q.from !== undefined) conds.push(gte(usageRecords.createdAt, q.from));
      if (q.to !== undefined) conds.push(lte(usageRecords.createdAt, q.to));
      const rows = await ctx.db
        .select()
        .from(usageRecords)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(asc(usageRecords.createdAt));
      records = rows.map(usageExportRow);
      columns = USAGE_EXPORT_COLUMNS;
    } else {
      const conds = [];
      if (!isAdmin) conds.push(eq(activityLogs.userId, user.id));
      if (q.from !== undefined) conds.push(gte(activityLogs.createdAt, q.from));
      if (q.to !== undefined) conds.push(lte(activityLogs.createdAt, q.to));
      const rows = await ctx.db
        .select()
        .from(activityLogs)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(asc(activityLogs.createdAt));
      records = rows.map(activityExportRow);
      columns = ACTIVITY_EXPORT_COLUMNS;
    }

    ctx.setMeta({ rowCount: records.length, type: q.type, format: q.format });

    const stamp = new Date(ctx.now).toISOString().slice(0, 10);
    const filename = `${q.type}-${stamp}.${q.format}`;
    const disposition = `attachment; filename="${filename}"`;

    if (q.format === "json") {
      const body = JSON.stringify({ type: q.type, rowCount: records.length, rows: records });
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": disposition,
        },
      });
    }

    // CSV: header row + one row per record, RFC-4180 escaped via csvRow.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(csvRow(columns) + "\r\n"));
        for (const rec of records) {
          controller.enqueue(enc.encode(csvRow(columns.map((c) => rec[c])) + "\r\n"));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": disposition,
      },
    });
  },
  { auth: "required" },
);
