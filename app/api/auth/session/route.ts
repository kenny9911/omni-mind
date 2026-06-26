import { eq } from "drizzle-orm";
import { route, ApiError } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { preferences } from "@/lib/server/db/schema";
import { userWithRoleDto, preferencesPayload } from "@/lib/server/contracts/auth";

export const GET = route(
  "auth.session",
  async (ctx) => {
    const user = requireUser(ctx);

    const prefRows = await ctx.db
      .select()
      .from(preferences)
      .where(eq(preferences.userId, user.id))
      .limit(1);
    const pref = prefRows[0];
    if (!pref) throw new ApiError(500, "INTERNAL", "Missing preferences");

    return {
      user: userWithRoleDto(user),
      plan: user.planId,
      preferences: preferencesPayload(pref),
    };
  },
  { auth: "required" },
);
