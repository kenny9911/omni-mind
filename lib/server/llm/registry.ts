import { MODELS, MODEL_MAP, PRICE_MAP, OPENROUTER_MODELS } from "@/lib/models";
import type { ModelDef } from "@/lib/types";

/**
 * Server-authoritative model registry. Re-exports the shared catalog (single
 * source of truth shared with the client) and adds server-only mappings.
 */
export { MODELS, MODEL_MAP, PRICE_MAP, OPENROUTER_MODELS };

export const DEFAULT_TRIO = ["deepseek-pro", "gpt-55", "claude-opus"];
export const DEFAULT_MAIN_MODEL = "gpt-55";

export function isKnownModel(id: string): boolean {
  return Boolean(MODEL_MAP[id]);
}

export function getModel(id: string): ModelDef | undefined {
  return MODEL_MAP[id];
}

/**
 * Map our internal model id → the AI Gateway "provider/model" string.
 * Maps an internal model id to its AI Gateway "provider/model" slug.
 */
const GATEWAY_SLUGS: Record<string, string> = {
  "deepseek-pro": "deepseek/deepseek-v3",
  "deepseek-flash": "deepseek/deepseek-v3",
  glm: "zhipu/glm-4.5",
  doubao: "bytedance/doubao",
  kimi: "moonshotai/kimi-k2",
  minimax: "minimax/minimax-m1",
  qwen: "alibaba/qwen-3",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-pro": "google/gemini-2.5-pro",
  "gpt-mini": "openai/gpt-5-mini",
  "gpt-55": "openai/gpt-5",
  "claude-opus": "anthropic/claude-opus-4.1",
};

export function gatewaySlug(id: string): string {
  return GATEWAY_SLUGS[id] || "openai/gpt-5";
}
