/**
 * Live-mode helpers — translate backend DTOs into the client store's shape,
 * and build client-side ledger records from per-turn usage events so the
 * EXISTING aggregate() in lib/accounting works on real data.
 */
import type { LedgerRecord, Mode, OmniState } from "../types";
import type { PreferencesDTO } from "./api";

/** Map the session/preferences DTO → a Partial<OmniState>. */
export function prefsToState(prefs: PreferencesDTO): Partial<OmniState> {
  return {
    theme: prefs.theme,
    lang: prefs.lang,
    mode: prefs.mode,
    auto: prefs.auto,
    mainModel: prefs.mainModel,
    trio: prefs.trio.slice(),
    deepResearch: prefs.deepResearch,
    deepAgents: prefs.deepAgents,
  };
}

/** A single model entry from api.models.list().models. */
export interface ModelListItem {
  id: string;
  enabled?: boolean;
  isMain?: boolean;
}

/**
 * Map api.models.list().models → the per-id enabled map plus the resolved
 * main model (the model flagged isMain, if any).
 */
export function enabledFromModels(models: ModelListItem[]): {
  enabled: Record<string, boolean>;
  mainModel: string | null;
} {
  const enabled: Record<string, boolean> = {};
  let mainModel: string | null = null;
  for (const m of models) {
    if (!m || typeof m.id !== "string") continue;
    enabled[m.id] = m.enabled !== false;
    if (m.isMain) mainModel = m.id;
  }
  return { enabled, mainModel };
}

/** A per-call usage event collected during a live turn. */
export interface CallUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

/**
 * Build a client LedgerRecord from the usage events collected during a turn.
 * outTok folds reasoning into output so respCost()/aggregate() bill it.
 */
export function recordCallsToLedger(args: {
  prompt: string;
  mode: Mode;
  calls: CallUsage[];
  ts?: Date;
}): LedgerRecord {
  return {
    ts: args.ts ?? new Date(),
    prompt: args.prompt,
    mode: args.mode,
    calls: args.calls.map((c) => ({
      id: c.modelId,
      inTok: c.inputTokens,
      outTok: c.outputTokens + c.reasoningTokens,
    })),
  };
}
