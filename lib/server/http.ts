import { randomUUID } from "node:crypto";
import { ZodError, type ZodType } from "zod";
import { getDb, type DB } from "./db/client";
import { resolveSession } from "./auth/session";
import { writeActivity } from "./log/activity";
import { log } from "./log/logger";
import type { User } from "./db/schema";

/** Thrown anywhere; mapped to the error envelope + HTTP status by route(). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message || code);
    this.name = "ApiError";
  }
}

export type AuthMode = "public" | "required" | "admin";

export interface RouteCtx {
  req: Request;
  requestId: string;
  db: DB;
  user: User | null;
  params: Record<string, string>;
  url: URL;
  now: number;
  /** Enrich the activity_logs.meta for this request. */
  setMeta: (m: Record<string, unknown>) => void;
}

type Handler = (ctx: RouteCtx) => Promise<Response | unknown>;
type NextCtx = { params?: Promise<Record<string, string>> | Record<string, string> };

/** Build the success envelope. `init.headers` may include Set-Cookie. */
export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
}

function errorResponse(e: ApiError): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: e.code, message: e.message, details: e.details },
    }),
    { status: e.status, headers: { "content-type": "application/json" } },
  );
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof ZodError) {
    return new ApiError(400, "VALIDATION_ERROR", "Invalid request", e.flatten());
  }
  log.error("unhandled_error", { err: String(e), stack: (e as Error)?.stack });
  return new ApiError(500, "INTERNAL", "Internal error");
}

function withRequestId(res: Response, requestId: string): Response {
  const headers = new Headers(res.headers);
  headers.set("x-request-id", requestId);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Wraps a Route Handler: request-id, auth guard, timing, error→envelope mapping,
 * and exactly one activity_logs row per served request (incl. 4xx/5xx).
 */
export function route(action: string, handler: Handler, opts: { auth?: AuthMode } = {}) {
  return async (req: Request, nextCtx?: NextCtx): Promise<Response> => {
    const requestId = randomUUID();
    const start = performance.now();
    const url = new URL(req.url);
    const { db } = await getDb();
    let status = 200;
    let userId: string | null = null;
    const meta: Record<string, unknown> = {};
    const setMeta = (m: Record<string, unknown>) => Object.assign(meta, m);
    let response: Response;
    try {
      const params = nextCtx?.params ? await nextCtx.params : {};
      const user = await resolveSession(db, req);
      if ((opts.auth === "required" || opts.auth === "admin") && !user) {
        throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
      }
      if (opts.auth === "admin" && user?.role !== "admin") {
        throw new ApiError(403, "FORBIDDEN", "Admin only");
      }
      userId = user?.id ?? null;
      const ctx: RouteCtx = {
        req,
        requestId,
        db,
        user,
        params,
        url,
        now: Date.now(),
        setMeta,
      };
      const out = await handler(ctx);
      response = out instanceof Response ? out : json(out);
      status = response.status;
    } catch (e) {
      const ae = toApiError(e);
      status = ae.status;
      meta.code = ae.code;
      response = errorResponse(ae);
    }
    const latencyMs = Math.round(performance.now() - start);
    await writeActivity(db, {
      requestId,
      userId,
      action,
      route: url.pathname,
      method: req.method,
      status,
      latencyMs,
      meta: Object.keys(meta).length ? meta : null,
    });
    return withRequestId(response, requestId);
  };
}

/** Parse + validate a JSON body, throwing VALIDATION_ERROR on failure. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, "VALIDATION_ERROR", "Invalid request", r.error.flatten());
  return r.data;
}

/** Parse + validate the query string. */
export function parseQuery<T>(url: URL, schema: ZodType<T>): T {
  const obj = Object.fromEntries(url.searchParams.entries());
  const r = schema.safeParse(obj);
  if (!r.success) throw new ApiError(400, "VALIDATION_ERROR", "Invalid query", r.error.flatten());
  return r.data;
}
