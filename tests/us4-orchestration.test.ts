import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as routePreview } from "@/app/api/chat/route/route";
import { POST as chat } from "@/app/api/chat/route";
import { GET as getPrefs, PATCH as patchPrefs } from "@/app/api/preferences/route";
import { PATCH as patchOrchestration } from "@/app/api/orchestration/route";
import { PATCH as patchModel } from "@/app/api/models/[id]/route";

/**
 * US4 — Intent routing & orchestration.
 *   UC1  POST /api/chat/route          (routing preview; no usage)
 *   UC2  PATCH /api/preferences {mainModel}
 *   UC3  PATCH /api/preferences {trio}
 *   UC4  PATCH /api/preferences {mode}
 *   UC5  PATCH /api/preferences {auto} + /api/orchestration alias
 *
 * Mock LLM mode is on globally (MOCK_STREAM_DELAY_MS=0) so streams are deterministic.
 */

/** Sign up an isolated user and return their session cookie. */
async function newUser(email: string): Promise<string> {
  const r = await invoke(
    signup,
    req("POST", "/api/auth/signup", { body: { name: "QA", email, password: "supersecret" } }),
  );
  expect(r.status).toBe(200);
  return r.cookie!;
}

/** Disable a model for a user via PATCH /api/models/:id { enabled:false }. */
async function disableModel(cookie: string, id: string) {
  const r = await invoke(
    patchModel,
    req("PATCH", `/api/models/${id}`, { cookie, body: { enabled: false } }),
    { id },
  );
  expect(r.status).toBe(200);
  return r;
}

describe("US4.UC1: Auto-route a prompt by intent (preview)", () => {
  let cookie: string;

  beforeAll(async () => {
    await setupTestDb();
    cookie = await newUser("uc1@omnimind.dev");
  });

  it("routes a code-intent prompt to deepseek-pro with the localized Code label and no fallback", async () => {
    const r = await invoke(
      routePreview,
      req("POST", "/api/chat/route", { cookie, body: { prompt: "用 Python 写一个排序算法", lang: "en" } }),
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.modelId).toBe("deepseek-pro");
    expect(r.body.data.label).toBe("Code"); // localized to en
    expect(r.body.data.fallback).toBe(false);
    expect(typeof r.body.data.routeText).toBe("string");
    expect(r.body.data.routeText).toContain("DeepSeek V4 Pro");
  });

  it("routes a planning prompt to gemini-pro", async () => {
    const r = await invoke(
      routePreview,
      req("POST", "/api/chat/route", { cookie, body: { prompt: "帮我规划一次旅行计划", lang: "zh" } }),
    );
    expect(r.status).toBe(200);
    expect(r.body.data.modelId).toBe("gemini-pro");
    expect(r.body.data.label).toBe("规划");
    expect(r.body.data.fallback).toBe(false);
  });

  it("returns the next eligible model with fallback=true when the routed model is disabled", async () => {
    // deepseek-pro is the code-intent target; disable it then re-route a code prompt.
    // It starts in the default trio; move the trio off it first so disabling it
    // doesn't trigger a trio backfill that could re-introduce a code-intent model.
    const fb = await newUser("uc1-fb@omnimind.dev");
    await invoke(
      patchPrefs,
      req("PATCH", "/api/preferences", { cookie: fb, body: { trio: ["gpt-55", "claude-opus", "qwen"] } }),
    );
    await disableModel(fb, "deepseek-pro");
    const r = await invoke(
      routePreview,
      req("POST", "/api/chat/route", { cookie: fb, body: { prompt: "fix this python bug", lang: "en" } }),
    );
    expect(r.status).toBe(200);
    expect(r.body.data.fallback).toBe(true);
    expect(r.body.data.modelId).not.toBe("deepseek-pro");
    // The substituted model must itself be enabled (still in the registry, not the disabled one).
    expect(r.body.data.modelId).toBeTruthy();
  });

  it("rejects an empty prompt with 400 VALIDATION_ERROR", async () => {
    const r = await invoke(
      routePreview,
      req("POST", "/api/chat/route", { cookie, body: { prompt: "" } }),
    );
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const r = await invoke(routePreview, req("POST", "/api/chat/route", { body: { prompt: "hello" } }));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("AUTH_REQUIRED");
  });
});

