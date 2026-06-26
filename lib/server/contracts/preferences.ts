import { z } from "zod";
import { eq } from "drizzle-orm";
import { ApiError } from "../http";
import type { DB } from "../db/client";
import { preferences } from "../db/schema";
import { isKnownModel } from "../llm/registry";
import { PLATFORM_FEE_MICRO } from "../llm/cost";
import { enabledSetFor } from "./chat-helpers";

/**
 * Preferences & Localization (US9) + orchestration alias (US4) — §2.7.
 *
 * Money is integer micro-CNY. `platformFeePerCallMicro` is the *billed* fee
 * (constant 50000 per model call); `platformFeeDisplayMicro` is a DISPLAY-ONLY
 * value the user may tune for the UI and NEVER affects what is billed.
 */

/** PATCH /api/preferences — strict partial (§2.7). */
export const PreferencesPatch = z
  .object({
    theme: z.enum(["dark", "light"]).optional(),
    lang: z.enum(["zh", "zh-TW", "en", "ja"]).optional(),
    mode: z.enum(["fast", "expert"]).optional(),
    auto: z.boolean().optional(),
    mainModel: z.string().optional(), // must be known+enabled else 400 MODEL_NOT_AVAILABLE / 409 MODEL_DISABLED
    trio: z.array(z.string()).length(3).optional(), // 3 distinct enabled ids else 400 INVALID_TRIO
    deepResearch: z.boolean().optional(),
    deepAgents: z.boolean().optional(),
    platformFeeDisplayMicro: z.number().int().min(0).max(1_000_000).optional(), // display-only; never bills
  })
  .strict();
export type PreferencesPatchT = z.infer<typeof PreferencesPatch>;

/** PATCH /api/orchestration — alias accepting the {mainModel,auto,trio,mode} subset (FR-14). */
export const OrchestrationPatch = z
  .object({
    mainModel: z.string().optional(),
    auto: z.boolean().optional(),
    trio: z.array(z.string()).length(3).optional(),
    mode: z.enum(["fast", "expert"]).optional(),
  })
  .strict();
export type OrchestrationPatchT = z.infer<typeof OrchestrationPatch>;

// The billed platform fee per model call comes from the single cost-engine source
// (PLATFORM_FEE_MICRO, driven by PLATFORM_FEE_CNY) — never the display value, never a literal.

export interface PreferencesDTO {
  theme: string;
  lang: string;
  mode: string;
  auto: boolean;
  mainModel: string;
  trio: string[];
  deepResearch: boolean;
  deepAgents: boolean;
  platformFeePerCallMicro: number;
  platformFeeDisplayMicro: number;
}

/** Parse the stored trio_json into a string[3] (tolerant of null/garbage → schema default). */
export function parseTrio(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '["deepseek-pro","gpt-55","claude-opus"]');
    if (Array.isArray(v)) return v.map((x) => String(x));
  } catch {
    /* fall through */
  }
  return ["deepseek-pro", "gpt-55", "claude-opus"];
}

/** Map a preferences row → the GET payload (shared by GET + the PATCH responses). */
export function toPreferencesDTO(pref: {
  theme: string;
  lang: string;
  mode: string;
  auto: boolean;
  mainModel: string;
  trioJson: string;
  deepResearch: boolean;
  deepAgents: boolean;
  platformFeeDisplayMicro: number;
}): PreferencesDTO {
  return {
    theme: pref.theme,
    lang: pref.lang,
    mode: pref.mode,
    auto: pref.auto,
    mainModel: pref.mainModel,
    trio: parseTrio(pref.trioJson),
    deepResearch: pref.deepResearch,
    deepAgents: pref.deepAgents,
    platformFeePerCallMicro: PLATFORM_FEE_MICRO(),
    platformFeeDisplayMicro: pref.platformFeeDisplayMicro,
  };
}

/**
 * Validate a candidate `mainModel`:
 *  - unknown id            → 400 MODEL_NOT_AVAILABLE
 *  - known but disabled    → 409 MODEL_DISABLED
 */
export function assertMainModel(id: string, enabled: Set<string>): void {
  if (!isKnownModel(id)) {
    throw new ApiError(400, "MODEL_NOT_AVAILABLE", "Main model is not available");
  }
  if (!enabled.has(id)) {
    throw new ApiError(409, "MODEL_DISABLED", "Main model is disabled");
  }
}

/**
 * Validate a candidate `trio`: must be 3 distinct, known, enabled ids.
 * Anything else (dupes, unknown, or disabled member) → 400 INVALID_TRIO.
 * Length is already enforced by the zod `.length(3)`.
 */
export function assertTrio(trio: string[], enabled: Set<string>): void {
  const distinct = new Set(trio);
  const valid =
    distinct.size === 3 && trio.every((id) => isKnownModel(id) && enabled.has(id));
  if (!valid) {
    throw new ApiError(400, "INVALID_TRIO", "Trio must be 3 distinct enabled models");
  }
}

/**
 * Load the caller's preferences row, falling back to schema defaults if absent
 * (preferences are seeded at signup; this is defensive). Returns a row-shaped
 * object suitable for `toPreferencesDTO`.
 */
export async function loadPreferences(db: DB, userId: string) {
  const [pref] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);
  if (pref) return pref;
  return {
    userId,
    theme: "dark",
    lang: "zh",
    mode: "expert",
    auto: true,
    mainModel: "gpt-55",
    trioJson: '["deepseek-pro","gpt-55","claude-opus"]',
    deepResearch: false,
    deepAgents: false,
    platformFeeDisplayMicro: 50_000,
    updatedAt: 0,
  } as typeof preferences.$inferSelect;
}

export { enabledSetFor };
