import { route, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { trend } from "@/lib/server/usage/aggregate";
import { TrendQuery } from "@/lib/server/contracts/usage";

export const GET = route(
  "usage.trend",
  async (ctx) => {
    const user = requireUser(ctx);
    const q = parseQuery(ctx.url, TrendQuery);
    return { days: await trend(ctx.db, user.id, q.days) };
  },
  { auth: "required" },
);
