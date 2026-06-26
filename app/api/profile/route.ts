import { eq } from "drizzle-orm";
import { route, ApiError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { users } from "@/lib/server/db/schema";
import { verifyPassword, hashPassword } from "@/lib/server/auth/password";
import { summary } from "@/lib/server/usage/aggregate";
import { ProfilePatch, type ProfileDTO } from "@/lib/server/contracts/profile";
import type { RouteCtx } from "@/lib/server/http";
import type { User } from "@/lib/server/db/schema";

async function buildProfile(ctx: RouteCtx, u: User): Promise<ProfileDTO> {
  const s = await summary(ctx.db, u.id, 0, ctx.now + 1);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    plan: u.planId,
    isDemo: u.isDemo,
    createdAt: u.createdAt,
    stats: {
      totalTokens: s.inputTokens + s.outputTokens + s.reasoningTokens,
      modelCostMicro: s.modelCostMicro,
      platformFeeMicro: s.platformFeeMicro,
      totalMicro: s.totalMicro,
      callCount: s.callCount,
      requestCount: s.requestCount,
    },
  };
}

export const GET = route(
  "profile.get",
  async (ctx) => {
    const u = requireUser(ctx);
    return { profile: await buildProfile(ctx, u) };
  },
  { auth: "required" },
);

export const PATCH = route(
  "profile.update",
  async (ctx) => {
    const u = requireUser(ctx);
    const body = await parseBody(ctx.req, ProfilePatch);

    // The shared demo account is read-only so it stays demo / demo123.
    if (u.isDemo) {
      throw new ApiError(403, "DEMO_READONLY", "The demo account cannot be modified");
    }

    const patch: Partial<typeof users.$inferInsert> = { updatedAt: ctx.now };
    if (body.name) patch.name = body.name;
    if (body.newPassword) {
      if (!verifyPassword(body.currentPassword!, u.passwordHash, u.salt)) {
        throw new ApiError(400, "AUTH_INVALID", "Current password is incorrect");
      }
      const { hash, salt } = hashPassword(body.newPassword);
      patch.passwordHash = hash;
      patch.salt = salt;
    }
    await ctx.db.update(users).set(patch).where(eq(users.id, u.id));
    ctx.setMeta({ changed: Object.keys(body) });

    const [fresh] = await ctx.db.select().from(users).where(eq(users.id, u.id)).limit(1);
    return { profile: await buildProfile(ctx, fresh) };
  },
  { auth: "required" },
);
