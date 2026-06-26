import { and, eq, sql } from "drizzle-orm";
import { route, parseBody } from "@/lib/server/http";
import { requireUser, assertOwner } from "@/lib/server/auth/guard";
import { conversations, turns, messages } from "@/lib/server/db/schema";
import {
  RenameConversationBody,
  toConversationDTO,
} from "@/lib/server/contracts/conversations";

/** PATCH /api/conversations/:id — rename, bump updatedAt (US8.UC3). */
export const PATCH = route(
  "conversation.rename",
  async (ctx) => {
    const user = requireUser(ctx);
    const id = ctx.params.id;
    const body = await parseBody(ctx.req, RenameConversationBody);

    const [existing] = await ctx.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    assertOwner(existing, user.id); // missing/not-owned → 404 NOT_FOUND

    const updated = {
      ...existing,
      title: body.title.trim(),
      updatedAt: ctx.now,
    };
    await ctx.db
      .update(conversations)
      .set({ title: updated.title, updatedAt: updated.updatedAt })
      .where(eq(conversations.id, id));

    return { conversation: toConversationDTO(updated) };
  },
  { auth: "required" },
);

/** DELETE /api/conversations/:id — delete conversation + turns + messages; RETAIN usage_records (US8.UC4). */
export const DELETE = route(
  "conversation.delete",
  async (ctx) => {
    const user = requireUser(ctx);
    const id = ctx.params.id;

    const [existing] = await ctx.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    assertOwner(existing, user.id); // missing/not-owned → 404 NOT_FOUND

    const [{ turnCount }] = await ctx.db
      .select({ turnCount: sql<number>`count(*)` })
      .from(turns)
      .where(eq(turns.conversationId, id));

    // Explicit child deletion in child→parent order (does not rely on FK cascade pragma).
    // usage_records are intentionally NOT deleted: they carry user_id and survive for billing integrity.
    await ctx.db.delete(messages).where(eq(messages.conversationId, id));
    await ctx.db.delete(turns).where(eq(turns.conversationId, id));
    await ctx.db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)));

    ctx.setMeta({ turnCount: Number(turnCount) });
    return { id, deleted: true };
  },
  { auth: "required" },
);
