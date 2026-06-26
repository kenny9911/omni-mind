import type { Lang } from "@/lib/types";
import { MODEL_MAP } from "@/lib/models";
import { pick } from "@/lib/i18n";
import { streamOne } from "./gateway";
import { route, type RouteResult } from "./router";
import { log } from "../log/logger";

/**
 * Intent understanding (context-engineering §6). A single cheap LLM call replaces the brittle
 * regex router: it classifies intent AND rewrites a (possibly terse) follow-up like "好"/"yes"
 * into a SELF-CONTAINED query using the conversation. The rewritten `standaloneQuery` is the
 * keystone — it threads into routing, memory retrieval, and answer context. On ANY failure this
 * degrades to the existing regex route(), so it can never make routing worse.
 */

export type Intent = "code" | "writing" | "translation" | "planning" | "general";
const VALID_INTENTS: Intent[] = ["code", "writing", "translation", "planning", "general"];

export interface IntentResult {
  intent: Intent;
  /** self-contained rewrite of the latest user message (resolves follow-ups), user's language */
  standaloneQuery: string;
  complexity: "simple" | "complex";
  confidence: number; // 0..1
  /** true when derived from the regex fallback rather than the LLM classifier */
  fallback: boolean;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** Cheap classifier model (override via INTENT_MODEL). */
const INTENT_MODEL = process.env.INTENT_MODEL || "deepseek-flash";
const intentDisabled = (): boolean => process.env.INTENT_DISABLED === "1";

/** intent → preferred model id (mirrors the regex router's keyword→model mapping). */
const INTENT_TO_MODEL: Record<Intent, string> = {
  code: "deepseek-pro",
  writing: "claude-opus",
  translation: "qwen",
  planning: "gemini-pro",
  general: "gpt-55",
};

/** Regex intent — the same keyword logic the legacy router used, returning the Intent class. */
export function regexIntent(prompt: string): Intent {
  const s = (prompt || "").toLowerCase();
  if (/code|代码|函数|程序|python|javascript|rust|bug|算法|排序|sql|并发/.test(s)) return "code";
  if (/写|润色|文案|创作|story|poem|诗|邮件|email|小说|营销/.test(s)) return "writing";
  if (/翻译|translate|多语|语言/.test(s)) return "translation";
  if (/旅行|规划|计划|plan|行程|策略/.test(s)) return "planning";
  return "general";
}

function buildIntentPrompt(prompt: string, history: HistoryTurn[]): string {
  const ctx = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 400)}`)
    .join("\n");
  return (
    "INTENT_CLASSIFY. You are an intent classifier + query rewriter for a multilingual AI chat (zh/zh-TW/en/ja). " +
    "Given the conversation so far and the user's LATEST message, return ONLY a compact JSON object with keys: " +
    '"intent" (one of "code","writing","translation","planning","general"); ' +
    '"standalone_query" (rewrite the latest message into a SELF-CONTAINED question needing no prior context — resolve ' +
    'pronouns/ellipsis/short replies like "好"/"yes"/"再详细点" using the conversation; KEEP the user\'s original language; ' +
    "if already self-contained, return it unchanged); " +
    '"complexity" ("simple" if one model suffices, "complex" if it benefits from multiple experts); "confidence" (0..1).\n\n' +
    (ctx ? `Conversation so far:\n${ctx}\n\n` : "") +
    `Latest user message:\n"""${prompt.slice(0, 1500)}"""\n\nJSON:`
  );
}

function parse(text: string): Partial<IntentResult> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const intent = VALID_INTENTS.includes(j.intent as Intent) ? (j.intent as Intent) : undefined;
    if (!intent) return null;
    return {
      intent,
      standaloneQuery: typeof j.standalone_query === "string" ? j.standalone_query : undefined,
      complexity: j.complexity === "complex" ? "complex" : "simple",
      confidence: typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Classify intent + rewrite a follow-up into a self-contained query. Best-effort; never throws;
 * degrades to the regex intent on any failure (so routing/retrieval are never worse than before).
 */
export async function classifyIntent(
  prompt: string,
  lang: Lang,
  history: HistoryTurn[] = [],
  signal?: AbortSignal,
): Promise<IntentResult> {
  const raw = (prompt || "").trim();
  const fallback = (): IntentResult => ({
    intent: regexIntent(raw),
    standaloneQuery: raw,
    complexity: "simple",
    confidence: 0,
    fallback: true,
  });
  if (intentDisabled() || raw.length === 0) return fallback();
  try {
    let text = "";
    const r = await streamOne({
      role: "intent",
      modelId: INTENT_MODEL,
      prompt: buildIntentPrompt(raw, history),
      lang,
      maxOutputTokens: 240,
      onDelta: (d) => {
        text += d;
      },
      signal,
    });
    if (r.status !== "ok") return fallback();
    const p = parse(r.text || text);
    if (!p?.intent) return fallback();
    return {
      intent: p.intent,
      standaloneQuery: p.standaloneQuery?.trim() || raw,
      complexity: p.complexity ?? "simple",
      confidence: p.confidence ?? 0.7,
      fallback: false,
    };
  } catch (e) {
    log.warn("intent.classify_failed", { error: e instanceof Error ? e.message : String(e) });
    return fallback();
  }
}

/** Minimum confidence to trust the LLM intent for routing (else use the regex router as net). */
const ROUTE_CONFIDENCE = 0.6;

/**
 * Resolve a fast-mode auto-route from an IntentResult — enablement-aware. Uses the intent's
 * preferred model when confident + enabled; otherwise delegates to the regex route() (the safety
 * net) on the standalone query. Returns a RouteResult shaped exactly like the legacy router.
 */
export function routeFromIntent(result: IntentResult, lang: Lang, enabled: Set<string>): RouteResult {
  const preferred = INTENT_TO_MODEL[result.intent];
  const confident = !result.fallback && result.confidence >= ROUTE_CONFIDENCE;
  if (confident && MODEL_MAP[preferred] && enabled.has(preferred)) {
    const label = intentLabel(result.intent, lang);
    const name = MODEL_MAP[preferred].name;
    const routeText =
      pick(lang, {
        zh: "已识别意图：" + label + " · 自动路由至 ",
        "zh-TW": "已識別意圖：" + label + " · 自動路由至 ",
        en: "Intent: " + label + " · routed to ",
        ja: "意図を判定：" + label + " · 自動ルーティング → ",
      }) + name;
    return { id: preferred, label, routeText, fallback: false };
  }
  // Not confident or preferred disabled → the proven regex router on the resolved query.
  return route(result.standaloneQuery, lang, enabled);
}

function intentLabel(intent: Intent, lang: Lang): string {
  const L = (o: Partial<Record<Lang, string>> & { en: string; zh: string }) => pick(lang, o);
  switch (intent) {
    case "code":
      return L({ zh: "代码", "zh-TW": "程式碼", en: "Code", ja: "コード" });
    case "writing":
      return L({ zh: "写作", "zh-TW": "寫作", en: "Writing", ja: "執筆" });
    case "translation":
      return L({ zh: "翻译", "zh-TW": "翻譯", en: "Translation", ja: "翻訳" });
    case "planning":
      return L({ zh: "规划", "zh-TW": "規劃", en: "Planning", ja: "計画" });
    default:
      return L({ zh: "通用", "zh-TW": "通用", en: "General", ja: "汎用" });
  }
}
