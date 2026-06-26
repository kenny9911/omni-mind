/**
 * Typed browser client for the OmniMind backend. Every method maps to a documented
 * endpoint (docs/technical-design.md §2). Cookies (session) are sent automatically.
 *
 * Streaming chat is consumed via `streamChat`, an async generator of SSE events that
 * the React store can map directly onto its ViewModel fields.
 */
import type { Lang, Mode, Theme } from "@/lib/types";

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const env = (await res.json().catch(() => ({ ok: false, error: { code: "INTERNAL", message: "Bad response" } }))) as Envelope<T>;
  if (!res.ok || !env.ok) {
    const e = env.error || { code: "INTERNAL", message: res.statusText };
    throw new ApiClientError(res.status, e.code, e.message, e.details);
  }
  return env.data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
};

// ---------- types (mirror the DTOs) ----------
export interface SessionUser { id: string; name: string; email: string; role?: string }
export interface PreferencesDTO {
  theme: Theme; lang: Lang; mode: Mode; auto: boolean; mainModel: string; trio: string[];
  deepResearch: boolean; deepAgents: boolean; platformFeePerCallMicro: number; platformFeeDisplayMicro: number;
}
export interface SseEvent { event: string; data: any }

export interface ChatRequest {
  conversationId?: string;
  mode?: Mode;
  prompt: string;
  auto?: boolean;
  mainModel?: string;
  trio?: string[];
  deepResearch?: boolean;
  deepAgents?: boolean;
  regenerateTurnId?: string;
}

// ---------- auth ----------
export const auth = {
  signup: (b: { name: string; email: string; password: string; lang?: Lang }) =>
    request<{ user: SessionUser; plan: string; preferences: PreferencesDTO }>("POST", "/api/auth/signup", b),
  login: (b: { email: string; password: string; remember?: boolean }) =>
    request<{ user: SessionUser; plan: string }>("POST", "/api/auth/login", b),
  logout: () => request<{ loggedOut: boolean }>("POST", "/api/auth/logout", {}),
  session: () => request<{ user: SessionUser; plan: string; preferences: PreferencesDTO }>("GET", "/api/auth/session"),
  sso: (provider: "google" | "github" | "wechat" | "apple") =>
    request<{ user: SessionUser; plan: string; sso: { provider: string; stub: boolean } }>("POST", "/api/auth/sso", { provider }),
  /** Which third-party sign-in providers are configured (e.g. { google: true, ... }). */
  providers: () => request<{ providers: Record<string, boolean> }>("GET", "/api/auth/providers"),
  /** Full-page redirect target that begins the Google OAuth flow (not a fetch). */
  googleStartUrl: "/api/auth/google",
};

// ---------- chat (streaming) ----------
export async function* streamChat(body: ChatRequest, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
    const env = (await res.json()) as Envelope<never>;
    const e = env.error || { code: "INTERNAL", message: res.statusText };
    throw new ApiClientError(res.status, e.code, e.message, e.details);
  }
  yield* parseSse(res, signal);
}

export async function* streamRegenerate(body: { conversationId: string; turnId: string }, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const res = await fetch("/api/chat/regenerate", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  yield* parseSse(res, signal);
}

async function* parseSse(res: Response, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "";
      let dataRaw = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataRaw += line.slice(5).trim();
      }
      if (event) {
        let data: any = null;
        try {
          data = dataRaw ? JSON.parse(dataRaw) : null;
        } catch {
          data = dataRaw;
        }
        yield { event, data };
      }
    }
  }
}

export const chat = {
  route: (b: { prompt: string; lang?: Lang }) =>
    request<{ modelId: string; label: string; routeText: string; fallback: boolean }>("POST", "/api/chat/route", b),
  activityPing: (b: { action: "chat.copy" | "result.copy"; turnId?: string; meta?: Record<string, unknown> }) =>
    request<{ logged: boolean }>("POST", "/api/activity", b),
};

// ---------- models ----------
export const models = {
  list: (lang?: Lang) => request<{ models: any[]; openRouter: string[] }>("GET", "/api/models" + qs({ lang })),
  openRouter: (lang?: Lang) => request<{ models: any[] }>("GET", "/api/models" + qs({ lang, gateway: "openrouter" })),
  setEnabled: (id: string, enabled: boolean) => request<{ model: any; trio?: string[] }>("PATCH", `/api/models/${id}`, { enabled }),
  setMain: (id: string) => request<{ model: any; mainModel: string }>("PATCH", `/api/models/${id}`, { setMain: true }),
};

