import { describe, it, expect, afterEach, vi } from "vitest";
import { webSearch, formatResearchForPrompt, researchConfigured } from "@/lib/server/llm/research";

const OR = "OPENROUTER_API_KEY";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env[OR];
});

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response),
  );
}

describe("formatResearchForPrompt (pure)", () => {
  it("returns undefined with no sources", () => {
    expect(formatResearchForPrompt(null)).toBeUndefined();
    expect(formatResearchForPrompt({ sources: [], notes: "", inputTokens: 0, outputTokens: 0 })).toBeUndefined();
  });
  it("formats sources as numbered citations + notes", () => {
    const p = formatResearchForPrompt({
      sources: [{ title: "Vercel AI Gateway", url: "https://vercel.com/x" }],
      notes: "It has zero markup.",
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(p).toContain("[1] Vercel AI Gateway — https://vercel.com/x");
    expect(p).toContain("It has zero markup.");
  });
});

describe("researchConfigured", () => {
  it("reflects OPENROUTER_API_KEY presence", () => {
    delete process.env[OR];
    expect(researchConfigured()).toBe(false);
    process.env[OR] = "sk-or-x";
    expect(researchConfigured()).toBe(true);
  });
});

describe("webSearch", () => {
  it("returns null when no OpenRouter key", async () => {
    delete process.env[OR];
    expect(await webSearch("q", "en")).toBeNull();
  });

  it("parses url_citation annotations into deduped sources", async () => {
    process.env[OR] = "sk-or-x";
    mockFetch({
      choices: [
        {
          message: {
            content: "Summary text.",
            annotations: [
              { type: "url_citation", url_citation: { url: "https://a.com/1", title: "A One" } },
              { type: "url_citation", url_citation: { url: "https://a.com/1", title: "A One dup" } }, // dup url
              { type: "url_citation", url_citation: { url: "https://b.com/2", title: "B Two" } },
              { type: "other", foo: 1 },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 40 },
    });
    const r = await webSearch("latest news", "en");
    expect(r).not.toBeNull();
    expect(r!.sources.map((s) => s.url)).toEqual(["https://a.com/1", "https://b.com/2"]); // deduped
    expect(r!.sources[0].title).toBe("A One");
    expect(r!.notes).toBe("Summary text.");
    expect(r!.inputTokens).toBe(100);
    expect(r!.outputTokens).toBe(40);
  });

  it("returns null on a non-ok response", async () => {
    process.env[OR] = "sk-or-x";
    mockFetch({}, false, 429);
    expect(await webSearch("q", "en")).toBeNull();
  });

  it("returns empty sources when there are no annotations", async () => {
    process.env[OR] = "sk-or-x";
    mockFetch({ choices: [{ message: { content: "no web" } }], usage: {} });
    const r = await webSearch("q", "en");
    expect(r!.sources).toEqual([]);
  });
});
