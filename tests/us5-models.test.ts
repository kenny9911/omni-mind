import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke } from "./helpers/harness";

import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as listModels } from "@/app/api/models/route";
import { PATCH as patchModel } from "@/app/api/models/[id]/route";

import { MODELS, OPENROUTER_MODELS } from "@/lib/models";

/**
 * US5 — Model library management.
 * Exercises GET /api/models (UC1/UC4/UC5) and PATCH /api/models/:id (UC2/UC3)
 * against the real route handlers in mock mode (deterministic).
 *
 * Defaults (from lib/server/llm/registry.ts):
 *   mainModel = "gpt-55"
 *   trio      = ["deepseek-pro", "gpt-55", "claude-opus"]
 */
describe("US5 — Model library management", () => {
  let cookie: string;

  beforeAll(async () => {
    await setupTestDb();
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", {
        body: { name: "Mona", email: "mona@omnimind.dev", password: "supersecret" },
      }),
    );
    expect(r.status).toBe(200);
    cookie = r.cookie!;
    expect(cookie).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // US5.UC1 — List all 12 models with metadata
  // ---------------------------------------------------------------------------
  describe("US5.UC1: list all 12 models with metadata", () => {
    it("returns 12 ModelDTOs plus the openRouter catalog", async () => {
      const r = await invoke(listModels, req("GET", "/api/models", { cookie }));
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);

      const { models, openRouter } = r.body.data;
      expect(models).toHaveLength(12);

      // Each item carries tier/ctx/pin/pout/enabled (UC1 acceptance).
      for (const m of models) {
        expect(m).toHaveProperty("id");
        expect(m).toHaveProperty("tier");
        expect(m).toHaveProperty("ctx");
        expect(typeof m.pin).toBe("number");
        expect(typeof m.pout).toBe("number");
        expect(typeof m.enabled).toBe("boolean");
        expect(m.enabled).toBe(true); // fresh user: COALESCE → true
      }

      // openRouter is a string[] of extra models on the default payload.
      expect(Array.isArray(openRouter)).toBe(true);
      expect(openRouter).toEqual([...OPENROUTER_MODELS]);
    });

    it("has exactly one main model, defaulting to gpt-55", async () => {
      const r = await invoke(listModels, req("GET", "/api/models", { cookie }));
      const main = r.body.data.models.filter((m: any) => m.isMain);
      expect(main).toHaveLength(1);
      expect(main[0].id).toBe("gpt-55");
    });

    it("server registry matches lib/models.ts (ids, prices, tiers — no drift)", async () => {
      const r = await invoke(listModels, req("GET", "/api/models", { cookie }));
      const byId: Record<string, any> = Object.fromEntries(
        r.body.data.models.map((m: any) => [m.id, m]),
      );
      for (const src of MODELS) {
        const dto = byId[src.id];
        expect(dto).toBeDefined();
        expect(dto.pin).toBe(src.pin);
        expect(dto.pout).toBe(src.pout);
        expect(dto.tier).toBe(src.tier);
      }
    });

    it("rejects unauthenticated access with 401 AUTH_REQUIRED", async () => {
      const r = await invoke(listModels, req("GET", "/api/models"));
      expect(r.status).toBe(401);
      expect(r.body.ok).toBe(false);
      expect(r.body.error.code).toBe("AUTH_REQUIRED");
    });
  });

  // ---------------------------------------------------------------------------
  // US5.UC4 — Inspect tiers, pricing, context windows; localized tags via ?lang
  // ---------------------------------------------------------------------------
  describe("US5.UC4: tiers, pricing, context windows, localized tags", () => {
    it("exposes gpt-55 as flagship with pin=20, pout=80, ctx=400K", async () => {
      const r = await invoke(listModels, req("GET", "/api/models", { cookie }));
      const gpt = r.body.data.models.find((m: any) => m.id === "gpt-55");
      expect(gpt.tier).toBe("flagship");
      expect(gpt.pin).toBe(20);
      expect(gpt.pout).toBe(80);
      expect(gpt.ctx).toBe("400K");
    });

    it("localizes tags to Japanese with ?lang=ja (推理 → 推論)", async () => {
      const r = await invoke(
        listModels,
        req("GET", "/api/models?lang=ja", { cookie }),
      );
      expect(r.status).toBe(200);
      // deepseek-pro tags zh=[推理, 代码] → ja=[推論, コード]
      const ds = r.body.data.models.find((m: any) => m.id === "deepseek-pro");
      expect(ds.tags).toEqual(["推論", "コード"]);
    });

    it("returns default zh tags when no lang given", async () => {
      const r = await invoke(listModels, req("GET", "/api/models", { cookie }));
      const ds = r.body.data.models.find((m: any) => m.id === "deepseek-pro");
      expect(ds.tags).toEqual(["推理", "代码"]);
    });

    it("localizes tags to Traditional Chinese with ?lang=zh-TW (代码 → 程式碼)", async () => {
      const r = await invoke(
        listModels,
        req("GET", "/api/models?lang=zh-TW", { cookie }),
      );
      const ds = r.body.data.models.find((m: any) => m.id === "deepseek-pro");
      expect(ds.tags).toEqual(["推理", "程式碼"]);
    });

    it("rejects an unsupported lang value with 400 VALIDATION_ERROR", async () => {
      // ?lang is constrained to the enum; an unknown value fails query validation
      // (the en→zh fallback in pick() applies only to in-bounds requests).
      const r = await invoke(
        listModels,
        req("GET", "/api/models?lang=fr", { cookie }),
      );
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ---------------------------------------------------------------------------
  // US5.UC2 — Enable / disable a model
  // ---------------------------------------------------------------------------
  describe("US5.UC2: enable / disable a model", () => {
    it("disables a non-main, non-trio model and reflects it in GET /api/models", async () => {
      // qwen is neither main (gpt-55) nor in the default trio.
      const patch = await invoke(
        patchModel,
        req("PATCH", "/api/models/qwen", { cookie, body: { enabled: false } }),
        { id: "qwen" },
      );
      expect(patch.status).toBe(200);
      expect(patch.body.ok).toBe(true);
      expect(patch.body.data.model.id).toBe("qwen");
      expect(patch.body.data.model.enabled).toBe(false);

      const list = await invoke(listModels, req("GET", "/api/models", { cookie }));
      const qwen = list.body.data.models.find((m: any) => m.id === "qwen");
      expect(qwen.enabled).toBe(false);

      // Re-enable to keep state clean for later assertions.
      const reenable = await invoke(
        patchModel,
        req("PATCH", "/api/models/qwen", { cookie, body: { enabled: true } }),
        { id: "qwen" },
      );
      expect(reenable.status).toBe(200);
      expect(reenable.body.data.model.enabled).toBe(true);
    });

    it("refuses to disable the current main model → 409 CANNOT_DISABLE_MAIN", async () => {
      const r = await invoke(
        patchModel,
        req("PATCH", "/api/models/gpt-55", { cookie, body: { enabled: false } }),
        { id: "gpt-55" },
      );
      expect(r.status).toBe(409);
      expect(r.body.ok).toBe(false);
      expect(r.body.error.code).toBe("CANNOT_DISABLE_MAIN");
    });

    it("disabling a trio member drops it from the trio and backfills", async () => {
      // claude-opus is in the default trio but is not the main model. Disabling
      // it must succeed (a disabled model can't stay an expert) and the response
      // returns a fresh 3-member trio that no longer contains it.
      const r = await invoke(
        patchModel,
        req("PATCH", "/api/models/claude-opus", { cookie, body: { enabled: false } }),
        { id: "claude-opus" },
      );
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(Array.isArray(r.body.data.trio)).toBe(true);
      expect(r.body.data.trio).toHaveLength(3);
      expect(new Set(r.body.data.trio).size).toBe(3);
      expect(r.body.data.trio).not.toContain("claude-opus");
    });

    it("returns 404 MODEL_NOT_FOUND for an unknown model id", async () => {
      const r = await invoke(
        patchModel,
        req("PATCH", "/api/models/does-not-exist", {
          cookie,
          body: { enabled: false },
        }),
        { id: "does-not-exist" },
      );
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("MODEL_NOT_FOUND");
    });

    it("rejects unauthenticated PATCH with 401 AUTH_REQUIRED", async () => {
      const r = await invoke(
        patchModel,
        req("PATCH", "/api/models/qwen", { body: { enabled: false } }),
        { id: "qwen" },
      );
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe("AUTH_REQUIRED");
    });
  });

  // ---------------------------------------------------------------------------
  // US5.UC3 — Set a model as main
  // ---------------------------------------------------------------------------
  describe("US5.UC3: set a model as main", () => {
    it("pins an enabled model as main and clears the prior main", async () => {
      const r = await invoke(
        patchModel,
        req("PATCH", "/api/models/gemini-pro", {
          cookie,
          body: { setMain: true },
        }),
        { id: "gemini-pro" },
      );
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.data.mainModel).toBe("gemini-pro");
      expect(r.body.data.model.id).toBe("gemini-pro");
      expect(r.body.data.model.isMain).toBe(true);

      // Exactly one model is main, and it is the new one.
      const list = await invoke(listModels, req("GET", "/api/models", { cookie }));
      const main = list.body.data.models.filter((m: any) => m.isMain);
      expect(main).toHaveLength(1);
      expect(main[0].id).toBe("gemini-pro");
      expect(
        list.body.data.models.find((m: any) => m.id === "gpt-55").isMain,
      ).toBe(false);

      // Restore gpt-55 as main so subsequent describes see the documented default.
      const restore = await invoke(
        patchModel,
        req("PATCH", "/api/models/gpt-55", { cookie, body: { setMain: true } }),
        { id: "gpt-55" },
      );
      expect(restore.status).toBe(200);
      expect(restore.body.data.mainModel).toBe("gpt-55");
    });

    it("refuses to set a disabled model as main → 400 MODEL_NOT_AVAILABLE", async () => {
      // glm is neither main nor in the trio, so it can be disabled freely.
      const disable = await invoke(
        patchModel,
        req("PATCH", "/api/models/glm", { cookie, body: { enabled: false } }),
        { id: "glm" },
      );
      expect(disable.status).toBe(200);
      expect(disable.body.data.model.enabled).toBe(false);

      const setMain = await invoke(
        patchModel,
        req("PATCH", "/api/models/glm", { cookie, body: { setMain: true } }),
        { id: "glm" },
      );
      expect(setMain.status).toBe(400);
      expect(setMain.body.error.code).toBe("MODEL_NOT_AVAILABLE");

      // Re-enable to leave state clean.
      await invoke(
        patchModel,
        req("PATCH", "/api/models/glm", { cookie, body: { enabled: true } }),
        { id: "glm" },
      );
    });

    it("returns 404 MODEL_NOT_FOUND when setting an unknown id as main", async () => {
      const r = await invoke(
        patchModel,
        req("PATCH", "/api/models/nope", { cookie, body: { setMain: true } }),
        { id: "nope" },
      );
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("MODEL_NOT_FOUND");
    });
  });

  // ---------------------------------------------------------------------------
  // US5.UC5 — Reach extra models via the OpenRouter gateway
  // ---------------------------------------------------------------------------
  describe("US5.UC5: OpenRouter gateway catalog", () => {
    it("returns the OpenRouter catalog as OpenRouterDTOs in mock mode", async () => {
      const r = await invoke(
        listModels,
        req("GET", "/api/models?gateway=openrouter", { cookie }),
      );
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);

      const { models } = r.body.data;
      expect(Array.isArray(models)).toBe(true);
      // OpenRouterDTO shape is { name }.
      const names = models.map((m: any) => m.name);
      for (const expected of [
        "Llama 4 405B",
        "Mistral Large 3",
        "Grok 4",
        "Command R+",
      ]) {
        expect(names).toContain(expected);
      }
      // The gateway payload does not carry the core 12 + openRouter shape.
      expect(r.body.data.openRouter).toBeUndefined();
    });

    it("requires authentication for the gateway catalog → 401 AUTH_REQUIRED", async () => {
      const r = await invoke(
        listModels,
        req("GET", "/api/models?gateway=openrouter"),
      );
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe("AUTH_REQUIRED");
    });
  });
});
