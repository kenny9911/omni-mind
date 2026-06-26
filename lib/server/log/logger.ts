/* eslint-disable no-console */

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) || "info"];

/**
 * Strip secret-shaped substrings (provider API keys, bearer tokens) from a string
 * value. Defense-in-depth: some providers echo a partial key in auth errors, and
 * those error strings can reach both logs and the client-facing `answer.error`.
 */
export function redactSecrets(s: string): string {
  return s
    .replace(/\b(sk|rk|vck|xai|gsk)[-_][A-Za-z0-9._-]{6,}/g, "$1-[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, "AIza[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/("?(?:api[_-]?key|authorization|token|secret)"?\s*[:=]\s*"?)[A-Za-z0-9._-]{6,}/gi, "$1[REDACTED]");
}

// Exact (separator-insensitive) sensitive key names — matched precisely so that
// harmless fields like inputTokens/outputTokens are NOT redacted just for containing
// the substring "token". String VALUES are still scrubbed for secret shapes everywhere.
const SENSITIVE_KEYS = new Set([
  "apikey", "authorization", "password", "secret", "token", "accesstoken",
  "refreshtoken", "authtoken", "sessiontoken", "credential", "credentials",
  "bearer", "cookie", "privatekey",
]);
function isSensitiveKey(k: string): boolean {
  const n = k.toLowerCase().replace(/[^a-z]/g, "");
  return SENSITIVE_KEYS.has(n) || n.endsWith("apikey") || n.endsWith("secretkey");
}

/** Redact sensitive-named keys entirely and scrub secret-shaped strings everywhere. */
function sanitizeLogFields(v: unknown): unknown {
  if (typeof v === "string") return redactSecrets(v);
  if (Array.isArray(v)) return v.map(sanitizeLogFields);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = isSensitiveKey(k) ? "[REDACTED]" : sanitizeLogFields(val);
    }
    return out;
  }
  return v;
}

/**
 * Minimal structured JSON logger → stdout. Every line is one JSON object so logs
 * are queryable in Vercel/observability tooling. DB-backed activity/usage logging
 * lives in ./activity.ts; this is the line-log side. Fields are sanitized so a
 * stray secret in an error never lands in a queryable log.
 */
function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < MIN) return;
  const safe = fields ? (sanitizeLogFields(fields) as Record<string, unknown>) : undefined;
  const line = JSON.stringify({ t: Date.now(), level, msg, ...safe });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
