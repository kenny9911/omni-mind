/** Small server-side helpers shared across handlers. */

const ACCENTS = ["#4d6bfe", "#9168ff", "#d97757", "#0e8f6e", "#2f7cff", "#ff4d6d", "#00bcd4", "#8a7bff"];

/** Deterministic accent color for a conversation/recent dot, derived from its id. */
export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

export function truncate(s: string, n: number): string {
  const t = (s || "").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

/** [start, end) epoch-ms for the current calendar month (UTC-naive, local). */
export function currentMonthRange(now = Date.now()): { start: number; end: number } {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
  return { start, end };
}

/** Window → [from, to) epoch-ms. */
export function windowRange(window: "7d" | "30d" | "all", now = Date.now()): { from: number; to: number } {
  const to = now;
  if (window === "all") return { from: 0, to };
  const days = window === "7d" ? 7 : 30;
  return { from: to - days * 86400000, to };
}
