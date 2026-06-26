import { z } from "zod";
import type { Conversation } from "../db/schema";

/** Conversations & History contracts (docs/technical-design.md §2.6). */

/** POST /api/conversations body. */
export const CreateConversationBody = z.object({
  title: z.string().max(120).optional(),
});
export type CreateConversationBodyT = z.infer<typeof CreateConversationBody>;

/** GET /api/conversations query. */
export const ListConversationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type ListConversationsQueryT = z.infer<typeof ListConversationsQuery>;

/** PATCH /api/conversations/:id body. */
export const RenameConversationBody = z.object({
  title: z.string().trim().min(1).max(120),
});
export type RenameConversationBodyT = z.infer<typeof RenameConversationBody>;

/** Cursor encodes (updatedAt, id) for stable updatedAt-desc keyset pagination. */
export function encodeCursor(updatedAt: number, id: string): string {
  return Buffer.from(`${updatedAt}:${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { updatedAt: number; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const idx = raw.indexOf(":");
    if (idx < 0) return null;
    const updatedAt = Number(raw.slice(0, idx));
    const id = raw.slice(idx + 1);
    if (!Number.isFinite(updatedAt) || !id) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

/** DTO for POST/PATCH responses — the full conversation record. */
export function toConversationDTO(c: Pick<Conversation, "id" | "title" | "color" | "createdAt" | "updatedAt">) {
  return {
    id: c.id,
    title: c.title,
    color: c.color,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
