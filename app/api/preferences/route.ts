import { eq } from "drizzle-orm";
import { route, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { preferences } from "@/lib/server/db/schema";
import {
  PreferencesPatch,
  toPreferencesDTO,
  loadPreferences,
  enabledSetFor,
  assertMainModel,
  assertTrio,
} from "@/lib/server/contracts/preferences";

/**
 * GET /api/preferences (US9.UC1) — full preferences payload.
 * `platformFeePerCallMicro` is the constant billed fee (50000); the trio is
 * parsed from `trio_json`.
 */
export const GET = route(
  "prefs.get",
  async (ctx) => {
    const user = requireUser(ctx);
    const pref = await loadPreferences(ctx.db, user.id);
    return toPreferencesDTO(pref);
  },
  { auth: "required" },
);

/**
 * PATCH /api/preferences (US9.UC2–UC5) — strict partial update.
 * Validation: `mainModel` must be known+enabled (else 400 MODEL_NOT_AVAILABLE /
 * 409 MODEL_DISABLED); `trio` must be 3 distinct enabled ids (else 400
 * INVALID_TRIO). `platformFeeDisplayMicro` is display-only and never affects the
 * billed fee. Applies the partial and returns the full GET payload.
 */
export const PATCH = route(
  "prefs.set",
  async (ctx) => {
    const user = requireUser(ctx);
    const patch = await parseBody(ctx.req, PreferencesPatch);

    // Validate model-touching fields against the caller's enabled set.
    if (patch.mainModel !== undefined || patch.trio !== undefined) {
      const enabled = await enabledSetFor(ctx.db, user.id);
      if (patch.mainModel !== undefined) assertMainModel(patch.mainModel, enabled);
      if (patch.trio !== undefined) assertTrio(patch.trio, enabled);
    }

    const set: Record<string, unknown> = { updatedAt: ctx.now };
    if (patch.theme !== undefined) set.theme = patch.theme;
    if (patch.lang !== undefined) set.lang = patch.lang;
    if (patch.mode !== undefined) set.mode = patch.mode;
    if (patch.auto !== undefined) set.auto = patch.auto;
    if (patch.mainModel !== undefined) set.mainModel = patch.mainModel;
    if (patch.trio !== undefined) set.trioJson = JSON.stringify(patch.trio);
    if (patch.deepResearch !== undefined) set.deepResearch = patch.deepResearch;
    if (patch.deepAgents !== undefined) set.deepAgents = patch.deepAgents;
    if (patch.platformFeeDisplayMicro !== undefined)
      set.platformFeeDisplayMicro = patch.platformFeeDisplayMicro;

    const changed = Object.keys(patch);
    ctx.setMeta({ changed });

    // Ensure a row exists, then apply only the provided fields.
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
