import { route, json } from "@/lib/server/http";
import { destroySession, clearCookie } from "@/lib/server/auth/session";

export const POST = route(
  "auth.logout",
  async (ctx) => {
    // Idempotent: deletes the current session if present, always returns 200.
    await destroySession(ctx.db, ctx.req);
    return json({ loggedOut: true }, { headers: { "set-cookie": clearCookie() } });
  },
  { auth: "public" },
);
