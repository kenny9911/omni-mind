import { describe, it, expect } from "vitest";
import { readSse } from "./helpers/harness";
import { sseResponse } from "@/lib/server/sse";
import { ApiError } from "@/lib/server/http";

/**
 * PO G24 — SSE error frames must not leak raw internal error detail. Only
 * deliberate, safe coded errors (ApiError, or an allow-listed code like
 * PROVIDER_ERROR) forward their developer-authored message; anything else is
 * collapsed to a generic "Internal error" and logged server-side.
 */
describe("sseResponse error sanitization (G24)", () => {
  it("collapses an unexpected throw to a generic INTERNAL frame (no leak)", async () => {
    const res = sseResponse("req-1", async () => {
      throw new Error("libsql: SELECT * FROM users — secret internal detail");
    });
    const events = await readSse(res);
    const err = events.find((e) => e.event === "error");
    expect(err).toBeTruthy();
    expect(err!.data.code).toBe("INTERNAL");
    expect(err!.data.message).toBe("Internal error");
    expect(err!.data.requestId).toBe("req-1");
    // the raw internal string must never reach the wire
    expect(JSON.stringify(events)).not.toContain("secret internal detail");
  });

  it("forwards an allow-listed coded error (PROVIDER_ERROR) verbatim", async () => {
    const res = sseResponse("req-2", async () => {
      throw Object.assign(new Error("Provider error"), { code: "PROVIDER_ERROR" });
    });
    const err = (await readSse(res)).find((e) => e.event === "error");
    expect(err!.data.code).toBe("PROVIDER_ERROR");
    expect(err!.data.message).toBe("Provider error");
  });

  it("forwards an ApiError's safe message", async () => {
    const res = sseResponse("req-3", async () => {
      throw new ApiError(409, "MODEL_DISABLED", "Main model is disabled");
    });
    const err = (await readSse(res)).find((e) => e.event === "error");
    expect(err!.data.code).toBe("MODEL_DISABLED");
    expect(err!.data.message).toBe("Main model is disabled");
  });

  it("does NOT forward a non-allow-listed coded driver error (e.g. SQLITE_*)", async () => {
    const res = sseResponse("req-4", async () => {
      throw Object.assign(new Error("SQLITE_ERROR: near \"FORM\": syntax error"), { code: "SQLITE_ERROR" });
    });
    const err = (await readSse(res)).find((e) => e.event === "error");
    expect(err!.data.code).toBe("INTERNAL");
    expect(err!.data.message).toBe("Internal error");
    expect(JSON.stringify(err!.data)).not.toContain("SQLITE");
  });
});
