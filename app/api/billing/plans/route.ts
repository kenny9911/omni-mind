import { eq } from "drizzle-orm";
import { route, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { subscriptions } from "@/lib/server/db/schema";
import { LangEnum } from "@/lib/server/contracts/common";
import { PLANS, planFeatures, planName, planPeriod, type PlanId } from "@/lib/server/billing/plans";
import { z } from "zod";

const PlansQuery = z.object({ lang: LangEnum.optional() });

export const GET = route(
  "billing.plans",
  async (ctx) => {
    const user = requireUser(ctx);
    const { lang = "zh" } = parseQuery(ctx.url, PlansQuery);

    const [sub] = await ctx.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id));
    const currentPlan = (sub?.planId ?? user.planId) as PlanId;

    const plans = PLANS.map((p) => ({
      id: p.id,
      name: planName(p.id, lang),
      priceMicro: p.priceMicro,
      period: planPeriod(p.id, lang),
      includedCreditMicro: p.includedCreditMicro,
      features: planFeatures(p.id, lang),
      current: p.id === currentPlan,
    }));
    return { plans };
  },
  { auth: "required" },
);
