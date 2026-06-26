import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { generateSuggestions } from "@/lib/server/llm/suggestions";
import type { Lang } from "@/lib/types";

const LANGS = ["zh", "zh-TW", "en", "ja"];

/**
 * GET /api/suggestions?lang=zh — 4 fresh empty-state example prompts. Real
 * accounts get cheap-model-generated suggestions (curated fallback on failure);
 * on LLM failure it falls back to a curated pool. Different
 * every call. Not billed and not part of the usage ledger.
 */
export const GET = route(
  "suggestions.get",
  async (ctx) => {
    requireUser(ctx); // auth gate
    const langParam = ctx.url.searchParams.get("lang") || "";
    const lang = (LANGS.includes(langParam) ? langParam : "zh") as Lang;
    const suggestions = await generateSuggestions(lang, ctx.req.signal);
    ctx.setMeta({ lang, count: suggestions.length });
    return { suggestions };
  },
  { auth: "required" },
);
