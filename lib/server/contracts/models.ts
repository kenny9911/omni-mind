import { z } from "zod";
import { pick } from "@/lib/i18n";
import type { Lang, ModelDef, Tier } from "@/lib/types";

/**
 * Model Library contracts (docs/technical-design.md §2.3).
 *
 * `GET /api/models` query: optional `?lang` and `?gateway=openrouter`.
 * `PATCH /api/models/:id` body: a discriminated union — exactly one of
 * `{ enabled }` or `{ setMain: true }`.
 */

/** Query for GET /api/models. */
export const ModelsQuery = z.object({
  lang: z.enum(["zh", "zh-TW", "en", "ja"]).optional(),
  gateway: z.literal("openrouter").optional(),
});
export type ModelsQueryT = z.infer<typeof ModelsQuery>;

/** PATCH body: union, exactly one of { enabled } | { setMain: true }. */
export const ModelPatchBody = z.union([
  z.object({ enabled: z.boolean() }).strict(),
  z.object({ setMain: z.literal(true) }).strict(),
]);
export type ModelPatchBodyT = z.infer<typeof ModelPatchBody>;

export interface ModelDTO {
  id: string;
  name: string;
  vendor: string;
  color: string;
  initials: string;
  tier: Tier;
  tags: string[];
  ctx: string;
  pin: number;
  pout: number;
  enabled: boolean;
  isMain: boolean;
}

export interface OpenRouterDTO {
  name: string;
}

/** Localized tags for the caller's language (pick() falls back en → zh). */
function localizedTags(model: ModelDef, lang: Lang): string[] {
  return pick(lang, {
    zh: model.tags,
    "zh-TW": model.tagsTW,
    en: model.tagsEn,
    ja: model.tagsJa,
  });
}

/**
 * Build a ModelDTO from the registry model + per-user state.
 * `enabledMap` is COALESCE(model_state.enabled, true) per model id.
 */
export function buildModelDTO(
  model: ModelDef,
  opts: { enabledMap: Record<string, boolean>; mainModel: string; lang: Lang },
): ModelDTO {
  const enabled = opts.enabledMap[model.id] ?? true;
  return {
    id: model.id,
    name: model.name,
    vendor: model.vendor,
    color: model.color,
    initials: model.initials,
    tier: model.tier,
    tags: localizedTags(model, opts.lang),
    ctx: model.ctx,
    pin: model.pin,
    pout: model.pout,
    enabled,
    isMain: model.id === opts.mainModel,
  };
}

export function mapOpenRouter(models: readonly string[]): OpenRouterDTO[] {
  return models.map((name) => ({ name }));
}
