import type { Lang } from "@/lib/types";
import { streamOne } from "./gateway";

/**
 * Empty-state example prompts. Each request returns 4 FRESH, varied suggestions:
 * for real accounts a cheap model generates them (one per random domain); for the
 * on any failure, we fall back to a randomized pick from a curated pool. Either way
 * the four are different each time (never a fixed set).
 */
export interface Suggestion {
  text: string;
  icon: string;
  color: string;
}

/** Cheap, reliable non-reasoning model for this helper (override with SUGGESTIONS_MODEL).
 *  deepseek-flash returns clean JSON in a small token budget; reasoning models (e.g.
 *  gemini-2.5-flash) burn the cap on hidden thinking and get truncated. */
const SUGGESTIONS_MODEL = process.env.SUGGESTIONS_MODEL || "deepseek-flash";

const ICONS = ["code", "pen", "compare", "map", "spark", "search", "route", "globe", "agent", "coins"];
const COLORS = ["#4d6bfe", "#d97757", "#0e8f6e", "#9168ff", "#19c37d", "#2f7cff", "#ff4d6d", "#00bcd4"];

/** Domains the model is asked to draw from (4 random per call → diverse output). */
const DOMAINS = [
  "writing code",
  "debugging an error",
  "rewriting or polishing text",
  "translating between languages",
  "summarizing a long text",
  "data analysis or a SQL query",
  "comparing two options",
  "planning a trip",
  "explaining a concept simply",
  "brainstorming ideas",
  "drafting an email or message",
  "making a learning plan",
  "a math or logic problem",
  "a recipe or meal idea",
  "a workout or fitness plan",
  "personal finance or budgeting",
  "interview or career prep",
  "naming a product or project",
];

const LANG_NAME: Record<Lang, string> = {
  zh: "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  en: "English",
  ja: "Japanese",
};

/** Curated fallback pool (localized) — used on any LLM failure. */
const CURATED: { l: Record<Lang, string>; icon: string }[] = [
  { icon: "code", l: { zh: "用 Python 实现一个 LRU 缓存", "zh-TW": "用 Python 實作一個 LRU 快取", en: "Implement an LRU cache in Python", ja: "Python で LRU キャッシュを実装" } },
  { icon: "pen", l: { zh: "把这段话改写得更正式一些", "zh-TW": "把這段話改寫得更正式一些", en: "Rewrite this to sound more formal", ja: "この文章をより丁寧に書き直して" } },
  { icon: "compare", l: { zh: "比较 PostgreSQL 和 MongoDB", "zh-TW": "比較 PostgreSQL 與 MongoDB", en: "Compare PostgreSQL vs MongoDB", ja: "PostgreSQL と MongoDB を比較して" } },
  { icon: "map", l: { zh: "规划东京 3 天美食行程", "zh-TW": "規劃東京 3 天美食行程", en: "Plan a 3-day Tokyo food itinerary", ja: "東京 3 日間のグルメ旅程を計画" } },
  { icon: "spark", l: { zh: "用类比解释什么是闭包", "zh-TW": "用類比解釋什麼是閉包", en: "Explain closures with an analogy", ja: "クロージャを例えで説明して" } },
  { icon: "search", l: { zh: "把这篇文章总结成 5 个要点", "zh-TW": "把這篇文章總結成 5 個要點", en: "Summarize this article in 5 points", ja: "この記事を 5 つの要点にまとめて" } },
  { icon: "route", l: { zh: "写一句 SQL 找出重复的行", "zh-TW": "寫一句 SQL 找出重複的列", en: "Write SQL to find duplicate rows", ja: "重複行を見つける SQL を書いて" } },
  { icon: "globe", l: { zh: "帮我写一封请假邮件", "zh-TW": "幫我寫一封請假郵件", en: "Draft a time-off request email", ja: "休暇申請のメールを書いて" } },
  { icon: "agent", l: { zh: "给我的播客起 10 个名字", "zh-TW": "給我的 Podcast 取 10 個名字", en: "Brainstorm 10 names for my podcast", ja: "ポッドキャストの名前を 10 個考えて" } },
  { icon: "coins", l: { zh: "制定一个月的吉他练习计划", "zh-TW": "制定一個月的吉他練習計畫", en: "Make a 1-month guitar practice plan", ja: "1 か月のギター練習計画を作って" } },
  { icon: "code", l: { zh: "为什么我的 React 组件不重渲染", "zh-TW": "為什麼我的 React 元件不重新渲染", en: "Why won't my React component re-render?", ja: "React コンポーネントが再描画されない理由" } },
  { icon: "pen", l: { zh: "帮我润色简历的项目经历", "zh-TW": "幫我潤色履歷的專案經歷", en: "Polish the projects section of my resume", ja: "履歴書のプロジェクト欄を磨いて" } },
];

/** Fisher–Yates shuffle (server-side; Math.random is fine here). */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function decorate(texts: string[]): Suggestion[] {
  const off = Math.floor(Math.random() * ICONS.length);
  return texts.slice(0, 4).map((text, i) => ({
    text,
    icon: ICONS[(i + off) % ICONS.length],
    color: COLORS[(i + off) % COLORS.length],
  }));
}

function curatedFallback(lang: Lang): Suggestion[] {
  const picks = shuffle(CURATED).slice(0, 4);
  const off = Math.floor(Math.random() * COLORS.length);
  return picks.map((c, i) => ({ text: c.l[lang], icon: c.icon, color: COLORS[(i + off) % COLORS.length] }));
}

/** Pull a JSON string array out of an LLM response (tolerant of stray prose/markdown). */
function parseStrings(s: string): string[] | null {
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    if (Array.isArray(v)) {
      const out = v.map((x) => String(x).trim().replace(/^["'\d.)\s-]+/, "")).filter((x) => x.length > 0 && x.length <= 60);
      return out.length ? out : null;
    }
  } catch {
    /* not parseable */
  }
  return null;
}

async function viaLLM(lang: Lang, signal?: AbortSignal): Promise<Suggestion[] | null> {
  const picks = shuffle(DOMAINS).slice(0, 4);
  const prompt =
    `Suggest example prompts for a general AI assistant's home screen. Write exactly 4 short, concrete, natural requests a real user might type — one for EACH of these topics: ${picks.join("; ")}.\n` +
    `Each must be written in ${LANG_NAME[lang]}, under 40 characters, specific and genuinely useful (not meta, no surrounding quotes, no numbering).\n` +
    `Return ONLY a compact JSON array of 4 strings.`;
  let text = "";
  const r = await streamOne({
    role: "single",
    modelId: SUGGESTIONS_MODEL,
    prompt,
    lang,
    maxOutputTokens: 400,
    onDelta: (d) => {
      text += d;
    },
    signal,
  });
  if (r.status !== "ok") return null;
  const arr = parseStrings(r.text || text);
  if (!arr || arr.length < 4) return null;
  return decorate(arr);
}

/**
 * Generate 4 fresh example prompts. Real accounts → cheap LLM (with curated
 * fallback on failure). Always returns 4.
 */
export async function generateSuggestions(lang: Lang, signal?: AbortSignal): Promise<Suggestion[]> {
  try {
    const v = await viaLLM(lang, signal);
    if (v) return v;
  } catch {
    /* fall back to curated */
  }
  return curatedFallback(lang);
}
