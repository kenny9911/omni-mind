import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as createConversation, GET as listConversations } from "@/app/api/conversations/route";
import { PATCH as renameConversation, DELETE as deleteConversation } from "@/app/api/conversations/[id]/route";
import { GET as getMessages } from "@/app/api/conversations/[id]/messages/route";
import { POST as chat } from "@/app/api/chat/route";
import { GET as usageSummary } from "@/app/api/usage/summary/route";
import { encodeCursor } from "@/lib/server/contracts/conversations";

/** Run a chat turn against a conversation and return the parsed SSE turn.usage data. */
async function runTurn(
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ turnUsage: any; turnDone: any; events: { event: string; data: any }[] }> {
  const res = await chat(req("POST", "/api/chat", { cookie, body }));
  expect(res.status).toBe(200);
  const events = await readSse(res);
  const turnUsage = events.find((e) => e.event === "turn.usage")?.data;
  const turnDone = events.find((e) => e.event === "turn.done")?.data;
  return { turnUsage, turnDone, events };
}

describe("US8 — Conversations & History", () => {
  let cookie: string; // user A
  let cookieB: string; // user B (for ownership tests)

  beforeAll(async () => {
    await setupTestDb();
    const a = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Ann", email: "ann@omnimind.dev", password: "supersecret" } }));
    expect(a.status).toBe(200);
    cookie = a.cookie!;
    const b = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Bob", email: "bob@omnimind.dev", password: "supersecret" } }));
    expect(b.status).toBe(200);
    cookieB = b.cookie!;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("US8.UC1: Create a conversation", () => {
    it("creates with a placeholder title + fresh uuid + deterministic color when no title given", async () => {
      const r = await invoke(createConversation, req("POST", "/api/conversations", { cookie, body: {} }));
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      const c = r.body.data.conversation;
      expect(c.id).toMatch(/^[0-9a-f-]{36}$/); // uuid
      expect(c.title).toBe("New chat");
      expect(typeof c.color).toBe("string");
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/i); // accent color derived from id
      expect(c.createdAt).toBe(c.updatedAt); // fresh row: createdAt == updatedAt
    });

    it("stores a provided title verbatim (trimmed)", async () => {
      const r = await invoke(createConversation, req("POST", "/api/conversations", { cookie, body: { title: "  Quarterly Planning  " } }));
      expect(r.status).toBe(200);
      expect(r.body.data.conversation.title).toBe("Quarterly Planning");
    });

    it("rejects an over-long title with 400 VALIDATION_ERROR", async () => {
      const r = await invoke(createConversation, req("POST", "/api/conversations", { cookie, body: { title: "x".repeat(121) } }));
      expect(r.status).toBe(400);
      expect(r.body.ok).toBe(false);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects an unauthenticated create with 401", async () => {
      const r = await invoke(createConversation, req("POST", "/api/conversations", { body: {} }));
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe("AUTH_REQUIRED");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("US8.UC2: List conversations & recents", () => {
    it("returns owned conversations newest-updatedAt first with turnCount, lastPrompt, color", async () => {
      // Drive two conversations via chat so they have turns (and thus turnCount/lastPrompt).
      const t1 = await runTurn(cookie, { mode: "fast", auto: true, prompt: "first conversation prompt" });
      const conv1 = t1.turnDone.turnId ? null : null; // turnId is the turn, not conversation
      // Create a second conversation by sending a new prompt (no conversationId → new conv).
      await runTurn(cookie, { mode: "fast", auto: true, prompt: "second conversation prompt" });

      const r = await invoke(listConversations, req("GET", "/api/conversations?limit=50", { cookie }));
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      const list = r.body.data.conversations as any[];
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(2);

      // Ordering invariant: updatedAt is monotonically non-increasing (newest first).
      for (let i = 1; i < list.length; i++) {
        expect(list[i - 1].updatedAt).toBeGreaterThanOrEqual(list[i].updatedAt);
      }

      // Row shape: every conversation exposes the documented RecentVM fields.
      for (const row of list) {
        expect(typeof row.id).toBe("string");
        expect(typeof row.title).toBe("string");
        expect(typeof row.color).toBe("string");
        expect(typeof row.updatedAt).toBe("number");
        expect(typeof row.lastPrompt).toBe("string");
        expect(typeof row.turnCount).toBe("number");
      }

      // The conversations that received chat turns report turnCount >= 1 and a lastPrompt preview.
      const withTurns = list.filter((c) => c.turnCount >= 1);
      expect(withTurns.length).toBeGreaterThanOrEqual(2);
      const prompts = withTurns.map((c) => c.lastPrompt);
      expect(prompts).toContain("first conversation prompt");
      expect(prompts).toContain("second conversation prompt");
      expect(conv1).toBeNull();
    });

    it("returns an empty array (HTTP 200, null cursor) for a user with no conversations", async () => {
      const fresh = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Cleo", email: "cleo@omnimind.dev", password: "supersecret" } }));
      const r = await invoke(listConversations, req("GET", "/api/conversations", { cookie: fresh.cookie! }));
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.data.conversations).toEqual([]);
      expect(r.body.data.nextCursor).toBeNull();
    });

    it("ignores a cursor that is positioned past the end (empty page, null nextCursor)", async () => {
      const fresh = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Cory", email: "cory@omnimind.dev", password: "supersecret" } }));
      const freshCookie = fresh.cookie!;
      // Two conversations, then a cursor at the oldest → next page is empty.
      const c1 = await invoke(createConversation, req("POST", "/api/conversations", { cookie: freshCookie, body: { title: "one" } }));
      await invoke(createConversation, req("POST", "/api/conversations", { cookie: freshCookie, body: { title: "two" } }));
      const oldest = c1.body.data.conversation; // created first → oldest updatedAt
      const cursor = encodeURIComponent(encodeCursor(oldest.updatedAt, oldest.id));
      const next = await invoke(listConversations, req("GET", `/api/conversations?limit=100&cursor=${cursor}`, { cookie: freshCookie }));
      expect(next.status).toBe(200);
      expect(next.body.data.conversations).toEqual([]);
      expect(next.body.data.nextCursor).toBeNull();
    });

    it("does not leak another user's conversations (ownership scoping)", async () => {
      const owned = await invoke(createConversation, req("POST", "/api/conversations", { cookie: cookieB, body: { title: "Bob private" } }));
      const bobId = owned.body.data.conversation.id;
      const r = await invoke(listConversations, req("GET", "/api/conversations?limit=100", { cookie }));
      expect(r.status).toBe(200);
      const ids = (r.body.data.conversations as any[]).map((c) => c.id);
      expect(ids).not.toContain(bobId);
    });

    it("paginates with a nextCursor and no overlap across pages", async () => {
      const pager = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Pat", email: "pat@omnimind.dev", password: "supersecret" } }));
      const pagerCookie = pager.cookie!;
      for (let i = 0; i < 5; i++) {
        await invoke(createConversation, req("POST", "/api/conversations", { cookie: pagerCookie, body: { title: `conv-${i}` } }));
      }

      const page1 = await invoke(listConversations, req("GET", "/api/conversations?limit=2", { cookie: pagerCookie }));
      expect(page1.status).toBe(200);
      expect(page1.body.data.conversations).toHaveLength(2);
      expect(page1.body.data.nextCursor).toBeTruthy();

      const cursor = encodeURIComponent(page1.body.data.nextCursor);
      const page2 = await invoke(listConversations, req("GET", `/api/conversations?limit=2&cursor=${cursor}`, { cookie: pagerCookie }));
      expect(page2.status).toBe(200);
      expect(page2.body.data.conversations.length).toBeGreaterThanOrEqual(1);

      const ids1 = (page1.body.data.conversations as any[]).map((c) => c.id);
      const ids2 = (page2.body.data.conversations as any[]).map((c) => c.id);
      for (const id of ids2) expect(ids1).not.toContain(id); // no overlap
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("US8.UC3: Rename a conversation", () => {
    it("renames an owned conversation and bumps updatedAt", async () => {
      const created = await invoke(createConversation, req("POST", "/api/conversations", { cookie, body: { title: "Old name" } }));
      const id = created.body.data.conversation.id;
      const originalUpdatedAt = created.body.data.conversation.updatedAt;

      const r = await invoke(renameConversation, req("PATCH", `/api/conversations/${id}`, { cookie, body: { title: "  New name  " } }), { id });
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.data.conversation.title).toBe("New name"); // trimmed
      expect(r.body.data.conversation.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);

      // GET list reflects the new title.
      const list = await invoke(listConversations, req("GET", "/api/conversations?limit=100", { cookie }));
      const row = (list.body.data.conversations as any[]).find((c) => c.id === id);
      expect(row.title).toBe("New name");
    });

    it("returns 404 NOT_FOUND when renaming another user's conversation, and nothing changes", async () => {
      const created = await invoke(createConversation, req("POST", "/api/conversations", { cookie: cookieB, body: { title: "Bob owned" } }));
      const id = created.body.data.conversation.id;

      const r = await invoke(renameConversation, req("PATCH", `/api/conversations/${id}`, { cookie, body: { title: "hijacked" } }), { id });
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");

      // Bob still sees the original title.
      const list = await invoke(listConversations, req("GET", "/api/conversations?limit=100", { cookie: cookieB }));
      const row = (list.body.data.conversations as any[]).find((c) => c.id === id);
      expect(row.title).toBe("Bob owned");
    });

    it("returns 404 NOT_FOUND for a non-existent conversation id", async () => {
      const r = await invoke(renameConversation, req("PATCH", "/api/conversations/00000000-0000-0000-0000-000000000000", { cookie, body: { title: "ghost" } }), { id: "00000000-0000-0000-0000-000000000000" });
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");
    });

    it("rejects an empty title with 400 VALIDATION_ERROR", async () => {
      const created = await invoke(createConversation, req("POST", "/api/conversations", { cookie, body: { title: "Has name" } }));
      const id = created.body.data.conversation.id;
      const r = await invoke(renameConversation, req("PATCH", `/api/conversations/${id}`, { cookie, body: { title: "" } }), { id });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("US8.UC4: Delete a conversation", () => {
    it("deletes conversation + turns/messages but RETAINS usage_records (billing totals unchanged)", async () => {
      // Build a dedicated user so usage totals are isolated and deterministic.
      const del = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Della", email: "della@omnimind.dev", password: "supersecret" } }));
      const delCookie = del.cookie!;

      // One expert turn (4 calls: 3 experts + fusion) so there is real usage to retain.
      const turn = await runTurn(delCookie, { mode: "expert", prompt: "explain quicksort" });
      expect(turn.turnUsage.callCount).toBe(4);
      const conversationId = turn.events.find((e) => e.event === "turn.start")!.data.conversationId;

      // Usage summary BEFORE delete (includes seeded demo usage + the 4 new calls).
      const before = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie: delCookie }));
      expect(before.status).toBe(200);
      const totalsBefore = before.body.data.totals;
      expect(totalsBefore.callCount).toBeGreaterThanOrEqual(4);

      // The conversation lists with its turn.
      const listBefore = await invoke(listConversations, req("GET", "/api/conversations?limit=100", { cookie: delCookie }));
      expect((listBefore.body.data.conversations as any[]).some((c) => c.id === conversationId)).toBe(true);

      // DELETE.
      const r = await invoke(deleteConversation, req("DELETE", `/api/conversations/${conversationId}`, { cookie: delCookie }), { id: conversationId });
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.data).toEqual({ id: conversationId, deleted: true });

      // Conversation gone from the list; its messages endpoint 404s.
      const listAfter = await invoke(listConversations, req("GET", "/api/conversations?limit=100", { cookie: delCookie }));
      expect((listAfter.body.data.conversations as any[]).some((c) => c.id === conversationId)).toBe(false);
      const msgs = await invoke(getMessages, req("GET", `/api/conversations/${conversationId}/messages`, { cookie: delCookie }), { id: conversationId });
      expect(msgs.status).toBe(404);
      expect(msgs.body.error.code).toBe("NOT_FOUND");

      // Usage summary AFTER delete: totals UNCHANGED (usage_records retained).
      const after = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie: delCookie }));
      expect(after.status).toBe(200);
      const totalsAfter = after.body.data.totals;
      expect(totalsAfter.callCount).toBe(totalsBefore.callCount);
      expect(totalsAfter.modelCostMicro).toBe(totalsBefore.modelCostMicro);
      expect(totalsAfter.platformFeeMicro).toBe(totalsBefore.platformFeeMicro);
      expect(totalsAfter.totalMicro).toBe(totalsBefore.totalMicro);
    });

    it("returns 404 NOT_FOUND when deleting another user's conversation", async () => {
      const created = await invoke(createConversation, req("POST", "/api/conversations", { cookie: cookieB, body: { title: "Bob keep" } }));
      const id = created.body.data.conversation.id;
      const r = await invoke(deleteConversation, req("DELETE", `/api/conversations/${id}`, { cookie }), { id });
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");

      // Bob still owns it.
      const list = await invoke(listConversations, req("GET", "/api/conversations?limit=100", { cookie: cookieB }));
      expect((list.body.data.conversations as any[]).some((c) => c.id === id)).toBe(true);
    });

    it("is idempotent-safe: deleting an already-deleted id returns 404", async () => {
      const created = await invoke(createConversation, req("POST", "/api/conversations", { cookie, body: { title: "Twice" } }));
      const id = created.body.data.conversation.id;
      const first = await invoke(deleteConversation, req("DELETE", `/api/conversations/${id}`, { cookie }), { id });
      expect(first.status).toBe(200);
      const second = await invoke(deleteConversation, req("DELETE", `/api/conversations/${id}`, { cookie }), { id });
      expect(second.status).toBe(404);
      expect(second.body.error.code).toBe("NOT_FOUND");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("US8.UC5: Fetch message history + regenerate", () => {
    it("rehydrates an expert turn: 3 experts + fusion, persisted text, exact perTurn cost", async () => {
      const u = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Hana", email: "hana@omnimind.dev", password: "supersecret" } }));
      const uCookie = u.cookie!;

      const turn = await runTurn(uCookie, { mode: "expert", prompt: "describe merge sort" });
      const conversationId = turn.events.find((e) => e.event === "turn.start")!.data.conversationId;
      const turnId = turn.turnDone.turnId;
      const turnUsage = turn.turnUsage; // { turnCostMicro, turnFeeMicro, turnTotalMicro, callCount }

      const r = await invoke(getMessages, req("GET", `/api/conversations/${conversationId}/messages`, { cookie: uCookie }), { id: conversationId });
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      const turns = r.body.data.turns as any[];
      expect(turns).toHaveLength(1);
      const t = turns[0];

      expect(t.turnId).toBe(turnId);
      expect(t.user.text).toBe("describe merge sort");
      expect(t.assistant.mode).toBe("expert");
      expect(t.assistant.deepResearch).toBe(false);
      expect(Array.isArray(t.assistant.experts)).toBe(true);
      expect(t.assistant.experts).toHaveLength(3);
      expect(t.assistant.fusion).toBeDefined();
      // persisted text (not a partial stream slice) is present on each expert + fusion.
      for (const e of t.assistant.experts) expect(typeof e.text).toBe("string");
      expect(typeof t.assistant.fusion.answerText).toBe("string");
      expect(t.assistant.fusion.answerText.length).toBeGreaterThan(0);
      expect(typeof t.assistant.fusion.reasonText).toBe("string");

      // perTurn derived from usage_records matches the streamed turn.usage exactly.
      expect(t.perTurn.callCount).toBe(turnUsage.callCount); // 4 (3 experts + fusion)
      expect(t.perTurn.callCount).toBe(4);
      expect(t.perTurn.modelCostMicro).toBe(turnUsage.turnCostMicro);
      expect(t.perTurn.platformFeeMicro).toBe(turnUsage.turnFeeMicro);
      // totalMicro == model cost + callCount × per-call fee (zero drift).
      expect(t.perTurn.totalMicro).toBe(t.perTurn.modelCostMicro + t.perTurn.platformFeeMicro);
      expect(t.perTurn.totalMicro).toBe(turnUsage.turnTotalMicro);
      expect(t.perTurn.platformFeeMicro).toBe(4 * 50000); // callCount × fee
    });

    it("rehydrates a fast turn with a single payload + routeText", async () => {
      const u = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Finn", email: "finn@omnimind.dev", password: "supersecret" } }));
      const uCookie = u.cookie!;
      const turn = await runTurn(uCookie, { mode: "fast", auto: true, prompt: "what is a closure" });
      const conversationId = turn.events.find((e) => e.event === "turn.start")!.data.conversationId;

      const r = await invoke(getMessages, req("GET", `/api/conversations/${conversationId}/messages`, { cookie: uCookie }), { id: conversationId });
      expect(r.status).toBe(200);
      const t = (r.body.data.turns as any[])[0];
      expect(t.assistant.mode).toBe("fast");
      expect(t.assistant.single).toBeDefined();
      expect(typeof t.assistant.single.text).toBe("string");
      expect(typeof t.assistant.routeText).toBe("string"); // auto routing recorded a route text
      expect(t.perTurn.callCount).toBe(1);
      expect(t.perTurn.platformFeeMicro).toBe(50000); // 1 × fee
    });

    it("regenerates a fast turn: re-runs the same model, replaces usage, no double-count", async () => {
      const u = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Remy", email: "remy@omnimind.dev", password: "supersecret" } }));
      const uCookie = u.cookie!;

      const turn = await runTurn(uCookie, { mode: "fast", auto: true, prompt: "regenerate me" });
      const conversationId = turn.events.find((e) => e.event === "turn.start")!.data.conversationId;
      const turnId = turn.turnDone.turnId;
      expect(turn.turnUsage.callCount).toBe(1); // one fast call

      // Baseline usage AFTER the first run (includes seed baseline + this 1 call).
      const before = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie: uCookie }));
      const callsBefore = before.body.data.totals.callCount;

      // Regenerate the existing turn in place.
      const regen = await runTurn(uCookie, { conversationId, regenerateTurnId: turnId });
      expect(regen.turnDone.turnId).toBe(turnId); // same turn re-run in place
      expect(regen.turnUsage.callCount).toBe(1);

      // After regenerate: usage REPLACED, not appended — total callCount is UNCHANGED
      // (the old usage_record for this turn was deleted before the new one was written).
      const after = await invoke(usageSummary, req("GET", "/api/usage/summary?window=all", { cookie: uCookie }));
      expect(after.body.data.totals.callCount).toBe(callsBefore);

      // History still has exactly one turn with callCount 1 (not double-counted).
      const msgs = await invoke(getMessages, req("GET", `/api/conversations/${conversationId}/messages`, { cookie: uCookie }), { id: conversationId });
      const turns = msgs.body.data.turns as any[];
      expect(turns).toHaveLength(1);
      expect(turns[0].turnId).toBe(turnId);
      expect(turns[0].perTurn.callCount).toBe(1);
      expect(turns[0].perTurn.totalMicro).toBe(turns[0].perTurn.modelCostMicro + turns[0].perTurn.platformFeeMicro);
    });

    it("returns 400 VALIDATION_ERROR / 404 when regenerateTurnId is not a real turn", async () => {
      const u = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Vera", email: "vera@omnimind.dev", password: "supersecret" } }));
      const uCookie = u.cookie!;
      const created = await invoke(createConversation, req("POST", "/api/conversations", { cookie: uCookie, body: { title: "empty conv" } }));
      const conversationId = created.body.data.conversation.id;

      const res = await chat(req("POST", "/api/chat", { cookie: uCookie, body: { conversationId, regenerateTurnId: "00000000-0000-0000-0000-000000000000" } }));
      // Unknown turn → 404 TURN_NOT_FOUND per regenerate handler.
      expect([400, 404]).toContain(res.status);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(["TURN_NOT_FOUND", "VALIDATION_ERROR", "NOT_FOUND"]).toContain(body.error.code);
    });

    it("returns 404 NOT_FOUND for messages of another user's conversation", async () => {
      const created = await invoke(createConversation, req("POST", "/api/conversations", { cookie: cookieB, body: { title: "Bob hist" } }));
      const id = created.body.data.conversation.id;
      const r = await invoke(getMessages, req("GET", `/api/conversations/${id}/messages`, { cookie }), { id });
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");
    });
  });
});
