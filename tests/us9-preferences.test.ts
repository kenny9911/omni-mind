import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";

import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as session } from "@/app/api/auth/session/route";
import { GET as getPrefs, PATCH as patchPrefs } from "@/app/api/preferences/route";
import { POST as chat } from "@/app/api/chat/route";
import { GET as convMessages } from "@/app/api/conversations/[id]/messages/route";

/**
 * US9 — Preferences & Localization.
 * Contract (§2.7): GET/PATCH /api/preferences →
 *   { theme, lang, mode, auto, mainModel, trio, deepResearch, deepAgents,
 *     platformFeePerCallMicro, platformFeeDisplayMicro }.
 * Billed fee is the constant 50000 per model call (PLATFORM_FEE_CNY=0.05);
 * platformFeeDisplayMicro is DISPLAY-ONLY and must never change billed amounts.
 */

/** Pull turnId + conversationId off the chat SSE stream. */
async function runChat(cookie: string, body: Record<string, unknown>) {
  const res = await chat(req("POST", "/api/chat", { cookie, body }));
  expect(res.status).toBe(200);
  const events = await readSse(res);
  const start = events.find((e) => e.event === "turn.start")!.data;
  const usage = events.find((e) => e.event === "turn.usage")!.data;
  return {
    events,
    conversationId: start.conversationId as string,
    turnId: start.turnId as string,
    usage,
  };
}

describe("US9.UC1: Get preferences", () => {
  let cookie: string;

  beforeAll(async () => {
    await setupTestDb();
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", { body: { name: "Uma", email: "uma-uc1@omnimind.dev", password: "supersecret" } }),
    );
    expect(r.status).toBe(200);
    cookie = r.cookie!;
    expect(cookie).toBeTruthy();
  });

  it("returns server defaults for a brand-new user with the full DTO shape", async () => {
    const r = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const d = r.body.data;
    // Documented defaults: dark / zh / expert.
    expect(d.theme).toBe("dark");
    expect(d.lang).toBe("zh");
    expect(d.mode).toBe("expert");
    expect(d.deepResearch).toBe(false);
    expect(d.deepAgents).toBe(false);
    // trio is the default 3-model set.
    expect(d.trio).toHaveLength(3);
    // Billed fee constant = ¥0.05 = 50000 micro; display default also 50000.
    expect(d.platformFeePerCallMicro).toBe(50000);
    expect(d.platformFeeDisplayMicro).toBe(50000);
  });

  it("rejects an unauthenticated GET with 401 AUTH_REQUIRED", async () => {
    const r = await invoke(getPrefs, req("GET", "/api/preferences"));
    expect(r.status).toBe(401);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("returns previously-saved values on a subsequent GET", async () => {
    await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { theme: "light", lang: "en" } }));
    const r = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.data.theme).toBe("light");
    expect(r.body.data.lang).toBe("en");
  });
});

describe("US9.UC2: Set theme (light/dark)", () => {
  let cookie: string;

  beforeAll(async () => {
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", { body: { name: "Theo", email: "theo-uc2@omnimind.dev", password: "supersecret" } }),
    );
    cookie = r.cookie!;
  });

  it("persists theme:light and returns the full payload", async () => {
    const p = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { theme: "light" } }));
    expect(p.status).toBe(200);
    expect(p.body.ok).toBe(true);
    expect(p.body.data.theme).toBe("light");
    // partial update: other defaults unchanged.
    expect(p.body.data.lang).toBe("zh");

    const g = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(g.body.data.theme).toBe("light");
  });

  it("rejects an invalid theme with 400 VALIDATION_ERROR and leaves the stored theme unchanged", async () => {
    const bad = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { theme: "blue" } }));
    expect(bad.status).toBe(400);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");

    const g = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(g.body.data.theme).toBe("light"); // unchanged from the prior valid PATCH
  });
});

describe("US9.UC3: Set language (4-language i18n)", () => {
  let cookie: string;

  beforeAll(async () => {
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", { body: { name: "Jun", email: "jun-uc3@omnimind.dev", password: "supersecret" } }),
    );
    cookie = r.cookie!;
  });

  it("accepts each of the 4 supported locales", async () => {
    for (const lang of ["zh", "zh-TW", "en", "ja"]) {
      const p = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { lang } }));
      expect(p.status).toBe(200);
      expect(p.body.data.lang).toBe(lang);
    }
  });

  it("persists lang:ja and future chat turns inherit it", async () => {
    const p = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { lang: "ja" } }));
    expect(p.status).toBe(200);
    expect(p.body.data.lang).toBe("ja");

    const g = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(g.body.data.lang).toBe("ja");

    // A new expert turn runs successfully under the ja default (4 calls billed).
    const { usage } = await runChat(cookie, { mode: "expert", prompt: "クイックソートを説明して" });
    expect(usage.callCount).toBe(4);
  });

  it("rejects an unsupported locale with 400 VALIDATION_ERROR", async () => {
    const bad = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { lang: "fr" } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");

    // stored lang is unchanged.
    const g = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(g.body.data.lang).toBe("ja");
  });
});