// ---------- usage ----------
export const usage = {
  summary: (window: "7d" | "30d" | "all" = "7d") => request<any>("GET", "/api/usage/summary" + qs({ window })),
  trend: (days = 7) => request<any>("GET", "/api/usage/trend" + qs({ days })),
  byModel: (window = "7d", limit = 6) => request<any>("GET", "/api/usage/by-model" + qs({ window, limit })),
  ledger: (limit = 12, cursor?: number) => request<any>("GET", "/api/usage/ledger" + qs({ limit, cursor })),
  exportUrl: (format: "csv" | "json", window = "7d") => "/api/usage/export" + qs({ format, window }),
};

// ---------- billing ----------
export const billing = {
  subscription: () => request<any>("GET", "/api/billing/subscription"),
  changePlan: (planId: "free" | "pro" | "team" | "ent") => request<any>("POST", "/api/billing/subscription", { planId }),
  plans: (lang?: Lang) => request<any>("GET", "/api/billing/plans" + qs({ lang })),
  invoices: () => request<any>("GET", "/api/billing/invoices"),
  invoice: (id: string) => request<any>("GET", `/api/billing/invoices/${id}`),
  topup: (amountMicro: number) => request<any>("POST", "/api/billing/topup", { amountMicro }),
  paymentMethod: () => request<any>("GET", "/api/billing/payment-method"),
  setPaymentMethod: (b: { brand: string; last4: string; expMonth: number; expYear: number }) =>
    request<any>("PUT", "/api/billing/payment-method", b),
};

// ---------- conversations ----------
export const conversations = {
  create: (title?: string) => request<any>("POST", "/api/conversations", { title }),
  list: (limit = 20, cursor?: number) => request<any>("GET", "/api/conversations" + qs({ limit, cursor })),
  rename: (id: string, title: string) => request<any>("PATCH", `/api/conversations/${id}`, { title }),
  remove: (id: string) => request<any>("DELETE", `/api/conversations/${id}`),
  messages: (id: string) => request<any>("GET", `/api/conversations/${id}/messages`),
};

// ---------- preferences ----------
export const preferences = {
  get: () => request<PreferencesDTO>("GET", "/api/preferences"),
  patch: (p: Partial<PreferencesDTO>) => request<PreferencesDTO>("PATCH", "/api/preferences", p),
};

// ---------- empty-state suggestions ----------
export const suggestions = {
  get: (lang?: Lang) =>
    request<{ suggestions: { text: string; icon: string; color: string }[] }>("GET", "/api/suggestions" + qs({ lang })),
};

// ---------- compact context memory ----------
export const memory = {
  get: () => request<{ facts: string[]; updatedAt: number }>("GET", "/api/memory"),
  clear: () => request<{ cleared: boolean }>("DELETE", "/api/memory"),
};

// ---------- activity / admin ----------
export const activity = {
  query: (params: { from?: number; to?: number; action?: string; status?: number; limit?: number; cursor?: number } = {}) =>
    request<any>("GET", "/api/activity" + qs(params)),
  exportUrl: (type: "activity" | "usage", format: "csv" | "json") => "/api/activity/export" + qs({ type, format }),
};

export const profile = {
  get: () => request<any>("GET", "/api/profile"),
  update: (b: { name?: string; currentPassword?: string; newPassword?: string }) =>
    request<any>("PATCH", "/api/profile", b),
};

export const admin = {
  metrics: (window: "1h" | "24h" | "7d" | "30d" = "24h") => request<any>("GET", "/api/admin/metrics" + qs({ window })),
  users: () => request<any>("GET", "/api/admin/users"),
  createUser: (b: { name: string; email: string; password: string; role?: "user" | "admin"; planId?: "free" | "pro" | "team" | "ent" }) =>
    request<any>("POST", "/api/admin/users", b),
  updateUser: (
    id: string,
    b: { name?: string; role?: "user" | "admin"; planId?: "free" | "pro" | "team" | "ent"; status?: "active" | "suspended"; newPassword?: string },
  ) => request<any>("PATCH", `/api/admin/users/${id}`, b),
  deleteUser: (id: string) => request<any>("DELETE", `/api/admin/users/${id}`),
};

export const api = { auth, chat, streamChat, streamRegenerate, models, usage, billing, conversations, preferences, suggestions, memory, activity, admin, profile };
export default api;
