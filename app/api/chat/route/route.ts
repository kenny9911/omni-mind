import { route as wrap, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { route as routeIntent } from "@/lib/server/llm/router";
import { RouteBody } from "@/lib/server/contracts/chat";
import { enabledSetFor, langFor } from "@/lib/server/contracts/chat-helpers";

export const POST = wrap(
  "chat.route",
  async (ctx) => {
    const user = requireUser(ctx);
    const body = await parseBody(ctx.req, RouteBody);

    const lang = body.lang ?? (await langFor(ctx.db, user.id));
    const enabledSet = await enabledSetFor(ctx.db, user.id);

    const r = routeIntent(body.prompt, lang, enabledSet);
    return {
      modelId: r.id,
      label: r.label,
      routeText: r.routeText,
      fallback: r.fallback,
    };
  },
  { auth: "required" },
);