describe("US9.UC4: Toggle Deep Research / Deep Agents", () => {
  let cookie: string;

  beforeAll(async () => {
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", { body: { name: "Dee", email: "dee-uc4@omnimind.dev", password: "supersecret" } }),
    );
    cookie = r.cookie!;
  });

  it("persists deepResearch:true and a new turn is created with deepResearch:true", async () => {
    const p = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { deepResearch: true } }));
    expect(p.status).toBe(200);
    expect(p.body.data.deepResearch).toBe(true);
    expect(p.body.data.deepAgents).toBe(false); // independent

    // New turn (no explicit flag in body) inherits the preference default.
    const { conversationId, turnId } = await runChat(cookie, { mode: "expert", prompt: "research the history of sorting" });
    const msgs = await invoke(convMessages, req("GET", `/api/conversations/${conversationId}/messages`, { cookie }), { id: conversationId });
    expect(msgs.status).toBe(200);
    const turn = msgs.body.data.turns.find((t: any) => t.turnId === turnId);
    expect(turn).toBeTruthy();
    expect(turn.assistant.deepResearch).toBe(true);
  });

  it("persists both toggles independently", async () => {
    const p = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { deepResearch: false, deepAgents: true } }));
    expect(p.status).toBe(200);
    expect(p.body.data.deepResearch).toBe(false);
    expect(p.body.data.deepAgents).toBe(true);
  });

  it("rejects a non-boolean toggle with 400 VALIDATION_ERROR", async () => {
    const bad = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { deepAgents: "yes" } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("US9.UC5: Configure defaults (start mode, default lang, platform-fee display)", () => {
  let cookie: string;

  beforeAll(async () => {
    const r = await invoke(
      signup,
      req("POST", "/api/auth/signup", { body: { name: "Cas", email: "cas-uc5@omnimind.dev", password: "supersecret" } }),
    );
    cookie = r.cookie!;
  });

  it("persists defaultMode (mode) and defaultLang (lang)", async () => {
    const p = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { mode: "fast", lang: "en" } }));
    expect(p.status).toBe(200);
    expect(p.body.data.mode).toBe("fast");
    expect(p.body.data.lang).toBe("en");

    const g = await invoke(getPrefs, req("GET", "/api/preferences", { cookie }));
    expect(g.body.data.mode).toBe("fast");
    expect(g.body.data.lang).toBe("en");
  });

  it("treats platformFeeDisplayMicro as display-only: changing it does NOT change the billed fee (still 50000/call)", async () => {
    // Override the DISPLAY fee to an arbitrary value far from the billed 50000.
    const p = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { platformFeeDisplayMicro: 1 } }));
    expect(p.status).toBe(200);
    expect(p.body.data.platformFeeDisplayMicro).toBe(1);
    // The billed-per-call constant is unaffected by the display override.
    expect(p.body.data.platformFeePerCallMicro).toBe(50000);

    // Run an expert turn under the display override; billed fee must still be 50000/call.
    const { conversationId, turnId, usage } = await runChat(cookie, { mode: "expert", prompt: "explain merge sort" });
    expect(usage.callCount).toBe(4);
    expect(usage.turnFeeMicro).toBe(200000); // 4 calls × 50000 billed, NOT 4 × 1

    // The persisted usage_records (billing source of truth) also show 50000/call.
    const msgs = await invoke(convMessages, req("GET", `/api/conversations/${conversationId}/messages`, { cookie }), { id: conversationId });
    const turn = msgs.body.data.turns.find((t: any) => t.turnId === turnId);
    expect(turn.perTurn.callCount).toBe(4);
    expect(turn.perTurn.platformFeeMicro).toBe(200000);
  });

  it("rejects an out-of-range platformFeeDisplayMicro with 400 VALIDATION_ERROR", async () => {
    const bad = await invoke(patchPrefs, req("PATCH", "/api/preferences", { cookie, body: { platformFeeDisplayMicro: -1 } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("session echoes the saved preferences (GET /api/auth/session)", async () => {
    const s = await invoke(session, req("GET", "/api/auth/session", { cookie }));
    expect(s.status).toBe(200);
    const prefs = s.body.data.preferences;
    expect(prefs.mode).toBe("fast");
    expect(prefs.lang).toBe("en");
    expect(prefs.platformFeeDisplayMicro).toBe(1);
    // Billed fee in the session payload is still the real 50000 constant.
    expect(prefs.platformFeePerCallMicro).toBe(50000);
  });
});
