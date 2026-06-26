import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";
import { __stubCalls } from "./helpers/llm-stub";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as chat } from "@/app/api/chat/route";
import { GET as getMessages } from "@/app/api/conversations/[id]/messages/route";

let cookie: string;

beforeAll(async () => {
  await setupTestDb();
  const r = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Sol", email: "sol@omnimind.dev", password: "supersecret" } }));
  expect(r.status).toBe(200);
  cookie = r.cookie!;
});

beforeEach(() => {
  __stubCalls.length = 0;
});

/** Open a conversation with one completed turn and return its id. */
async function openConversation(prompt: string): Promise<string> {
  const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: true, prompt } }));
  expect(res.status).toBe(200);
  const events = await readSse(res);
  return events.find((e) => e.event === "turn.start")!.data.conversationId as string;
}

describe("Single-flight: at most one streaming turn per conversation", () => {
  it("two concurrent sends into one conversation: exactly one streams, the other gets 409", async () => {
    const conversationId = await openConversation("open the conversation");

    // Fire two POST /api/chat for the SAME conversation simultaneously. The client-side
    // composer guard does not exist here (scripted / double-submitted), so both reach the
    // server. Win/lose is decided synchronously (the turn is inserted before streaming).
    const [a, b] = await Promise.all([
      chat(req("POST", "/api/chat", { cookie, body: { conversationId, mode: "fast", auto: true, prompt: "concurrent A" } })),
      chat(req("POST", "/api/chat", { cookie, body: { conversationId, mode: "fast", auto: true, prompt: "concurrent B" } })),
    ]);

    // Exactly one 200 (streams), exactly one 409 (rejected) — never two streams.
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;

    // The loser is the single-flight rejection — same code hasStreamingTurn returns.
    const loserBody = await loser.json();
    expect(loserBody.ok).toBe(false);
    expect(loserBody.error.code).toBe("STREAM_IN_PROGRESS");

    // The winner is a real SSE stream that opens (and completes) its turn.
    const events = await readSse(winner);
    expect(events.find((e) => e.event === "turn.start")).toBeTruthy();
    expect(events.find((e) => e.event === "turn.done")).toBeTruthy();
    // It did not error with the single-flight code itself.
    expect(events.some((e) => e.event === "error" && e.data?.code === "STREAM_IN_PROGRESS")).toBe(false);

    // Persistence proves only ONE new turn was created: the opener + the winner = 2 turns.
    const msgs = await invoke(getMessages, req("GET", `/api/conversations/${conversationId}/messages`, { cookie }), { id: conversationId });
    expect((msgs.body.data.turns as any[]).length).toBe(2);
  });

  it("the guard only blocks CONCURRENT streams — a send after the previous turn finishes still succeeds", async () => {
    const conversationId = await openConversation("first sequential turn");

    // The partial unique index is WHERE status='streaming', so once the prior turn is 'done'
    // a new send is unblocked (it must not over-block ordinary multi-turn conversations).
    const second = await chat(req("POST", "/api/chat", { cookie, body: { conversationId, mode: "fast", auto: true, prompt: "second sequential turn" } }));
    expect(second.status).toBe(200);
    const events = await readSse(second);
    expect(events.find((e) => e.event === "turn.start")?.data.conversationId).toBe(conversationId);

    const msgs = await invoke(getMessages, req("GET", `/api/conversations/${conversationId}/messages`, { cookie }), { id: conversationId });
    expect((msgs.body.data.turns as any[]).length).toBe(2);
  });
});
