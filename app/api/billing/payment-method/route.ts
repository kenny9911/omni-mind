import { eq } from "drizzle-orm";
import { route, ApiError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { paymentMethods } from "@/lib/server/db/schema";
import { PaymentMethodBody } from "@/lib/server/contracts/billing";

export const GET = route(
  "billing.payment_method",
  async (ctx) => {
    const user = requireUser(ctx);
    const [row] = await ctx.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.userId, user.id));
    return {
      method: row
        ? { brand: row.brand, last4: row.last4, expMonth: row.expMonth, expYear: row.expYear }
        : null,
    };
  },
  { auth: "required" },
);

export const PUT = route(
  "billing.payment_method",
  async (ctx) => {
    const user = requireUser(ctx);
    const body = await parseBody(ctx.req, PaymentMethodBody);

    // A card is valid through the end of its expiry month; reject if already past.
    const d = new Date(ctx.now);
    const curMonths = d.getFullYear() * 12 + d.getMonth(); // 0-based month
    const expMonths = body.expYear * 12 + (body.expMonth - 1);
    if (expMonths < curMonths) {
      throw new ApiError(400, "VALIDATION_ERROR", "Card expiry is in the past");
    }

    const masked = "•••• " + body.last4;
    const [existing] = await ctx.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.userId, user.id));
    if (existing) {
      await ctx.db
        .update(paymentMethods)
        .set({
          brand: body.brand,
          last4: body.last4,
          expMonth: body.expMonth,
          expYear: body.expYear,
          updatedAt: ctx.now,
        })
        .where(eq(paymentMethods.userId, user.id));
    } else {
      await ctx.db.insert(paymentMethods).values({
        userId: user.id,
        brand: body.brand,
        last4: body.last4,
        expMonth: body.expMonth,
        expYear: body.expYear,
        updatedAt: ctx.now,
      });
    }

    return {
      method: {
        brand: body.brand,
        last4: body.last4,
        masked,
        expMonth: body.expMonth,
        expYear: body.expYear,
      },
    };
  },
  { auth: "required" },
);
