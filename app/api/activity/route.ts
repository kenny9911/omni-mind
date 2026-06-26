import { and, desc, eq, gte, lte, lt, or } from "drizzle-orm";
import { route, ApiError, parseBody, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { activityLogs } from "@/lib/server/db/schema";
import {
  ActivityPingBody,
  ActivityQuery,
  decodeCursor,
  encodeCursor,
  toActivityLogDTO,
} from "@/lib/server/contracts/activity";

/**
 * POST /api/activity — copy ping (US2.UC4 / US8.UC5), §2.8.
 * No usage. The route() wrapper records the activity_logs row using the action
 * label we pass below; we surface the client-supplied action + turnId into meta
 * so the single log row reflects what was copied.
 */
export const POST = route(
  "activity.ping",
  async (ctx) => {
    requireUser(ctx);
    const body = await parseBody(ctx.req, ActivityPingBody);
    ctx.setMeta({ action: body.action, ...(body.turnId ? { turnId: body.turnId } : {}), ...(body.meta ?? {}) });
    return { logged: true };
  },
  { auth: "required" },
);

/**
 * GET /api/activity — activity query (US10.UC3), §2.8.
 * Non-admin callers are force-scoped to their own userId via an injected WHERE
 * (a client-supplied ?userId that differs → 403 FORBIDDEN). Admins may pass any
 * ?userId. Newest-first, keyset cursor over (createdAt,id).
 */
export const GET = route(
  "activity.query",
  async (ctx) => {
    const user = requireUser(ctx);
    const q = parseQuery(ctx.url, ActivityQuery);
    const isAdmin = user.role === "admin";

    // Resolve the scoping userId. Non-admins can never widen beyond themselves.
    let scopeUserId: string;
    if (isAdmin) {
      scopeUserId = q.userId ?? user.id;
    } else {
      if (q.userId !== undefined && q.userId !== user.id) {
        throw new ApiError(403, "FORBIDDEN", "Cannot query another user's activity");
      }
      scopeUserId = user.id;
    }

    const conds = [eq(activityLogs.userId, scopeUserId)];
    if (q.from !== undefined) conds.push(gte(activityLogs.createdAt, q.from));
    if (q.to !== undefined) conds.push(lte(activityLogs.createdAt, q.to));
    if (q.action !== undefined) conds.push(eq(activityLogs.action, q.action));
    if (q.route !== undefined) conds.push(eq(activityLogs.route, q.route));
    if (q.status !== undefined) conds.push(eq(activityLogs.status, q.status));

    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c) throw new ApiError(400, "VALIDATION_ERROR", "Invalid cursor");
      // Keyset for newest-first: strictly older, or same ts with a smaller id.
      conds.push(
        or(
          lt(activityLogs.createdAt, c.createdAt),
          and(eq(activityLogs.createdAt, c.createdAt), lt(activityLogs.id, c.id)),
        )!,
      );
    }

    const rows = await ctx.db
      .select()
      .from(activityLogs)
      .where(and(...conds))
      .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

    return { logs: page.map(toActivityLogDTO), nextCursor };
  },
  { auth: "required" },
);
