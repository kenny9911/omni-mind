import type { LanguageModel } from "ai";
import { gatewaySlug } from "./registry";
import { log } from "../log/logger";

/**
 * Option A — direct provider (BYOK) resolution with layered fallback.
 *
 * For each model we build an ORDERED list of candidates and the caller tries
 * them in turn, falling through only when a candidate errors before emitting any
 * output (so a wrong model id or a down provider degrades transparently):
 *
 *   1. Dedicated provider (your own key, cheapest/most direct) — `@ai-sdk/*`.
 *   2. OpenRouter (one key, verified slugs for every model) — universal coverage.
 *   3. Vercel AI Gateway slug string — final fallback.
 *
 * Everything is keyed off env vars; set none and real chats fail with a clear
 * GATEWAY_NOT_CONFIGURED. `LLM_FORCE_GATEWAY=1` collapses to the gateway only.
 * Provider model ids below are tunable to whatever your accounts expose; the
 * OpenRouter slugs are verified against its live catalog.
 */

type DirectProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "openai-compatible";

interface Dedicated {
  provider: DirectProvider;
  /** the provider's own model id (edit to match your account's catalog) */
  model: string;
  /** env var holding the provider API key (BYOK) */
  keyEnv: string;
  /** OpenAI-compatible base URL (required for `openai-compatible`) */
  baseURL?: string;
  /** provider display name for `createOpenAICompatible` */
  name?: string;
}

/** internal model id → dedicated first-party provider (only those with a key configured run). */
const DEDICATED: Record<string, Dedicated> = {
  "gpt-55": { provider: "openai", model: "gpt-5.5", keyEnv: "OPENAI_API_KEY" },
  "gpt-mini": { provider: "openai", model: "gpt-5.4-mini", keyEnv: "OPENAI_API_KEY" },
  // Anthropic via its OpenAI-compatible endpoint — uses ANTHROPIC_API_KEY directly and
  // avoids a stream-parsing skew in @ai-sdk/anthropic@3 against this ai@6 line.
  "claude-opus": { provider: "openai-compatible", model: "claude-opus-4-8", keyEnv: "ANTHROPIC_API_KEY", baseURL: "https://api.anthropic.com/v1", name: "anthropic" },
  "gemini-pro": { provider: "google", model: "gemini-2.5-pro", keyEnv: "GEMINI_API_KEY" },
  "gemini-flash": { provider: "google", model: "gemini-2.5-flash", keyEnv: "GEMINI_API_KEY" },
  "deepseek-pro": { provider: "deepseek", model: "deepseek-chat", keyEnv: "DEEPSEEK_API_KEY" },
  "deepseek-flash": { provider: "deepseek", model: "deepseek-chat", keyEnv: "DEEPSEEK_API_KEY" },
  kimi: { provider: "openai-compatible", model: "kimi-k2.6", keyEnv: "KIMI_API_KEY", baseURL: "https://api.moonshot.cn/v1", name: "moonshot" },
  glm: { provider: "openai-compatible", model: "glm-4.5", keyEnv: "GLM_API_KEY", baseURL: "https://open.bigmodel.cn/api/paas/v4", name: "zhipu" },
};

/** internal model id → OpenRouter slug (verified against openrouter.ai/api/v1/models). */
const OPENROUTER_SLUGS: Record<string, string> = {
  "deepseek-pro": "deepseek/deepseek-v4-pro",
  "deepseek-flash": "deepseek/deepseek-v4-flash",
  "gpt-55": "openai/gpt-5.5",
  "gpt-mini": "openai/gpt-5.4-mini",
  "claude-opus": "anthropic/claude-opus-4.8",
  "gemini-pro": "google/gemini-3.1-pro-preview",
  "gemini-flash": "google/gemini-3.5-flash",
  glm: "z-ai/glm-5.2",
  doubao: "bytedance-seed/seed-2.0-mini",
  kimi: "moonshotai/kimi-k2.6",
  minimax: "minimax/minimax-m3",
  qwen: "qwen/qwen3.7-plus",
};
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** Set LLM_FORCE_GATEWAY=1 to ignore all direct keys and always use the gateway. */
function forceGateway(): boolean {
  return process.env.LLM_FORCE_GATEWAY === "1";
}

