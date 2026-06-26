import { ApiError, type RouteCtx } from "../http";
import type { User } from "../db/schema";

/** Assert an authenticated user (the route() wrapper already enforces this for auth:"required"). */
export function requireUser(ctx: RouteCtx): User {
  if (!ctx.user) throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
  return ctx.user;
}

export function requireAdmin(ctx: RouteCtx): User {
  const u = requireUser(ctx);
  if (u.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Admin only");
  return u;
}

/** Ownership check — missing/!owned resources surface as NOT_FOUND (no existence leak). */
export function assertOwner<T extends { userId: string } | undefined | null>(
  row: T,
  userId: string,
): NonNullable<T> {
  if (!row || row.userId !== userId) throw new ApiError(404, "NOT_FOUND", "Not found");
  return row as NonNullable<T>;
}
