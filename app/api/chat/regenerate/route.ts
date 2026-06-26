import { route, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { RegenerateBody } from "@/lib/server/contracts/chat";
import { regenerateStream } from "./run";

export const POST = route(
  "chat.regenerate",
  async (ctx) => {
    const user = requireUser(ctx);
    const body = await parseBody(ctx.req, RegenerateBody);
    return regenerateStream(ctx, user.id, {
      conversationId: body.conversationId,
      turnId: body.turnId,
    });
  },
  { auth: "required" },
);
