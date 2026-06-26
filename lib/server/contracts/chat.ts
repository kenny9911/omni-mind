import { z } from "zod";
import { ModeEnum, LangEnum } from "./common";

/** POST /api/chat body (docs/technical-design.md §2.2). */
export const ChatBody = z
  .object({
    conversationId: z.string().uuid().optional(),
    mode: ModeEnum.optional(),
    // optional only when regenerating in place (prompt is taken from the stored turn)
    prompt: z.string().trim().min(1).optional(),
    auto: z.boolean().optional(),
    mainModel: z.string().optional(),
    trio: z.array(z.string()).length(3).optional(),
    deepResearch: z.boolean().optional(),
    deepAgents: z.boolean().optional(),
    regenerateTurnId: z.string().uuid().optional(),
  })
  .refine((b) => !(b.trio && new Set(b.trio).size !== 3), {
    message: "trio must be 3 distinct ids",
    path: ["trio"],
  })
  .refine((b) => Boolean(b.regenerateTurnId) || Boolean(b.prompt && b.prompt.length > 0), {
    message: "prompt is required",
    path: ["prompt"],
  });
export type ChatBodyT = z.infer<typeof ChatBody>;

export const RouteBody = z.object({
  prompt: z.string().trim().min(1),
  lang: LangEnum.optional(),
});

export const RegenerateBody = z.object({
  conversationId: z.string(),
  turnId: z.string(),
});

export const ActivityPingBody = z.object({
  action: z.enum(["chat.copy", "result.copy"]),
  turnId: z.string().optional(),
  meta: z.record(z.string(), z.any()).optional(),
});
