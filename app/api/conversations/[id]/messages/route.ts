import { asc, eq, inArray, sql } from "drizzle-orm";
import { route } from "@/lib/server/http";
import { requireUser, assertOwner } from "@/lib/server/auth/guard";
import { conversations, turns, messages, usageRecords } from "@/lib/server/db/schema";

/** GET /api/conversations/:id/messages — rehydrate the full chat view, oldest→newest (US8.UC5). */
export const GET = route(
  "conversation.messages",
  async (ctx) => {
    const user = requireUser(ctx);
    const id = ctx.params.id;

    const [conv] = await ctx.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    assertOwner(conv, user.id); // missing/not-owned → 404 NOT_FOUND

    const turnRows = await ctx.db
      .select()
      .from(turns)
      .where(eq(turns.conversationId, id))
      .orderBy(asc(turns.createdAt), asc(turns.id));

    if (turnRows.length === 0) return { turns: [] };

    const turnIds = turnRows.map((t) => t.id);

    // All messages for the conversation (seq 0 = user, seq 1 = assistant).
    const msgRows = await ctx.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id));
    const userPayloadByTurn = new Map<string, unknown>();
    const assistantPayloadByTurn = new Map<string, unknown>();
    for (const m of msgRows) {
      const parsed = safeParse(m.payloadJson);
      if (m.seq === 0) userPayloadByTurn.set(m.turnId, parsed);
      else if (m.seq === 1) assistantPayloadByTurn.set(m.turnId, parsed);
    }

    // Derive per-turn rollups from usage_records (billing source of truth).
    const usageRows = await ctx.db
      .select({
        turnId: usageRecords.turnId,
        inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens} + ${usageRecords.reasoningTokens}), 0)`,
        modelCostMicro: sql<number>`coalesce(sum(${usageRecords.costMicro}), 0)`,
        platformFeeMicro: sql<number>`coalesce(sum(${usageRecords.platformFeeMicro}), 0)`,
        callCount: sql<number>`count(*)`,
      })
      .from(usageRecords)
      .where(inArray(usageRecords.turnId, turnIds))
      .groupBy(usageRecords.turnId);
    const usageByTurn = new Map(usageRows.map((u) => [u.turnId, u]));

    const out = turnRows.map((t) => {
      const userPayload = userPayloadByTurn.get(t.id) as { text?: string } | undefined;
      const assistantPayload = (assistantPayloadByTurn.get(t.id) ?? {}) as Record<string, unknown>;

      const assistant: Record<string, unknown> = {
        mode: t.mode,
        deepResearch: !!t.deepResearch,
      };
      // routeText: prefer persisted payload, fall back to the turn column (fast+auto only).
      const routeText =
        (assistantPayload.routeText as string | null | undefined) ?? t.routeText ?? null;
      if (routeText != null) assistant.routeText = routeText;
      if (assistantPayload.single !== undefined) assistant.single = assistantPayload.single;
      if (assistantPayload.experts !== undefined) assistant.experts = assistantPayload.experts;
      if (assistantPayload.fusion !== undefined) assistant.fusion = assistantPayload.fusion;
      if (assistantPayload.sources !== undefined) assistant.sources = assistantPayload.sources;

      const u = usageByTurn.get(t.id);
      const inputTokens = Number(u?.inputTokens ?? 0);
      const outputTokens = Number(u?.outputTokens ?? 0);
      const modelCostMicro = Number(u?.modelCostMicro ?? 0);
      const platformFeeMicro = Number(u?.platformFeeMicro ?? 0);
      const callCount = Number(u?.callCount ?? 0);

      return {
        turnId: t.id,
        user: { text: userPayload?.text ?? t.promptText },
        assistant,
        perTurn: {
          inputTokens,
          outputTokens,
          modelCostMicro,
          platformFeeMicro,
          totalMicro: modelCostMicro + platformFeeMicro,
          callCount,
        },
      };
    });

    return { turns: out };
  },
  { auth: "required" },
);

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
