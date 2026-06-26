import { eq } from "drizzle-orm";
import { route, ApiError, parseBody, type RouteCtx } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { isKnownModel, getModel, MODELS } from "@/lib/server/llm/registry";
import { modelState, preferences } from "@/lib/server/db/schema";
import type { Lang } from "@/lib/types";
import {
  ModelPatchBody,
  type ModelPatchBodyT,
  buildModelDTO,
} from "@/lib/server/contracts/models";

/** Load (or default) the user's preference row. */
async function loadPref(ctx: RouteCtx, userId: string) {
  const [pref] = await ctx.db
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);
  const mainModel = pref?.mainModel ?? "gpt-55";
  let trio: string[] = ["deepseek-pro", "gpt-55", "claude-opus"];
  if (pref?.trioJson) {
    try {
      const parsed = JSON.parse(pref.trioJson);
      if (Array.isArray(parsed)) trio = parsed as string[];
    } catch {
      /* keep default */
    }
  }
  const lang: Lang = (pref?.lang as Lang) ?? "zh";
  return { mainModel, trio, lang };
}

/** Map of model_state.enabled (COALESCE 1) for this user. */
async function loadEnabledMap(
  ctx: RouteCtx,
  userId: string,
): Promise<Record<string, boolean>> {
  const rows = await ctx.db
    .select()
    .from(modelState)
    .where(eq(modelState.userId, userId));
  const map: Record<string, boolean> = {};
  for (const r of rows) map[r.modelId] = r.enabled;
  return map;
}

/** Upsert the per-(user,model) enabled flag. */
async function setEnabled(
  ctx: RouteCtx,
  userId: string,
  modelId: string,
  enabled: boolean,
) {
  await ctx.db
    .insert(modelState)
    .values({ userId, modelId, enabled, updatedAt: ctx.now })
    .onConflictDoUpdate({
      target: [modelState.userId, modelState.modelId],
      set: { enabled, updatedAt: ctx.now },
    });
}

/** US5.UC2 — toggle a model's enabled flag. */
const toggle = route(
  "models.toggle",
  async (ctx) => {
    const user = requireUser(ctx);
    const id = ctx.params.id;
    if (!isKnownModel(id)) {
      throw new ApiError(404, "MODEL_NOT_FOUND", "Unknown model");
    }
    const body = (await parseBody(ctx.req, ModelPatchBody)) as ModelPatchBodyT;
    if (!("enabled" in body)) {
      // Body shape mismatch for this branch (defensive; dispatcher routes by body).
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid request");
    }
    const enabled = body.enabled;
    ctx.setMeta({ modelId: id, enabled });

    const { mainModel, trio, lang } = await loadPref(ctx, user.id);

    // The main model is the fusion compiler — it cannot be silently dropped.
    if (!enabled && id === mainModel) {
      throw new ApiError(
        409,
        "CANNOT_DISABLE_MAIN",
        "Cannot disable the main model",
      );
    }

    await setEnabled(ctx, user.id, id, enabled);

    const enabledMap = await loadEnabledMap(ctx, user.id);
    enabledMap[id] = enabled;

    // FR: a disabled model must not remain selected as an expert. If the model
    // being turned off is in the active trio, drop it and backfill with the
    // first still-enabled model so the trio keeps three distinct experts.
    let nextTrio: string[] | null = null;
    if (!enabled && trio.includes(id)) {
      const kept = trio.filter((t) => t !== id);
      const isEnabled = (mid: string) => enabledMap[mid] ?? true;
      const replacement = MODELS.find(
        (m) => m.id !== id && !kept.includes(m.id) && isEnabled(m.id),
      );
      nextTrio = replacement ? [...kept, replacement.id] : kept;
      await ctx.db
        .update(preferences)
        .set({ trioJson: JSON.stringify(nextTrio), updatedAt: ctx.now })
        .where(eq(preferences.userId, user.id));
      ctx.setMeta({ trioBackfilled: true });
    }

    const model = buildModelDTO(getModel(id)!, { enabledMap, mainModel, lang });
    return nextTrio ? { model, trio: nextTrio } : { model };
  },
  { auth: "required" },
);

/** US5.UC3 — pin a model as the main model (must be enabled). */
const setMain = route(
  "models.setMain",
  async (ctx) => {
    const user = requireUser(ctx);
    const id = ctx.params.id;
    if (!isKnownModel(id)) {
      throw new ApiError(404, "MODEL_NOT_FOUND", "Unknown model");
    }
    await parseBody(ctx.req, ModelPatchBody); // validate { setMain: true }
    ctx.setMeta({ mainModel: id });

    const { lang } = await loadPref(ctx, user.id);
    const enabledMap = await loadEnabledMap(ctx, user.id);
    const targetEnabled = enabledMap[id] ?? true;
    if (!targetEnabled) {
      throw new ApiError(
        400,
        "MODEL_NOT_AVAILABLE",
        "Model must be enabled to be set as main",
      );
    }

    await ctx.db
      .update(preferences)
      .set({ mainModel: id, updatedAt: ctx.now })
      .where(eq(preferences.userId, user.id));

    const model = buildModelDTO(getModel(id)!, {
      enabledMap,
      mainModel: id,
      lang,
    });
    return { model, mainModel: id };
  },
  { auth: "required" },
);

/**
 * PATCH /api/models/:id — body is a union: exactly one of `{ enabled }` or
 * `{ setMain: true }`. Dispatch by body shape so the activity action is
 * `models.toggle` vs `models.setMain` (docs/technical-design.md §2.3).
 */
export async function PATCH(
  req: Request,
  nextCtx: { params: Promise<Record<string, string>> | Record<string, string> },
): Promise<Response> {
  // Peek at the body to route to the correctly-named handler without consuming
  // the stream the inner route() will re-read.
  let raw: unknown = {};
  try {
    raw = await req.clone().json();
  } catch {
    raw = {};
  }
  const isSetMain =
    raw != null && typeof raw === "object" && "setMain" in (raw as object);
  return isSetMain ? setMain(req, nextCtx) : toggle(req, nextCtx);
}
