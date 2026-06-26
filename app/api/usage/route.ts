import { route, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { windowRange } from "@/lib/server/util";
import { summary, trend, byModel, ledger } from "@/lib/server/usage/aggregate";
import { PLATFORM_FEE_MICRO } from "@/lib/server/llm/cost";
import { AliasQuery } from "@/lib/server/contracts/usage";

/**
 * GET /api/usage — convenience alias (FR-21..24). Dispatches to the same
 * aggregators as the sub-routes based on which selector query param is present:
 *   ?trend=7d    → trend view (leading integer of the value is the day count)
 *   ?by=model    → by-model view
 *   ?view=ledger → ledger view
 *   else         → summary view
 */
export const GET = route(
  "usage.summary",
  async (ctx) => {
    const user = requireUser(ctx);
    const q = parseQuery(ctx.url, AliasQuery);

    if (q.trend !== undefined) {
      const parsed = parseInt(q.trend, 10);
      const days = Number.isFinite(parsed) ? Math.min(90, Math.max(1, parsed)) : q.days;
      ctx.setMeta({ view: "trend" });
      return { days: await trend(ctx.db, user.id, days) };
    }

    if (q.by === "model") {
      const { from, to } = windowRange(q.window);
      ctx.setMeta({ view: "by_model" });
      return byModel(ctx.db, user.id, from, to, q.limit ?? 6);
    }

    if (q.view === "ledger") {
      ctx.setMeta({ view: "ledger" });
      return ledger(ctx.db, user.id, q.limit ?? 12, q.cursor);
    }

    const { from, to } = windowRange(q.window);
    ctx.setMeta({ view: "summary" });
    return {
      window: q.window,
      totals: await summary(ctx.db, user.id, from, to),
      platformFeePerCallMicro: PLATFORM_FEE_MICRO(),
    };
  },
  { auth: "required" },
);
