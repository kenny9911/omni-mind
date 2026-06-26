import { eq } from "drizzle-orm";
import { route } from "@/lib/server/http";
import { requireUser, assertOwner } from "@/lib/server/auth/guard";
import { invoices } from "@/lib/server/db/schema";
import { parseLineItems } from "@/lib/server/contracts/billing";

export const GET = route(
  "billing.invoice_detail",
  async (ctx) => {
    const user = requireUser(ctx);
    const [row] = await ctx.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, ctx.params.id));
    const inv = assertOwner(row, user.id);
    return {
      invoice: {
        id: inv.id,
        date: inv.date,
        planLabel: inv.planLabel,
        kind: inv.kind,
        amountMicro: inv.amountMicro,
        status: inv.status,
        lineItems: parseLineItems(inv.lineItemsJson),
      },
    };
  },
  { auth: "required" },
);
