import { eq } from "drizzle-orm";
import { route, ApiError, parseBody } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { hashPassword } from "@/lib/server/auth/password";
import { users, sessions, subscriptions, usageRecords, activityLogs, userMemory } from "@/lib/server/db/schema";
import { includedCreditFor, type PlanId } from "@/lib/server/billing/plans";
import { AdminUserPatch } from "@/lib/server/contracts/profile";

const SYSTEM_EMAILS = new Set(["demo", "admin@robohire.io"]);

/** PATCH /api/admin/users/:id — admin edits a user's name / role / plan. */
export const PATCH = route(
  "admin.users.update",
  async (ctx) => {
    const admin = requireAdmin(ctx);
    const targetId = ctx.params.id;
    const [target] = await ctx.db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) throw new ApiError(404, "NOT_FOUND", "User not found");

    // The fixed demo/admin system accounts are immutable (keeps demo→user/mock and the
    // admin's role/plan stable). Use the Profile page to edit your own details.
    if (SYSTEM_EMAILS.has(target.email)) {
      throw new ApiError(400, "CANNOT_MODIFY_SYSTEM", "System accounts cannot be modified");
    }

    const body = await parseBody(ctx.req, AdminUserPatch);

    // Guard against self-lockout: an admin cannot demote or suspend themselves.
    if (body.role === "user" && targetId === admin.id) {
      throw new ApiError(400, "CANNOT_DEMOTE_SELF", "You cannot remove your own admin role");
    }
    if (body.status === "suspended" && targetId === admin.id) {
      throw new ApiError(400, "CANNOT_SUSPEND_SELF", "You cannot suspend your own account");
    }

    const patch: Partial<typeof users.$inferInsert> = { updatedAt: ctx.now };
    if (body.name) patch.name = body.name;
    if (body.role) patch.role = body.role;
    if (body.planId) patch.planId = body.planId;
    if (body.status) patch.status = body.status;
    if (body.newPassword) {
      const { hash, salt } = hashPassword(body.newPassword);
      patch.passwordHash = hash;
      patch.salt = salt;
    }
    await ctx.db.update(users).set(patch).where(eq(users.id, targetId));

    // An admin-initiated password reset invalidates the target's active sessions, so the
    // old credentials can't keep a hijacked session alive — they must sign in afresh.
    if (body.newPassword) {
      await ctx.db.delete(sessions).where(eq(sessions.userId, targetId));
    }

    if (body.planId) {
      await ctx.db
        .update(subscriptions)
        .set({ planId: body.planId, includedCreditMicro: includedCreditFor(body.planId as PlanId), updatedAt: ctx.now })
        .where(eq(subscriptions.userId, targetId));
    }
    ctx.setMeta({ targetId, changed: Object.keys(body) });

    const [fresh] = await ctx.db.select().from(users).where(eq(users.id, targetId)).limit(1);
    return {
      user: { id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role, plan: fresh.planId, status: fresh.status, isDemo: fresh.isDemo, createdAt: fresh.createdAt },
    };
  },
  { auth: "admin" },
);

/** DELETE /api/admin/users/:id — admin: remove a user and all their data. */
export const DELETE = route(
  "admin.users.delete",
  async (ctx) => {
    const admin = requireAdmin(ctx);
    const targetId = ctx.params.id;
    if (targetId === admin.id) {
      throw new ApiError(400, "CANNOT_DELETE_SELF", "You cannot delete your own account");
    }
    const [target] = await ctx.db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) throw new ApiError(404, "NOT_FOUND", "User not found");
    if (SYSTEM_EMAILS.has(target.email)) {
      throw new ApiError(400, "CANNOT_DELETE_SYSTEM", "System accounts cannot be deleted");
    }

    // Cascade removes conversations/turns/messages/sessions/prefs/model_state/
    // subscription/invoices/payment_methods/user_memory; usage + activity carry the
    // user_id directly (no FK) so we clear them explicitly. user_memory cascades, but
    // we also delete it explicitly so removal never depends on the cascade pragma.
    await ctx.db.delete(usageRecords).where(eq(usageRecords.userId, targetId));
    await ctx.db.delete(activityLogs).where(eq(activityLogs.userId, targetId));
    await ctx.db.delete(userMemory).where(eq(userMemory.userId, targetId));
    await ctx.db.delete(users).where(eq(users.id, targetId));

    ctx.setMeta({ targetId, email: target.email });
    return { id: targetId, deleted: true };
  },
  { auth: "admin" },
);
