import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";
import { __stubCalls } from "./helpers/llm-stub";
import { buildGatewayPrompt } from "@/lib/server/llm/gateway";
import { colorFor, truncate } from "@/lib/server/util";
import { MODEL_MAP } from "@/lib/models";

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as chat } from "@/app/api/chat/route";
import { GET as listConversations } from "@/app/api/conversations/route";
import { GET as getMessages } from "@/app/api/conversations/[id]/messages/route";

let cookie: string;

beforeAll(async () => {
  await setupTestDb();
  const r = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Fay", email: "fay@omnimind.dev", password: "supersecret" } }));
  expect(r.status).toBe(200);
  cookie = r.cookie!;
});

beforeEach(() => {
  __stubCalls.length = 0;
});
afterEach(() => {
  delete process.env.MOCK_FAIL_MODELS;
  delete process.env.MOCK_FAIL_ROLES;
});

describe("Fusion compiler receives the experts' full answers (context merge)", () => {
  it("buildGatewayPrompt embeds every expert's answer text in the fusion-answer + fusion-reason prompts", () => {
    const expertAnswers = [
      { name: "DeepSeek Pro", text: "Use quicksort: pick a pivot, partition, recurse. O(n log n) average." },
      { name: "GPT-5.5", text: "Merge sort is stable and O(n log n) worst case but needs O(n) extra space." },
      { name: "Claude Opus", text: "For small arrays insertion sort wins; hybrids like Timsort exploit runs." },
    ];
    for (const role of ["fusion-answer", "fusion-reason"] as const) {
      const prompt = buildGatewayPrompt({
        role,
        modelId: "gpt-55",
        prompt: "Explain the best sorting algorithm",
        lang: "en",
        expertAnswers,
        onDelta: () => {},
      });
      // The user's prompt AND each expert's full answer must be present.
      expect(prompt).toContain("Explain the best sorting algorithm");
      for (const e of expertAnswers) {
        expect(prompt).toContain(e.name);
        expect(prompt).toContain(e.text);
      }
    }
  });

  it("an expert turn passes all 3 surviving experts' answers into the fusion-answer call", async () => {
    const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "expert", prompt: "describe merge sort", trio: ["deepseek-pro", "claude-opus", "qwen"], mainModel: "gpt-55" } }));
    expect(res.status).toBe(200);
    await readSse(res);

    const expertCalls = __stubCalls.filter((c) => c.role === "expert");
    expect(expertCalls).toHaveLength(3);

    const fusionAnswer = __stubCalls.find((c) => c.role === "fusion-answer");
    expect(fusionAnswer).toBeTruthy();
    expect(fusionAnswer!.expertAnswers).toHaveLength(3);
    for (const ea of fusionAnswer!.expertAnswers!) {
      expect(typeof ea.name).toBe("string");
      expect(ea.text.length).toBeGreaterThan(0);
    }
    // The fusion prompt actually embeds those answers (end-to-end: route → fusion → prompt).
    const prompt = buildGatewayPrompt(fusionAnswer!);
    for (const ea of fusionAnswer!.expertAnswers!) {
      expect(prompt).toContain(ea.text);
    }

    // fusion-reason gets the same context.
    const fusionReason = __stubCalls.find((c) => c.role === "fusion-reason");
    expect(fusionReason?.expertAnswers).toHaveLength(3);
  });

  it("a failed fusion-reason degrades gracefully: the answer still completes, reasoning is surfaced as failed", async () => {
    process.env.MOCK_FAIL_ROLES = "fusion-reason"; // only the reasoning trace fails
    const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "expert", prompt: "explain b-trees", trio: ["deepseek-pro", "claude-opus", "qwen"], mainModel: "gpt-55" } }));
    expect(res.status).toBe(200);
    const events = await readSse(res);

    // The turn still SUCCEEDS — the consolidated answer carries the full expert merge.
    expect(events.find((e) => e.event === "turn.done")?.data.status).toBe("done");
    // Reasoning failure is surfaced (failed:true, 0 tokens), not silently treated as a real trace.
    const reasonDone = events.find((e) => e.event === "reason.done")?.data;
    expect(reasonDone?.failed).toBe(true);
    expect(reasonDone?.reasoningTokens).toBe(0);

    // The answer persists with content and an empty reasonText (not a fake one).
    const convId = events.find((e) => e.event === "turn.start")!.data.conversationId;
    const msgs = await invoke(getMessages, req("GET", `/api/conversations/${convId}/messages`, { cookie }), { id: convId });
    const t = (msgs.body.data.turns as any[])[0];
    expect(t.assistant.fusion.answerText.length).toBeGreaterThan(0);
    expect(t.assistant.fusion.reasonText).toBe("");
    // The failure is persisted, so a page reload shows the "reasoning unavailable" note too.
    expect(t.assistant.fusion.reasonFailed).toBe(true);
  });

  it("a partial expert failure still passes only the SURVIVING experts' answers to fusion", async () => {
    process.env.MOCK_FAIL_MODELS = "claude-opus"; // one trio member fails
    const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "expert", prompt: "hash vs b-tree index", trio: ["deepseek-pro", "claude-opus", "qwen"], mainModel: "gpt-55" } }));
    expect(res.status).toBe(200);
    await readSse(res);

    const fusionAnswer = __stubCalls.find((c) => c.role === "fusion-answer");
    expect(fusionAnswer).toBeTruthy();
    // claude-opus failed → excluded; only the 2 survivors are merged.
    expect(fusionAnswer!.expertAnswers).toHaveLength(2);
    const names = fusionAnswer!.expertAnswers!.map((e) => e.name);
    expect(names).not.toContain(MODEL_MAP["claude-opus"].name);
    expect(new Set(names)).toEqual(new Set([MODEL_MAP["deepseek-pro"].name, MODEL_MAP["qwen"].name]));
    const prompt = buildGatewayPrompt(fusionAnswer!);
    for (const ea of fusionAnswer!.expertAnswers!) expect(prompt).toContain(ea.text);
  });
});

