import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { route, ApiError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { subscriptions, invoices } from "@/lib/server/db/schema";
import { includedCreditFor, type PlanId } from "@/lib/server/billing/plans";
import { currentMonthRange } from "@/lib/server/util";
import { TopupBody, parseLineItems } from "@/lib/server/contracts/billing";

export const POST = route(
  "billing.topup",
  async (ctx) => {
    const user = requireUser(ctx);
    const { amountMicro } = await parseBody(ctx.req, TopupBody);
    ctx.setMeta({ amountMicro });

    // Stub PSP: in a real integration a charge failure would surface here.
    const charged = true;
    if (!charged) {
      throw new ApiError(402, "PAYMENT_FAILED", "Payment failed");
    }

    const [existing] = await ctx.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id));

    let creditBalanceMicro: number;
    if (existing) {
      creditBalanceMicro = existing.creditBalanceMicro + amountMicro;
      await ctx.db
        .update(subscriptions)
        .set({ creditBalanceMicro, updatedAt: ctx.now })
        .where(eq(subscriptions.userId, user.id));
    } else {
      const planId = user.planId as PlanId;
      const { start, end } = currentMonthRange(ctx.now);
      creditBalanceMicro = amountMicro;
      await ctx.db.insert(subscriptions).values({
        userId: user.id,
        planId,
        includedCreditMicro: includedCreditFor(planId),
        creditBalanceMicro,
        status: "active",
        periodStart: start,
        periodEnd: end,
        updatedAt: ctx.now,
      });
    }

    const lineItems = [{ label: "Top-up", amountMicro }];
    const invoiceId = randomUUID();
    await ctx.db.insert(invoices).values({
      id: invoiceId,
      userId: user.id,
      date: ctx.now,
      planLabel: "Top-up",
      kind: "topup",
      amountMicro,
      status: "paid",
      lineItemsJson: JSON.stringify(lineItems),
      createdAt: ctx.now,
    });

    return {
      creditBalanceMicro,
      invoice: {
        id: invoiceId,
        date: ctx.now,
        planLabel: "Top-up",
        kind: "topup",
        amountMicro,
        status: "paid",
        lineItems: parseLineItems(JSON.stringify(lineItems)),
      },
    };
  },
  { auth: "required" },
);
