import { eq, and } from "drizzle-orm";
import { MODEL_MAP } from "@/lib/models";
import type { Lang, Mode } from "@/lib/types";
import type { DB } from "../db/client";
import { preferences, modelState, turns } from "../db/schema";
import type { ChatBodyT } from "./chat";

/**
 * Compute the caller's effective set of enabled model ids (§1.4):
 * a `model_state` row with `enabled=0` disables that model; absence ⇒ enabled.
 * Starts from the full registry and removes any explicitly-disabled id.
 */
export async function enabledSetFor(db: DB, userId: string): Promise<Set<string>> {
  const set = new Set<string>(Object.keys(MODEL_MAP));
  const rows = await db
    .select({ modelId: modelState.modelId, enabled: modelState.enabled })
    .from(modelState)
    .where(eq(modelState.userId, userId));
  for (const r of rows) {
    if (!r.enabled) set.delete(r.modelId);
  }
  return set;
}

export interface EffectiveSettings {
  mode: Mode;
  auto: boolean;
  mainModel: string;
  trio: string[];
  deepResearch: boolean;
  deepAgents: boolean;
  lang: Lang;
}

/**
 * Resolve the caller's effective chat settings from `preferences` merged with
 * per-request `ChatBody` overrides (§2.2 resolution). Body wins when present.
 */
export async function resolveSettings(
  db: DB,
  userId: string,
  body: Partial<ChatBodyT>,
): Promise<EffectiveSettings> {
  const [pref] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);

  // Preferences are seeded at signup; fall back to schema defaults defensively.
  const prefMode = (pref?.mode ?? "expert") as Mode;
  const prefAuto = pref?.auto ?? true;
  const prefMain = pref?.mainModel ?? "gpt-55";
  const prefLang = (pref?.lang ?? "zh") as Lang;
  let prefTrio: string[];
  try {
    prefTrio = JSON.parse(pref?.trioJson ?? '["deepseek-pro","gpt-55","claude-opus"]');
  } catch {
    prefTrio = ["deepseek-pro", "gpt-55", "claude-opus"];
  }
  const prefDeepResearch = pref?.deepResearch ?? false;
  const prefDeepAgents = pref?.deepAgents ?? false;

  return {
    mode: body.mode ?? prefMode,
    auto: body.auto ?? prefAuto,
    mainModel: body.mainModel ?? prefMain,
    trio: body.trio ?? prefTrio,
    deepResearch: body.deepResearch ?? prefDeepResearch,
    deepAgents: body.deepAgents ?? prefDeepAgents,
    lang: prefLang,
  };
}

/** Resolve only the caller's preferred lang (used by /api/chat/route). */
export async function langFor(db: DB, userId: string): Promise<Lang> {
  const [pref] = await db
    .select({ lang: preferences.lang })
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);
  return (pref?.lang ?? "zh") as Lang;
}

/** True iff a turn with status='streaming' exists in the conversation (single-flight). */
export async function hasStreamingTurn(
  db: DB,
  conversationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.conversationId, conversationId), eq(turns.status, "streaming")))
    .limit(1);
  return Boolean(row);
}
