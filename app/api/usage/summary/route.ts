import { route, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { windowRange } from "@/lib/server/util";
import { summary } from "@/lib/server/usage/aggregate";
import { PLATFORM_FEE_MICRO } from "@/lib/server/llm/cost";
import { SummaryQuery, resolveRange } from "@/lib/server/contracts/usage";

export const GET = route(
  "usage.summary",
  async (ctx) => {
    const user = requireUser(ctx);
    const q = parseQuery(ctx.url, SummaryQuery);
    const { from, to } = resolveRange(q, windowRange);
    const totals = await summary(ctx.db, user.id, from, to);
    return {
      window: q.window,
      totals,
      platformFeePerCallMicro: PLATFORM_FEE_MICRO(),
    };
  },
  { auth: "required" },
);