describe("A new chat is saved and surfaces in history immediately", () => {
  it("turn.start carries the new conversation's title+color, and the conversation lists with its turn", async () => {
    const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: true, prompt: "is my new chat saved in history?" } }));
    expect(res.status).toBe(200);
    const events = await readSse(res);

    const start = events.find((e) => e.event === "turn.start")?.data;
    expect(start).toBeTruthy();
    const conversationId = start.conversationId as string;
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);

    // The client needs title+color up front to show the chat in the sidebar without a reload.
    expect(start.newConversation).toBe(true);
    expect(start.title).toBe(truncate("is my new chat saved in history?", 40));
    expect(start.color).toBe(colorFor(conversationId)); // matches what the server persisted

    // And it is genuinely persisted: it lists with turnCount >= 1 and rehydrates.
    const list = await invoke(listConversations, req("GET", "/api/conversations?limit=50", { cookie }));
    const row = (list.body.data.conversations as any[]).find((c) => c.id === conversationId);
    expect(row).toBeTruthy();
    expect(row.turnCount).toBeGreaterThanOrEqual(1);
    expect(row.title).toBe(start.title);
    expect(row.color).toBe(start.color);

    const msgs = await invoke(getMessages, req("GET", `/api/conversations/${conversationId}/messages`, { cookie }), { id: conversationId });
    expect(msgs.status).toBe(200);
    expect((msgs.body.data.turns as any[]).length).toBe(1);
  });

  it("a failed turn (all experts fail) is still atomically persisted and lists in history", async () => {
    process.env.MOCK_FAIL_MODELS = "deepseek-pro,claude-opus,qwen"; // whole trio fails
    const res = await chat(req("POST", "/api/chat", { cookie, body: { mode: "expert", prompt: "this turn will fail", trio: ["deepseek-pro", "claude-opus", "qwen"], mainModel: "gpt-55" } }));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const start = events.find((e) => e.event === "turn.start")!.data;
    expect(start.newConversation).toBe(true);
    expect(events.find((e) => e.event === "error")?.data.code).toBe("ALL_EXPERTS_FAILED");

    // The conversation (committed in the pre-stream transaction) is still saved, so the user
    // sees it in history and can regenerate — not silently lost.
    const list = await invoke(listConversations, req("GET", "/api/conversations?limit=50", { cookie }));
    const row = (list.body.data.conversations as any[]).find((c) => c.id === start.conversationId);
    expect(row).toBeTruthy();
    expect(row.turnCount).toBeGreaterThanOrEqual(1);
  });

  it("threading into an existing conversation does NOT mark turn.start as a new conversation", async () => {
    const first = await chat(req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: true, prompt: "first turn" } }));
    const firstStart = (await readSse(first)).find((e) => e.event === "turn.start")!.data;
    const conversationId = firstStart.conversationId as string;
    expect(firstStart.newConversation).toBe(true);

    const second = await chat(req("POST", "/api/chat", { cookie, body: { conversationId, mode: "fast", auto: true, prompt: "second turn same conversation" } }));
    const secondStart = (await readSse(second)).find((e) => e.event === "turn.start")!.data;
    expect(secondStart.conversationId).toBe(conversationId);
    expect(secondStart.newConversation).toBeUndefined();
  });
});

