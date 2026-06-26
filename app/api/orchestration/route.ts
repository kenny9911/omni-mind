import { eq } from "drizzle-orm";
import { route, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { preferences } from "@/lib/server/db/schema";
import {
  OrchestrationPatch,
  toPreferencesDTO,
  loadPreferences,
  enabledSetFor,
  assertMainModel,
  assertTrio,
} from "@/lib/server/contracts/preferences";

/**
 * PATCH /api/orchestration (US4, FR-14) — alias for the orchestration subset of
 * preferences: `{ mainModel?, auto?, trio?, mode? }`. Same validation as
 * `PATCH /api/preferences`. Setting `mainModel` implies `auto=false`
 * (US4.UC2) unless the caller explicitly provided `auto`. Returns the full
 * preferences payload.
 */
export const PATCH = route(
  "orchestration.set",
  async (ctx) => {
    const user = requireUser(ctx);
    const patch = await parseBody(ctx.req, OrchestrationPatch);

    if (patch.mainModel !== undefined || patch.trio !== undefined) {
      const enabled = await enabledSetFor(ctx.db, user.id);
      if (patch.mainModel !== undefined) assertMainModel(patch.mainModel, enabled);
      if (patch.trio !== undefined) assertTrio(patch.trio, enabled);
    }

    const set: Record<string, unknown> = { updatedAt: ctx.now };
    if (patch.mode !== undefined) set.mode = patch.mode;
    if (patch.trio !== undefined) set.trioJson = JSON.stringify(patch.trio);
    if (patch.mainModel !== undefined) set.mainModel = patch.mainModel;

    // Setting a main model implies turning off auto-routing (US4.UC2),
    // unless the caller explicitly specified `auto` in the same patch.
    if (patch.auto !== undefined) {
      set.auto = patch.auto;
    } else if (patch.mainModel !== undefined) {
      set.auto = false;
    }

    const changed = Object.keys(set).filter((k) => k !== "updatedAt");
    ctx.setMeta({ changed });

    await ctx.db
      .insert(preferences)
      .values({ userId: user.id, updatedAt: ctx.now })
      .onConflictDoNothing();
    await ctx.db
      .update(preferences)
      .set(set)
      .where(eq(preferences.userId, user.id));

    const pref = await loadPreferences(ctx.db, user.id);
    return toPreferencesDTO(pref);
  },
  { auth: "required" },
);
