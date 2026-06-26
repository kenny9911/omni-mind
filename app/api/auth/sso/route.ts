import { route, ApiError, parseBody } from "@/lib/server/http";
import { SsoBody } from "@/lib/server/contracts/auth";

/**
 * POST /api/auth/sso — single sign-on. No OAuth provider is wired in this build, so
 * SSO is unavailable: we validate the provider (400 for an unknown one) and otherwise
 * return 503. It NEVER creates an account — real OAuth must be configured first.
 */
export const POST = route(
  "auth.sso",
  async (ctx) => {
    const { provider } = await parseBody(ctx.req, SsoBody); // 400 VALIDATION_ERROR for a bad provider
    ctx.setMeta({ provider });
    throw new ApiError(
      503,
      "SSO_NOT_CONFIGURED",
      "Single sign-on isn't configured yet — sign in with email and password.",
    );
  },
  { auth: "public" },
);
