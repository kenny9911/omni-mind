import type { Emit } from "./llm/fusion";
import { ApiError } from "./http";
import { log } from "./log/logger";

/**
 * Error codes whose developer-authored messages are safe to forward to the
 * client over the SSE `error` frame. Anything else (unexpected throws, driver
 * errors that may carry SQL/internal detail) is collapsed to a generic message
 * and logged server-side instead (PO G24).
 */
const SAFE_SSE_CODES = new Set(["PROVIDER_ERROR", "ALL_EXPERTS_FAILED"]);

/**
 * Build a Server-Sent-Events Response from an async producer. Sends a heartbeat
 * comment every ~15s and aborts in-flight work on client disconnect (NFR-2, NFR-17).
 */
export function sseResponse(
  requestId: string,
  run: (emit: Emit, signal: AbortSignal) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const ac = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          /* stream already closed */
        }
      };
      const emit: Emit = (event, data) => {
        safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      heartbeat = setInterval(() => safeEnqueue(`: ping\n\n`), 15000);
      try {
        await run(emit, ac.signal);
      } catch (e) {
        const err = e as { code?: string; message?: string };
        const safe =
          e instanceof ApiError || (err?.code != null && SAFE_SSE_CODES.has(err.code));
        if (safe) {
          emit("error", { code: err.code || "INTERNAL", message: err.message || "Error", requestId });
        } else {
          // Unexpected throw — don't leak internal detail over the wire; log it.
          log.error("sse.unhandled", {
            requestId,
            error: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
          });
          emit("error", { code: "INTERNAL", message: "Internal error", requestId });
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* noop */
        }
      }
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      ac.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-request-id": requestId,
    },
  });
}
