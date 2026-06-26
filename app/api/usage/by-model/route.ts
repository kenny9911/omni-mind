import { route, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { windowRange } from "@/lib/server/util";
import { byModel } from "@/lib/server/usage/aggregate";
import { ByModelQuery } from "@/lib/server/contracts/usage";

export const GET = route(
  "usage.by_model",
  async (ctx) => {
    const user = requireUser(ctx);
    const q = parseQuery(ctx.url, ByModelQuery);
    const { from, to } = windowRange(q.window);
    return byModel(ctx.db, user.id, from, to, q.limit);
  },
  { auth: "required" },
);
