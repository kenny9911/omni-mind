import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { route, json, ApiError, parseBody } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { hashPassword } from "@/lib/server/auth/password";
import { seedNewUser } from "@/lib/server/db/seed";
import { users, usageRecords } from "@/lib/server/db/schema";
import { isUniqueViolation } from "@/lib/server/db/errors";
import { normalizeEmail } from "@/lib/server/contracts/auth";
import { AdminUserCreate } from "@/lib/server/contracts/profile";

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
        status: u.status,
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

/** POST /api/admin/users — admin provisions a new account (name/email/password/role/plan). */
export const POST = route(
  "admin.users.create",
  async (ctx) => {
    requireAdmin(ctx);
    const body = await parseBody(ctx.req, AdminUserCreate);
    const email = normalizeEmail(body.email);

    // Friendly fast-path; the unique index is the real guard against a concurrent race below.
    const existing = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) throw new ApiError(409, "EMAIL_TAKEN", "A user with this email already exists");

    const id = randomUUID();
    const { hash, salt } = hashPassword(body.password);
    try {
      // One transaction: the account row and its side effects (preferences, 12 model_state
      // rows, an active subscription) commit together — never a half-provisioned, loginable user.
      await ctx.db.transaction(async (tx) => {
        await tx.insert(users).values({
          id,
          email,
          name: body.name,
          passwordHash: hash,
          salt,
          planId: body.planId,
          role: body.role,
          status: "active",
          isDemo: false,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        });
        await seedNewUser(tx, id, { planId: body.planId });
      });
    } catch (e) {
      // Lost the email race (unique violation) → 409, not a generic 500.
      if (isUniqueViolation(e)) throw new ApiError(409, "EMAIL_TAKEN", "A user with this email already exists");
      throw e;
    }
    ctx.setMeta({ createdId: id, email, role: body.role, plan: body.planId });

    return json(
      {
        user: {
          id,
          name: body.name,
          email,
          role: body.role,
          plan: body.planId,
          status: "active",
          isDemo: false,
          createdAt: ctx.now,
          callCount: 0,
          totalCostMicro: 0,
          lastActiveAt: null,
        },
      },
      { status: 201 },
    );
  },
  { auth: "admin" },
);
