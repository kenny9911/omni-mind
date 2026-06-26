import { vi } from "vitest";

// The production app has NO mock engine — every model call hits a real provider.
// In tests we stub `streamOne` (the single network seam) so the suite is keyless,
// fast, and deterministic. All other gateway exports (llmConfigured, etc.) stay real
// so the 503 / availability paths behave exactly as in production.
vi.mock("@/lib/server/llm/gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/llm/gateway")>();
  const { streamOneStub } = await import("./helpers/llm-stub");
  return { ...actual, streamOne: streamOneStub };
});

// A configured gateway key so llmConfigured() is true (the stub never uses it).
// Individual tests delete it to exercise the GATEWAY_NOT_CONFIGURED path.
process.env.AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY || "test-gateway-key";
process.env.PLATFORM_FEE_CNY = process.env.PLATFORM_FEE_CNY || "0.05";
process.env.APP_SECRET = process.env.APP_SECRET || "test-secret";
