import { eq, desc } from "drizzle-orm";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { invoices } from "@/lib/server/db/schema";

export const GET = route(
  "billing.invoices",
  async (ctx) => {
    const user = requireUser(ctx);
    const rows = await ctx.db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, user.id))
      .orderBy(desc(invoices.date));
    return {
      invoices: rows.map((r) => ({
        id: r.id,
        date: r.date,
        planLabel: r.planLabel,
        kind: r.kind,
        amountMicro: r.amountMicro,
        status: r.status,
      })),
    };
  },
  { auth: "required" },
);
