import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveCandidates,
  hasDirectProvider,
  directKeyPresent,
  _resetProviderCache,
} from "@/lib/server/llm/providers";
import { llmConfigured } from "@/lib/server/llm/gateway";
import { gatewaySlug } from "@/lib/server/llm/registry";
import { redactSecrets } from "@/lib/server/log/logger";

/**
 * Option A — layered provider resolution. resolveCandidates(id) returns an
 * ORDERED list: dedicated provider instance (if keyed) → OpenRouter instance (if
 * keyed) → the bare gateway slug string. No network calls (instances are lazy).
 */
const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "KIMI_API_KEY",
  "GLM_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "LLM_FORCE_GATEWAY",
];

const isStr = (v: unknown) => typeof v === "string";
const isInstance = (v: unknown) => v !== null && typeof v === "object";

describe("layered provider resolution (Option A)", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    _resetProviderCache();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    _resetProviderCache();
  });

  it("with no keys, the only candidate is the gateway slug string", async () => {
    expect(hasDirectProvider("gpt-55")).toBe(false);
    const c = await resolveCandidates("gpt-55");
    expect(c).toHaveLength(1);
    expect(c[0].label).toBe("gateway");
    expect(c[0].model).toBe(gatewaySlug("gpt-55")); // "openai/gpt-5"
  });

  it("dedicated key → [dedicated instance, gateway slug]", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    expect(hasDirectProvider("gpt-55")).toBe(true);
    const c = await resolveCandidates("gpt-55");
    expect(c.map((x) => x.label)).toEqual(["dedicated:openai", "gateway"]);
    expect(isInstance(c[0].model)).toBe(true); // dedicated OpenAI instance
    expect(c[1].model).toBe(gatewaySlug("gpt-55")); // gateway slug last
  });

  it("OpenRouter key → [openrouter instance, gateway slug] for any mapped model", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const c = await resolveCandidates("minimax"); // no dedicated provider for minimax
    expect(c.map((x) => x.label)).toEqual(["openrouter", "gateway"]);
    expect(isInstance(c[0].model)).toBe(true); // OpenRouter instance
    expect(c[1].model).toBe(gatewaySlug("minimax"));
  });

  it("dedicated + OpenRouter → [dedicated, openrouter, gateway] in priority order", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const c = await resolveCandidates("gpt-55");
    expect(c.map((x) => x.label)).toEqual(["dedicated:openai", "openrouter", "gateway"]);
    expect(c[2].model).toBe(gatewaySlug("gpt-55"));
  });

  it("each model resolves to its own provider's key independently", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    // claude-opus goes direct; gpt-55 (no OPENAI key, no OpenRouter) only has the gateway slug
    expect((await resolveCandidates("claude-opus"))[0].label).toMatch(/^dedicated:/);
    const gpt = await resolveCandidates("gpt-55");
    expect(gpt).toHaveLength(1);
    expect(isStr(gpt[0].model)).toBe(true);
  });

  it("LLM_FORCE_GATEWAY=1 collapses to the gateway slug only", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.LLM_FORCE_GATEWAY = "1";
    expect(hasDirectProvider("gpt-55")).toBe(false);
    expect(directKeyPresent()).toBe(false);
    const c = await resolveCandidates("gpt-55");
    expect(c).toHaveLength(1);
    expect(c[0].model).toBe(gatewaySlug("gpt-55"));
  });

  it("treats an empty-string key as absent", async () => {
    process.env.OPENAI_API_KEY = "";
    expect(hasDirectProvider("gpt-55")).toBe(false);
    expect((await resolveCandidates("gpt-55"))).toHaveLength(1);
  });

  it("llmConfigured() is true when only OpenRouter is set (no gateway key)", () => {
    expect(llmConfigured()).toBe(false);
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(directKeyPresent()).toBe(true);
    expect(llmConfigured()).toBe(true);
  });
});

describe("secret redaction (defense-in-depth)", () => {
  it("scrubs provider keys and bearer tokens from error-shaped strings", () => {
    expect(redactSecrets("Incorrect API key provided: sk-proj-AbCd1234EfGh"))
      .not.toContain("AbCd1234EfGh");
    expect(redactSecrets("auth failed: Bearer vck_3a9Jloi7rKlPOkXGt8")).not.toContain("vck_3a9");
    expect(redactSecrets("key=AIzaSyD-1234567890abcdefABCDEF1234")).not.toContain("AIzaSyD-1234567890");
    // ordinary messages pass through unchanged
    expect(redactSecrets("model is rate-limited (429)")).toBe("model is rate-limited (429)");
  });
});