describe("US4.UC2: Set the main model", () => {
  let cookie: string;

  beforeAll(async () => {
    await setupTestDb();
    cookie = await newUser("uc2@omnimind.dev");
  });

  it("persists an enabled main model and echoes it from GET /api/preferences", async () => {
    const patch = await invoke(
      patchPrefs,
      req("PATCH", "/api/preferences", { cookie, body: { mainModel: "claude-opus" } }),
    );
    expect(patch.status).toBe(200);
    expect(patch.body.ok).toBe(true);
    expect(patch.body.data.mainModel).toBe("claude-opus");

    const get = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(get.status).toBe(200);
    expect(get.body.data.mainModel).toBe("claude-opus");
  });

  it("rejects an unknown model id with 400 MODEL_NOT_AVAILABLE and leaves the preference unchanged", async () => {
    const r = await invoke(
      patchPrefs,
      req("PATCH", "/api/preferences", { cookie, body: { mainModel: "not-a-real-model" } }),
    );
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("MODEL_NOT_AVAILABLE");

    const get = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(get.body.data.mainModel).toBe("claude-opus"); // unchanged from the prior test
  });

  it("rejects a known but disabled model with 409 MODEL_DISABLED", async () => {
    const u = await newUser("uc2-disabled@omnimind.dev");
    await disableModel(u, "qwen");
    const r = await invoke(
      patchPrefs,
      req("PATCH", "/api/preferences", { cookie: u, body: { mainModel: "qwen" } }),
    );
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("MODEL_DISABLED");
  });

  it("uses the new main model as the Expert-mode compiler (reason.start)", async () => {
    // mainModel is claude-opus from above; run an expert turn and assert the compiler.
    const res = await chat(
      req("POST", "/api/chat", { cookie, body: { mode: "expert", prompt: "解释快速排序的复杂度" } }),
    );
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const reasonStart = events.find((e) => e.event === "reason.start");
    expect(reasonStart).toBeDefined();
    expect(reasonStart!.data.modelId).toBe("claude-opus");
  });
});

describe("US4.UC3: Configure the expert trio", () => {
  let cookie: string;

  beforeAll(async () => {
    await setupTestDb();
    cookie = await newUser("uc3@omnimind.dev");
  });

  it("persists 3 distinct enabled ids and returns that exact trio from GET", async () => {
    const trio = ["gpt-55", "gemini-pro", "qwen"];
    const patch = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { trio } }));
    expect(patch.status).toBe(200);
    expect(patch.body.data.trio).toEqual(trio);

    const get = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(get.body.data.trio).toEqual(trio);
  });

  it("rejects a trio with a duplicate id with 400 INVALID_TRIO", async () => {
    const r = await invoke(
      patchPrefs,
      req("PATCH", "/api/preferences", { cookie, body: { trio: ["gpt-55", "gpt-55", "qwen"] } }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_TRIO");
  });

  it("rejects a trio containing a disabled member with 400 INVALID_TRIO", async () => {
    const u = await newUser("uc3-disabled@omnimind.dev");
    await disableModel(u, "minimax");
    const r = await invoke(
      patchPrefs,
      req("PATCH", "/api/preferences", { cookie: u, body: { trio: ["gpt-55", "minimax", "qwen"] } }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_TRIO");
  });

  it("rejects a wrong-length trio with 400 VALIDATION_ERROR (zod .length(3))", async () => {
    const r = await invoke(
      patchPrefs,
      req("PATCH", "/api/preferences", { cookie, body: { trio: ["gpt-55", "qwen"] } }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("streams exactly the saved trio as experts in an Expert turn", async () => {
    // Saved trio above: ["gpt-55","gemini-pro","qwen"]. Ensure the compiler/main is enabled.
    await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { mainModel: "gpt-55" } }));
    const res = await chat(
      req("POST", "/api/chat", { cookie, body: { mode: "expert", prompt: "总结这段内容" } }),
    );
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const expertModels = events
      .filter((e) => e.event === "call.start" && e.data.role === "expert")
      .map((e) => e.data.modelId);
    expect(expertModels).toHaveLength(3);
    expect(new Set(expertModels)).toEqual(new Set(["gpt-55", "gemini-pro", "qwen"]));
  });
});

describe("US4.UC4: Switch between Fast and Expert modes", () => {
  let cookie: string;

  beforeAll(async () => {
    await setupTestDb();
    cookie = await newUser("uc4@omnimind.dev");
  });

  it("runs a single model when mode=fast is persisted and a prompt is sent", async () => {
    const patch = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { mode: "fast" } }));
    expect(patch.status).toBe(200);
    expect(patch.body.data.mode).toBe("fast");

    const res = await chat(req("POST", "/api/chat", { cookie, body: { prompt: "hello there" } }));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const callStarts = events.filter((e) => e.event === "call.start");
    expect(callStarts).toHaveLength(1);
    expect(callStarts[0].data.role).toBe("single");
    // Single-model fast turn has no fusion/reasoning stage.
    expect(events.some((e) => e.event === "reason.start")).toBe(false);
    const usage = events.find((e) => e.event === "turn.usage")!.data;
    expect(usage.callCount).toBe(1);
  });

  it("runs the trio+fusion pipeline when mode=expert is persisted", async () => {
    const patch = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { mode: "expert" } }));
    expect(patch.body.data.mode).toBe("expert");

    const res = await chat(req("POST", "/api/chat", { cookie, body: { prompt: "explain something complex" } }));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.some((e) => e.event === "reason.start")).toBe(true);
    const usage = events.find((e) => e.event === "turn.usage")!.data;
    expect(usage.callCount).toBe(4); // 3 experts + 1 fusion
  });

  it("rejects an invalid mode value with 400 VALIDATION_ERROR and does not change the mode", async () => {
    const r = await invoke(
      patchPrefs,
      req("PATCH", "/api/preferences", { cookie, body: { mode: "turbo" } }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");

    const get = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(get.body.data.mode).toBe("expert"); // unchanged
  });
});

