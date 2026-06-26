import { desc } from "drizzle-orm";
import { route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { users, usageRecords } from "@/lib/server/db/schema";

/** GET /api/admin/users — admin: list every user with lifetime usage stats. */
export const GET = route(
  "admin.users.list",
  async (ctx) => {
    requireAdmin(ctx);

    const list = await ctx.db.select().from(users).orderBy(desc(users.createdAt));
    const usage = await ctx.db
      .select({
        userId: usageRecords.userId,
        costMicro: usageRecords.costMicro,
        feeMicro: usageRecords.platformFeeMicro,
        createdAt: usageRecords.createdAt,
      })
      .from(usageRecords);

    const per = new Map<string, { cost: number; calls: number; last: number }>();
    for (const r of usage) {
      const e = per.get(r.userId) || { cost: 0, calls: 0, last: 0 };
      e.cost += r.costMicro + r.feeMicro;
      e.calls += 1;
      e.last = Math.max(e.last, r.createdAt);
      per.set(r.userId, e);
    }

    const out = list.map((u) => {
      const e = per.get(u.id) || { cost: 0, calls: 0, last: 0 };
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        plan: u.planId,
        isDemo: u.isDemo,
        createdAt: u.createdAt,
        callCount: e.calls,
        totalCostMicro: e.cost,
        lastActiveAt: e.last || null,
      };
    });

    return { users: out, total: out.length };
  },
  { auth: "admin" },
);
