import { route, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { ledger } from "@/lib/server/usage/aggregate";
import { LedgerQuery } from "@/lib/server/contracts/usage";

export const GET = route(
  "usage.ledger",
  async (ctx) => {
    const user = requireUser(ctx);
    const q = parseQuery(ctx.url, LedgerQuery);
    return ledger(ctx.db, user.id, q.limit, q.cursor);
  },
  { auth: "required" },
);