describe("US4.UC5: Toggle auto-routing on/off", () => {
  let cookie: string;

  beforeAll(async () => {
    await setupTestDb();
    cookie = await newUser("uc5@omnimind.dev");
    // Operate in Fast mode where auto governs model selection.
    await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { mode: "fast" } }));
  });

  it("emits a route event in a Fast turn when auto=true", async () => {
    const patch = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { auto: true } }));
    expect(patch.body.data.auto).toBe(true);

    const res = await chat(req("POST", "/api/chat", { cookie, body: { prompt: "用 Python 写快速排序" } }));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const routeEvt = events.find((e) => e.event === "route");
    expect(routeEvt).toBeDefined();
    expect(routeEvt!.data.modelId).toBe("deepseek-pro"); // code intent
  });

  it("emits no route event and uses mainModel in a Fast turn when auto=false", async () => {
    // Pin a distinct main model so we can assert it was used.
    await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { mainModel: "glm" } }));
    const patch = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { auto: false } }));
    expect(patch.body.data.auto).toBe(false);

    const res = await chat(req("POST", "/api/chat", { cookie, body: { prompt: "用 Python 写快速排序" } }));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.some((e) => e.event === "route")).toBe(false);
    const single = events.find((e) => e.event === "call.start" && e.data.role === "single");
    expect(single).toBeDefined();
    expect(single!.data.modelId).toBe("glm"); // mainModel, NOT the intent-routed deepseek-pro
  });

  it("rejects a non-boolean auto with 400 VALIDATION_ERROR", async () => {
    const r = await invoke(
      patchPrefs,
      req("PATCH", "/api/preferences", { cookie, body: { auto: "yes" } }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("orchestration alias: setting mainModel implies auto=false unless auto is given", async () => {
    const u = await newUser("uc5-orch@omnimind.dev");
    // Default auto=true; setting mainModel via the alias must flip auto off.
    const r = await invoke(
      patchOrchestration,
      req("PATCH", "/api/orchestration", { cookie: u, body: { mainModel: "kimi" } }),
    );
    expect(r.status).toBe(200);
    expect(r.body.data.mainModel).toBe("kimi");
    expect(r.body.data.auto).toBe(false);
  });

  it("orchestration alias: an explicit auto in the same patch overrides the implied auto=false", async () => {
    const u = await newUser("uc5-orch2@omnimind.dev");
    const r = await invoke(
      patchOrchestration,
      req("PATCH", "/api/orchestration", { cookie: u, body: { mainModel: "kimi", auto: true } }),
    );
    expect(r.status).toBe(200);
    expect(r.body.data.mainModel).toBe("kimi");
    expect(r.body.data.auto).toBe(true);
  });
});
