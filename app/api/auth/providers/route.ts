import { route, json } from "@/lib/server/http";
import { googleConfigured } from "@/lib/server/auth/google";

/**
 * GET /api/auth/providers — which third-party sign-in providers are configured.
 * Public; lets the sign-in screen enable the Google button only when OAuth is wired.
 * github/wechat/apple remain false until implemented.
 */
export const GET = route(
  "auth.providers",
  async () =>
    json({
      providers: {
        google: googleConfigured(),
        github: false,
        wechat: false,
        apple: false,
      },
    }),
  { auth: "public" },
);
