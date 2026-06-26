import { and, eq, gte, lt, asc } from "drizzle-orm";
import { route, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { windowRange } from "@/lib/server/util";
import { usageRecords } from "@/lib/server/db/schema";
import { ExportQuery, csvCell } from "@/lib/server/contracts/usage";

const CSV_COLUMNS = [
  "id",
  "createdAt",
  "turnId",
  "conversationId",
  "modelId",
  "role",
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "costMicro",
  "platformFeeMicro",
  "totalMicro",
  "latencyMs",
  "status",
] as const;

export const GET = route(
  "usage.export",
  async (ctx) => {
    const user = requireUser(ctx);
    const q = parseQuery(ctx.url, ExportQuery);
    const { from, to } = windowRange(q.window);

    const rows = await ctx.db
      .select()
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.userId, user.id),
          gte(usageRecords.createdAt, from),
          lt(usageRecords.createdAt, to),
        ),
      )
      .orderBy(asc(usageRecords.createdAt));

    ctx.setMeta({ rowCount: rows.length, format: q.format, window: q.window });

    const stamp = new Date(ctx.now).toISOString().slice(0, 10);

    if (q.format === "json") {
      const body = JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          turnId: r.turnId,
          conversationId: r.conversationId,
          modelId: r.modelId,
          role: r.role,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          reasoningTokens: r.reasoningTokens,
          costMicro: r.costMicro,
          platformFeeMicro: r.platformFeeMicro,
          totalMicro: r.costMicro + r.platformFeeMicro,
          latencyMs: r.latencyMs,
          status: r.status,
        })),
      );
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="usage-${q.window}-${stamp}.json"`,
        },
      });
    }

    const lines = [CSV_COLUMNS.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.createdAt,
          r.turnId,
          r.conversationId,
          r.modelId,
          r.role,
          r.inputTokens,
          r.outputTokens,
          r.reasoningTokens,
          r.costMicro,
          r.platformFeeMicro,
          r.costMicro + r.platformFeeMicro,
          r.latencyMs,
          r.status,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    const csv = lines.join("\r\n") + "\r\n";
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="usage-${q.window}-${stamp}.csv"`,
      },
    });
  },
  { auth: "required" },
);