/** True when any non-gateway provider key (dedicated or OpenRouter) is configured. */
export function directKeyPresent(): boolean {
  if (forceGateway()) return false;
  if (process.env.OPENROUTER_API_KEY) return true;
  return Object.values(DEDICATED).some((c) => Boolean(process.env[c.keyEnv]));
}

/** True when model `id` has at least one direct (non-gateway) provider configured. */
export function hasDirectProvider(id: string): boolean {
  if (forceGateway()) return false;
  const d = DEDICATED[id];
  if (d && process.env[d.keyEnv]) return true;
  return Boolean(OPENROUTER_SLUGS[id] && process.env.OPENROUTER_API_KEY);
}

// Provider instances are stateless and cached by a stable key. Concurrent
// first-calls for the same key may each build once (later write wins) — harmless.
const cache = new Map<string, LanguageModel>();

async function buildDedicated(id: string, c: Dedicated): Promise<LanguageModel> {
  const ck = "ded:" + id;
  const hit = cache.get(ck);
  if (hit) return hit;
  const apiKey = process.env[c.keyEnv]!;
  let model: LanguageModel;
  switch (c.provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      model = createOpenAI({ apiKey })(c.model);
      break;
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      model = createAnthropic({ apiKey })(c.model);
      break;
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      model = createGoogleGenerativeAI({ apiKey })(c.model);
      break;
    }
    case "deepseek": {
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      model = createDeepSeek({ apiKey })(c.model);
      break;
    }
    case "openai-compatible": {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      model = createOpenAICompatible({ name: c.name ?? id, apiKey, baseURL: c.baseURL! })(c.model);
      break;
    }
  }
  cache.set(ck, model);
  return model;
}

async function buildOpenRouter(slug: string): Promise<LanguageModel> {
  const ck = "or:" + slug;
  const hit = cache.get(ck);
  if (hit) return hit;
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const model = createOpenAICompatible({
    name: "openrouter",
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: OPENROUTER_BASE,
  })(slug);
  cache.set(ck, model);
  return model;
}

async function safeBuild(fn: () => Promise<LanguageModel>, id: string): Promise<LanguageModel | null> {
  try {
    return await fn();
  } catch (e) {
    log.warn("provider.direct_init_failed", {
      modelId: id,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** A resolved model candidate with a human label for observability. */
export interface Candidate {
  label: string;
  model: LanguageModel | string;
}

/**
 * Ordered model candidates for `streamText`: dedicated provider (if keyed) →
 * OpenRouter (if keyed) → the gateway slug string. The caller tries each in turn.
 * Always returns at least the gateway slug, so it never resolves to empty.
 */
export async function resolveCandidates(id: string): Promise<Candidate[]> {
  if (forceGateway()) return [{ label: "gateway", model: gatewaySlug(id) }];
  const out: Candidate[] = [];

  const ded = DEDICATED[id];
  if (ded && process.env[ded.keyEnv]) {
    const m = await safeBuild(() => buildDedicated(id, ded), id);
    if (m) out.push({ label: `dedicated:${ded.provider}`, model: m });
  }

  const slug = OPENROUTER_SLUGS[id];
  if (slug && process.env.OPENROUTER_API_KEY) {
    const m = await safeBuild(() => buildOpenRouter(slug), id);
    if (m) out.push({ label: "openrouter", model: m });
  }

  out.push({ label: "gateway", model: gatewaySlug(id) }); // Vercel gateway — final fallback
  return out;
}

/** Test seam: drop cached provider instances (e.g. after mutating env in a test). */
export function _resetProviderCache(): void {
  cache.clear();
}
