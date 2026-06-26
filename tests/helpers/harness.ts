import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetDbForTests, getDb } from "@/lib/server/db/client";

/**
 * Test harness: each test file gets an isolated temp libSQL DB (auto-migrated),
 * a Request builder, and a route-handler invoker. Handler-agnostic — import the
 * real route handlers in the test and pass them to invoke().
 */

// Accepts any Next route-handler shape (route() handlers + dynamic [id] handlers).
export type RouteHandler = (req: Request, ctx?: any) => Promise<Response>;

const BASE = "http://localhost";

/** Point the process-global DB at a fresh temp file and migrate it. */
export async function setupTestDb(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "omni-test-"));
  process.env.DATABASE_URL = "file:" + join(dir, "test.db");
  // A configured provider so llmConfigured() is true (streamOne is stubbed in setup.ts).
  process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
  __resetDbForTests();
  await getDb(); // triggers ensureSchema
}

export interface ReqInit {
  body?: unknown;
  cookie?: string | null;
  headers?: Record<string, string>;
}

export function req(method: string, path: string, init: ReqInit = {}): Request {
  const headers: Record<string, string> = { ...(init.headers || {}) };
  if (init.cookie) headers["cookie"] = init.cookie;
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  return new Request(BASE + path, { method, headers, body });
}

export interface InvokeResult<T = any> {
  status: number;
  ok: boolean;
  body: { ok: boolean; data: T; error: { code: string; message: string; details?: unknown } };
  setCookie: string | null;
  cookie: string | null; // just the omni_session=<value> pair, for chaining
  requestId: string | null;
  res: Response;
}

export async function invoke<T = any>(
  handler: RouteHandler,
  request: Request,
  params?: Record<string, string>,
): Promise<InvokeResult<T>> {
  const res = await handler(request, params ? { params } : undefined);
  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? sessionPair(setCookie) : null;
  let body: any = {};
  const text = await res.clone().text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { ok: res.ok, data: text };
    }
  }
  return {
    status: res.status,
    ok: res.ok,
    body,
    setCookie,
    cookie,
    requestId: res.headers.get("x-request-id"),
    res,
  };
}

function sessionPair(setCookie: string): string | null {
  const first = setCookie.split(";")[0];
  return first.startsWith("omni_session=") ? first : null;
}

/** Read an SSE Response into the list of {event, data} messages. */
export async function readSse(res: Response): Promise<{ event: string; data: any }[]> {
  const text = await res.text();
  const events: { event: string; data: any }[] = [];
  for (const block of text.split("\n\n")) {
    const lines = block.split("\n");
    let event = "";
    let dataRaw = "";
    for (const line of lines) {
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
      events.push({ event, data });
    }
  }
  return events;
}

/** Convenience: collect just the concatenated delta text for a given SSE event. */
export function concatDeltas(events: { event: string; data: any }[], event: string): string {
  return events.filter((e) => e.event === event).map((e) => e.data?.delta ?? "").join("");
}
