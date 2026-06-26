import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { route, parseBody, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { conversations, turns } from "@/lib/server/db/schema";
import { colorFor, truncate } from "@/lib/server/util";
import {
  CreateConversationBody,
  ListConversationsQuery,
  decodeCursor,
  encodeCursor,
  toConversationDTO,
} from "@/lib/server/contracts/conversations";

/** POST /api/conversations — create a conversation (US8.UC1). */
export const POST = route(
  "conversation.create",
  async (ctx) => {
    const user = requireUser(ctx);
    const body = await parseBody(ctx.req, CreateConversationBody);

    const id = randomUUID();
    const now = ctx.now;
    const row = {
      id,
      userId: user.id,
      title: body.title?.trim() || "New chat",
      color: colorFor(id),
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert(conversations).values(row);
    return { conversation: toConversationDTO(row) };
  },
  { auth: "required" },
);

/** GET /api/conversations — list recents, updatedAt desc, keyset paginated (US8.UC2). */
export const GET = route(
  "conversation.list",
  async (ctx) => {
    const user = requireUser(ctx);
    const { limit, cursor } = parseQuery(ctx.url, ListConversationsQuery);

    const conds = [eq(conversations.userId, user.id)];
    if (cursor) {
      const c = decodeCursor(cursor);
      if (c) {
        // keyset: rows strictly after (updatedAt, id) in updatedAt desc, id desc order
        conds.push(
          or(
            lt(conversations.updatedAt, c.updatedAt),
            and(eq(conversations.updatedAt, c.updatedAt), lt(conversations.id, c.id)),
          )!,
        );
      }
    }

    const rows = await ctx.db
      .select()
      .from(conversations)
      .where(and(...conds))
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    let turnCounts = new Map<string, number>();
    let lastPrompts = new Map<string, string>();
    if (page.length > 0) {
      const ids = page.map((c) => c.id);
      const counts = await ctx.db
        .select({
          conversationId: turns.conversationId,
          count: sql<number>`count(*)`,
        })
        .from(turns)
        .where(inArray(turns.conversationId, ids))
        .groupBy(turns.conversationId);
      turnCounts = new Map(counts.map((r) => [r.conversationId, Number(r.count)]));

      // newest turn prompt per conversation
      const latest = await ctx.db
        .select({
          conversationId: turns.conversationId,
          promptText: turns.promptText,
          createdAt: turns.createdAt,
        })
        .from(turns)
        .where(inArray(turns.conversationId, ids))
        .orderBy(turns.conversationId, desc(turns.createdAt));
      for (const r of latest) {
        if (!lastPrompts.has(r.conversationId)) lastPrompts.set(r.conversationId, r.promptText);
      }
    }

    const conversationsDto = page.map((c) => ({
      id: c.id,
      title: c.title,
      color: c.color,
      updatedAt: c.updatedAt,
      lastPrompt: truncate(lastPrompts.get(c.id) ?? "", 80),
      turnCount: turnCounts.get(c.id) ?? 0,
    }));

    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.updatedAt, last.id) : null;

    return { conversations: conversationsDto, nextCursor };
  },
  { auth: "required" },
);
