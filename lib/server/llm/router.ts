import { MODEL_MAP } from "@/lib/models";
import { pick } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/**
 * Intent router — a verbatim, enablement-aware port of lib/content.ts route()
 * (docs/technical-design.md §3.2). Regex ordering is significant.
 */
export interface RouteResult {
  id: string;
  label: string;
  routeText: string;
  fallback: boolean;
}

const TIER_ORDER = ["flagship", "balanced", "fast"];

function firstEnabledByTier(enabled: Set<string>): string {
  for (const tier of TIER_ORDER) {
    for (const id of Object.keys(MODEL_MAP)) {
      if (MODEL_MAP[id].tier === tier && enabled.has(id)) return id;
    }
  }
  // last resort: any enabled, else gpt-55
  for (const id of enabled) return id;
  return "gpt-55";
}

export function route(prompt: string, lang: Lang, enabled: Set<string>): RouteResult {
  const s = (prompt || "").toLowerCase();
  const I = <T,>(o: Partial<Record<Lang, T>> & { en?: T; zh?: T }) => pick(lang, o);
  let id: string;
  let label: string;
  if (/code|代码|函数|程序|python|javascript|rust|bug|算法|排序|sql|并发/.test(s)) {
    id = "deepseek-pro";
    label = I({ zh: "代码", "zh-TW": "程式碼", en: "Code", ja: "コード" });
  } else if (/写|润色|文案|创作|story|poem|诗|邮件|email|小说|营销/.test(s)) {
    id = "claude-opus";
    label = I({ zh: "写作", "zh-TW": "寫作", en: "Writing", ja: "執筆" });
  } else if (/翻译|translate|多语|语言/.test(s)) {
    id = "qwen";
    label = I({ zh: "翻译", "zh-TW": "翻譯", en: "Translation", ja: "翻訳" });
  } else if (/总结|summary|摘要|快/.test(s)) {
    id = "deepseek-flash";
    label = I({ zh: "速答", "zh-TW": "速答", en: "Quick", ja: "即答" });
  } else if (/旅行|规划|计划|plan|行程|策略/.test(s)) {
    id = "gemini-pro";
    label = I({ zh: "规划", "zh-TW": "規劃", en: "Planning", ja: "計画" });
  } else {
    id = "gpt-55";
    label = I({ zh: "通用", "zh-TW": "通用", en: "General", ja: "汎用" });
  }

  let fallback = false;
  if (!enabled.has(id)) {
    id = firstEnabledByTier(enabled);
    fallback = true;
  }

  const name = MODEL_MAP[id]?.name ?? id;
  const routeText =
    pick(lang, {
      zh: "已识别意图：" + label + " · 自动路由至 ",
      "zh-TW": "已識別意圖：" + label + " · 自動路由至 ",
      en: "Intent: " + label + " · routed to ",
      ja: "意図を判定：" + label + " · 自動ルーティング → ",
    }) + name;

  return { id, label, routeText, fallback };
}
