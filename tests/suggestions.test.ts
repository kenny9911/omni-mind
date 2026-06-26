import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke } from "./helpers/harness";
import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as suggestionsGet } from "@/app/api/suggestions/route";

/**
 * GET /api/suggestions — fresh empty-state example prompts. In tests LLM_MODE=mock,
 * so every response comes from the randomized curated pool (no network).
 */
const ICONS = new Set(["code", "pen", "compare", "map", "spark", "search", "route", "globe", "agent", "coins"]);

describe("GET /api/suggestions", () => {
  let cookie: string;
  beforeAll(async () => {
    await setupTestDb();
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", { body: { name: "Sug", email: "sug@omnimind.dev", password: "supersecret" } }),
    );
    cookie = r.cookie!;
  });

  it("requires auth", async () => {
    const r = await invoke(suggestionsGet, req("GET", "/api/suggestions"));
    expect(r.status).toBe(401);
  });

  it("returns exactly 4 well-formed suggestions", async () => {
    const r = await invoke(suggestionsGet, req("GET", "/api/suggestions?lang=zh", { cookie }));
    expect(r.status).toBe(200);
    const s = r.body.data.suggestions;
    expect(Array.isArray(s)).toBe(true);
    expect(s).toHaveLength(4);
    for (const item of s) {
      expect(typeof item.text).toBe("string");
      expect(item.text.length).toBeGreaterThan(0);
      expect(ICONS.has(item.icon)).toBe(true);
      expect(item.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("varies across calls (not always the same four)", async () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const r = await invoke(suggestionsGet, req("GET", "/api/suggestions?lang=zh", { cookie }));
      firsts.add(r.body.data.suggestions.map((x: { text: string }) => x.text).join("|"));
    }
    // 12-item pool shuffled → 6 identical orderings is astronomically unlikely
    expect(firsts.size).toBeGreaterThan(1);
  });

  it("honors the requested language", async () => {
    const r = await invoke(suggestionsGet, req("GET", "/api/suggestions?lang=en", { cookie }));
    const joined = r.body.data.suggestions.map((x: { text: string }) => x.text).join(" ");
    // English curated entries are ASCII; should contain no CJK characters
    expect(/[一-鿿぀-ヿ]/.test(joined)).toBe(false);
  });
});
