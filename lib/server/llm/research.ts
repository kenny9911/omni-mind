import type { Lang } from "@/lib/types";
import { log, redactSecrets } from "../log/logger";

/**
 * Real web research for Deep Research mode.
 *
 * Calls OpenRouter's web plugin (Exa-backed) directly — it returns actual web
 * results as `url_citation` annotations — so Deep Research retrieves REAL pages
 * with REAL sources instead of a decorative label. Requires OPENROUTER_API_KEY;
 * degrades to null (no sources) when unavailable.
 */

export interface ResearchSource {
  title: string;
  url: string;
}
export interface ResearchResult {
  sources: ResearchSource[];
  notes: string; // grounded summary to inject into the answer prompt
  inputTokens: number;
  outputTokens: number;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Cheap web-capable model for the retrieval pass (override via RESEARCH_MODEL). */
const RESEARCH_MODEL = process.env.RESEARCH_MODEL || "deepseek/deepseek-v4-flash";
const MAX_RESULTS = 8;

const LANG_NAME: Record<Lang, string> = {
  zh: "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  en: "English",
  ja: "Japanese",
};

/** True when real web research can run (OpenRouter key present). */
export function researchConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

interface Annotation {
  type?: string;
  url_citation?: { url?: string; title?: string };
}

/** Run a real web search; returns sources + grounded notes, or null on any failure. */
export async function webSearch(query: string, lang: Lang, signal?: AbortSignal): Promise<ResearchResult | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model: RESEARCH_MODEL,
        plugins: [{ id: "web", max_results: MAX_RESULTS }],
        messages: [
          {
            role: "user",
            content: `Research this request using current web sources and summarize the key facts concisely in ${LANG_NAME[lang]} (a few sentences). Request: ${query}`,
          },
        ],
      }),
    });
    if (!res.ok) {
      log.warn("research.http_error", { status: res.status });
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: unknown; annotations?: Annotation[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = data?.choices?.[0]?.message ?? {};
    const annotations = Array.isArray(msg.annotations) ? msg.annotations : [];
    const seen = new Set<string>();
    const sources: ResearchSource[] = [];
    for (const a of annotations) {
      const c = a?.type === "url_citation" ? a.url_citation : undefined;
      const url = c?.url?.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ url, title: (c?.title || url).slice(0, 140) });
      if (sources.length >= MAX_RESULTS) break;
    }
    const notes = typeof msg.content === "string" ? msg.content.slice(0, 2000) : "";
    const usage = data?.usage ?? {};
    return {
      sources,
      notes,
      inputTokens: Number(usage.prompt_tokens) || 0,
      outputTokens: Number(usage.completion_tokens) || 0,
    };
  } catch (e) {
    log.warn("research.failed", { error: redactSecrets(e instanceof Error ? e.message : String(e)) });
    return null;
  }
}

/** Format research findings as a compact prompt preamble (cite by [n]), or undefined. */
export function formatResearchForPrompt(r: ResearchResult | null): string | undefined {
  if (!r || !r.sources.length) return undefined;
  const list = r.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n");
  return (
    "Web research findings (ground your answer in these and cite as [n] when used):\n" +
    list +
    (r.notes ? `\n\nKey findings:\n${r.notes}` : "")
  );
}
