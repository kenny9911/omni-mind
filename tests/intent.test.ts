import { describe, it, expect, afterEach } from "vitest";
import { classifyIntent, routeFromIntent, regexIntent } from "@/lib/server/llm/intent";
import { MODEL_MAP } from "@/lib/models";

// classifyIntent calls streamOne, which tests/setup.ts stubs; the stub returns deterministic
// intent JSON for INTENT_CLASSIFY prompts, so we exercise the real parse + route path.
const ENABLED = new Set(Object.keys(MODEL_MAP));

afterEach(() => {
  delete process.env.INTENT_DISABLED;
});

describe("Intent classification + routing (context-engineering §6)", () => {
  it("classifies a code prompt and returns a self-contained query (non-fallback)", async () => {
    const r = await classifyIntent("用 Python 写一个快速排序并解释复杂度", "zh", []);
    expect(r.fallback).toBe(false);
    expect(r.intent).toBe("code");
    expect(r.standaloneQuery.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("routes a code intent to the code model when enabled + confident", async () => {
    const r = await classifyIntent("fix this python bug in my sort function", "en", []);
    const route = routeFromIntent(r, "en", ENABLED);
    expect(route.id).toBe("deepseek-pro");
    expect(route.fallback).toBe(false);
    expect(route.routeText).toContain("deepseek-pro" in MODEL_MAP ? MODEL_MAP["deepseek-pro"].name : "");
  });

  it("falls back to the regex router when the intent's preferred model is disabled", async () => {
    const r = await classifyIntent("write a marketing poem", "en", []);
    expect(r.intent).toBe("writing"); // would prefer claude-opus
    const noClaude = new Set([...ENABLED].filter((id) => id !== "claude-opus"));
    const route = routeFromIntent(r, "en", noClaude);
    expect(route.id).not.toBe("claude-opus"); // net picks an enabled model instead
    expect(noClaude.has(route.id)).toBe(true);
  });

  it("INTENT_DISABLED=1 → regex fallback (intent from keywords, standaloneQuery = raw prompt)", async () => {
    process.env.INTENT_DISABLED = "1";
    const r = await classifyIntent("translate this paragraph to japanese", "en", []);
    expect(r.fallback).toBe(true);
    expect(r.intent).toBe("translation");
    expect(r.standaloneQuery).toBe("translate this paragraph to japanese");
    expect(r.confidence).toBe(0);
  });

  it("regexIntent maps keywords to intent classes", () => {
    expect(regexIntent("write a sql query")).toBe("code");
    expect(regexIntent("帮我写一封邮件")).toBe("writing");
    expect(regexIntent("plan my trip to Kyoto")).toBe("planning");
    expect(regexIntent("translate hello")).toBe("translation");
    expect(regexIntent("how are you")).toBe("general");
  });
});
