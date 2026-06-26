import { eq } from "drizzle-orm";
import { route, ApiError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { subscriptions, users, type Subscription } from "@/lib/server/db/schema";
import { monthTotal } from "@/lib/server/usage/aggregate";
import { includedCreditFor, planName, type PlanId } from "@/lib/server/billing/plans";
import { currentMonthRange } from "@/lib/server/util";
import { ChangePlanBody } from "@/lib/server/contracts/billing";
import type { DB } from "@/lib/server/db/client";
import type { User } from "@/lib/server/db/schema";

/** Load the user's subscription row, or synthesize defaults from the user's plan. */
async function loadSub(db: DB, user: User, now: number): Promise<Subscription> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
  if (row) return row;
  const planId = user.planId as PlanId;
  const { start, end } = currentMonthRange(now);
  return {
    userId: user.id,
    planId,
    includedCreditMicro: includedCreditFor(planId),
    creditBalanceMicro: 0,
    status: "active",
    periodStart: start,
    periodEnd: end,
    updatedAt: now,
  };
}

/** Build the US7.UC1 response shape from a subscription row + month usage. */
async function subscriptionView(db: DB, sub: Subscription) {
  const usage = await monthTotal(db, sub.userId);
  const includedCreditMicro = sub.includedCreditMicro;
  const monthTotalMicro = usage.totalMicro;
  const usedPct =
    includedCreditMicro > 0
      ? Math.min(100, Math.round((monthTotalMicro / includedCreditMicro) * 100))
      : 0;
  const remainingMicro = Math.max(0, includedCreditMicro - monthTotalMicro);
  return {
    plan: {
      id: sub.planId,
      name: planName(sub.planId as PlanId, "en"),
      includedCreditMicro,
      periodStart: sub.periodStart,
      periodEnd: sub.periodEnd,
      renewsOn: sub.periodEnd,
    },
    usage: {
      modelCostMicro: usage.modelCostMicro,
      platformFeeMicro: usage.platformFeeMicro,
      monthTotalMicro,
    },
    includedCreditMicro,
    remainingMicro,
    usedPct,
    creditBalanceMicro: sub.creditBalanceMicro,
  };
}

export const GET = route(
  "billing.subscription",
  async (ctx) => {
    const user = requireUser(ctx);
    const sub = await loadSub(ctx.db, user, ctx.now);
    return subscriptionView(ctx.db, sub);
  },
  { auth: "required" },
);

export const POST = route(
  "billing.change_plan",
  async (ctx) => {
    const user = requireUser(ctx);
    const { planId } = await parseBody(ctx.req, ChangePlanBody);
    if (planId === "ent") {
      throw new ApiError(409, "PLAN_REQUIRES_SALES", "Enterprise plan requires contacting sales");
    }
    const current = await loadSub(ctx.db, user, ctx.now);
    const includedCreditMicro = includedCreditFor(planId);
    ctx.setMeta({ fromPlan: current.planId, toPlan: planId });

    const [existing] = await ctx.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id));
    if (existing) {
      await ctx.db
        .update(subscriptions)
        .set({ planId, includedCreditMicro, updatedAt: ctx.now })
        .where(eq(subscriptions.userId, user.id));
    } else {
      await ctx.db.insert(subscriptions).values({
        userId: user.id,
        planId,
        includedCreditMicro,
        creditBalanceMicro: current.creditBalanceMicro,
        status: "active",
        periodStart: current.periodStart,
        periodEnd: current.periodEnd,
        updatedAt: ctx.now,
      });
    }
    await ctx.db.update(users).set({ planId, updatedAt: ctx.now }).where(eq(users.id, user.id));

    const refreshed = await loadSub(ctx.db, { ...user, planId }, ctx.now);
    return subscriptionView(ctx.db, refreshed);
  },
  { auth: "required" },
);