describe("Multi-turn conversation context is sent to the models", () => {
  it("the first turn of a NEW conversation carries no history", async () => {
    __stubCalls.length = 0;
    const r = await chat(req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: true, prompt: "brand new conversation, no prior context" } }));
    await readSse(r);
    const call = __stubCalls.find((c) => c.role === "single");
    expect(call).toBeTruthy();
    expect(call!.history ?? []).toHaveLength(0);
  });

  it("a follow-up turn sends the prior turn's user+assistant exchange as history to every model call", async () => {
    // Turn 1 establishes context.
    const r1 = await chat(req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: true, prompt: "remember: my favorite color is teal" } }));
    const convId = (await readSse(r1)).find((e) => e.event === "turn.start")!.data.conversationId;

    __stubCalls.length = 0; // isolate the follow-up turn's calls

    // Turn 2 (expert mode) in the SAME conversation — a follow-up that only makes sense with history.
    const r2 = await chat(req("POST", "/api/chat", { cookie, body: { conversationId: convId, mode: "expert", prompt: "what color did I mention?", trio: ["deepseek-pro", "claude-opus", "qwen"], mainModel: "gpt-55" } }));
    await readSse(r2);

    // Each expert receives the prior exchange (user prompt + assistant answer) as history.
    const expertCall = __stubCalls.find((c) => c.role === "expert");
    expect(expertCall?.history).toHaveLength(2);
    expect(expertCall!.history![0]).toMatchObject({ role: "user", content: "remember: my favorite color is teal" });
    expect(expertCall!.history![1].role).toBe("assistant");
    expect(expertCall!.history![1].content.length).toBeGreaterThan(0);

    // The fusion compiler gets the same conversation context.
    const fusionCall = __stubCalls.find((c) => c.role === "fusion-answer");
    expect(fusionCall?.history).toHaveLength(2);
    expect(fusionCall!.history![0].content).toContain("teal");
  });

  it("history is bounded to the last MAX_HISTORY_TURNS exchanges", async () => {
    const { MAX_HISTORY_TURNS } = await import("@/lib/server/contracts/chat-helpers");
    // Build a conversation with more than MAX_HISTORY_TURNS completed turns.
    const r0 = await chat(req("POST", "/api/chat", { cookie, body: { mode: "fast", auto: true, prompt: "turn 0" } }));
    const convId = (await readSse(r0)).find((e) => e.event === "turn.start")!.data.conversationId;
    for (let i = 1; i <= MAX_HISTORY_TURNS + 2; i++) {
      await readSse(await chat(req("POST", "/api/chat", { cookie, body: { conversationId: convId, mode: "fast", auto: true, prompt: `turn ${i}` } })));
    }
    __stubCalls.length = 0;
    await readSse(await chat(req("POST", "/api/chat", { cookie, body: { conversationId: convId, mode: "fast", auto: true, prompt: "final turn" } })));
    // The ANSWER call is the single-role call carrying history (background helper calls — memory
    // extraction / digest / summary — also use role "single" but pass no history).
    const call = __stubCalls.find((c) => c.role === "single" && c.history);
    // 2 messages (user+assistant) per included turn, capped at MAX_HISTORY_TURNS turns.
    expect(call!.history!.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS * 2);
    expect(call!.history!.length).toBe(MAX_HISTORY_TURNS * 2);
  });
});
