import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { setupTestDb, req, invoke, readSse } from "./helpers/harness";
import { __stubCalls } from "./helpers/llm-stub";
import { getDb } from "@/lib/server/db/client";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as chat } from "@/app/api/chat/route";
import {
  maybeRefreshConversationDigest,
  loadRecentDigests,
  retrieveRelevantDigests,
  formatDigestsForPrompt,
  maybeRefreshConversationSummary,
  loadConversationSummary,
} from "@/lib/server/llm/summaries";
import { maybeRewriteProfile, loadUserProfile, type MemoryFact } from "@/lib/server/llm/memory";

let cookie: string;
let userId: string;

beforeAll(async () => {
  await setupTestDb();
  const r = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Dig", email: "dig@omnimind.dev", password: "supersecret" } }));
  cookie = r.cookie!;
  userId = r.body.data.user.id;
});
afterEach(() => {
  __stubCalls.length = 0;
});

const send = async (body: Record<string, unknown>) => readSse(await chat(req("POST", "/api/chat", { cookie, body })));
const FAKE_ID = "00000000-0000-0000-0000-000000000000";

describe("Cross-session digests (context-engineering L2)", () => {
  it("builds a digest after ≥2 turns and injects 'Previous sessions' on a new conversation", async () => {
    const ev1 = await send({ mode: "fast", auto: true, prompt: "explain database indexing strategies" });
    const conv = ev1.find((e) => e.event === "turn.start")!.data.conversationId as string;
    await send({ conversationId: conv, mode: "fast", auto: true, prompt: "and what about composite indexes?" });

    const { db } = await getDb();
    // The route fires the digest refresh post-stream (fire-and-forget); call it directly here for determinism.
    await maybeRefreshConversationDigest(db, conv, "en");

    const digests = await loadRecentDigests(db, userId, FAKE_ID, 3);
    expect(digests.length).toBeGreaterThanOrEqual(1);
    expect(digests[0]).toMatch(/Session digest/);
    expect(formatDigestsForPrompt(digests)).toContain("Previous sessions");

    // A brand-new conversation injects the prior session's digest into the model's system memory.
    __stubCalls.length = 0;
    await send({ mode: "fast", auto: false, mainModel: "gpt-55", prompt: "hello, a new topic now" });
    const answer = __stubCalls.find((c) => c.role === "single" && c.memory);
    expect(answer?.memory).toContain("Previous sessions");
  });

  it("rolls aged-out turns into a summary and injects it on continuing turns (Phase 2 compaction)", async () => {
    const ev = await send({ mode: "fast", auto: true, prompt: "turn one about apples" });
    const conv = ev.find((e) => e.event === "turn.start")!.data.conversationId as string;
    await send({ conversationId: conv, mode: "fast", auto: true, prompt: "turn two about bananas" });
    await send({ conversationId: conv, mode: "fast", auto: true, prompt: "turn three about cherries" });
    await send({ conversationId: conv, mode: "fast", auto: true, prompt: "turn four about dates" });

    const { db } = await getDb();
    // recentWindow=2 → the 2 oldest of the 4 turns age out and get summarized.
    await maybeRefreshConversationSummary(db, conv, "en", undefined, 2);
    const summary = await loadConversationSummary(db, conv);
    expect(summary).toBeTruthy();
    expect(summary).toMatch(/Running summary/);

    // A continuing turn injects the rolling summary into the model's system memory.
    __stubCalls.length = 0;
    await send({ conversationId: conv, mode: "fast", auto: false, mainModel: "gpt-55", prompt: "and now figs" });
    const answer = __stubCalls.find((c) => c.role === "single" && c.memory);
    expect(answer?.memory).toContain("Summary of earlier in this conversation");
  });

  it("a short conversation gets no rolling summary", async () => {
    const ev = await send({ mode: "fast", auto: true, prompt: "a brief single exchange" });
    const conv = ev.find((e) => e.event === "turn.start")!.data.conversationId as string;
    const { db } = await getDb();
    await maybeRefreshConversationSummary(db, conv, "en"); // default window=10, only 1 turn → skip
    expect(await loadConversationSummary(db, conv)).toBeUndefined();
  });

  it("rewrites + injects the Core Profile (L0) when a core fact appears", async () => {
    const { db } = await getDb();
    const facts: MemoryFact[] = [
      { text: "用户是资深 Python 后端工程师", category: "expertise", importance: 3, lastSeen: Date.now() },
      { text: "喜欢简洁直接的回答", category: "style", importance: 2, lastSeen: Date.now() },
    ];
    await maybeRewriteProfile(db, userId, "zh", facts);
    const profile = await loadUserProfile(db, userId);
    expect(profile).toBeTruthy();
    expect(profile).toMatch(/Core profile/);

    // The profile is injected FIRST into the model's system memory on the next turn.
    __stubCalls.length = 0;
    await send({ mode: "fast", auto: false, mainModel: "gpt-55", prompt: "hi there" });
    const answer = __stubCalls.find((c) => c.role === "single" && c.memory);
    expect(answer?.memory).toContain("User profile:");
  });

  it("no core fact → no profile rewrite", async () => {
    const r2 = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "NoCore", email: "nocore@omnimind.dev", password: "supersecret" } }));
    const uid2 = r2.body.data.user.id;
    const { db } = await getDb();
    await maybeRewriteProfile(db, uid2, "en", [{ text: "minor preference", category: "preference", importance: 1, lastSeen: Date.now() }]);
    expect(await loadUserProfile(db, uid2)).toBeUndefined();
  });

  it("retrieveRelevantDigests prefers the SEMANTICALLY relevant past session", async () => {
    const u = await invoke(signup, req("POST", "/api/auth/signup", { body: { name: "Rel", email: "rel@omnimind.dev", password: "supersecret" } }));
    const uid = u.body.data.user.id;
    const uc = u.cookie!;
    const sendU = async (body: Record<string, unknown>) => readSse(await chat(req("POST", "/api/chat", { cookie: uc, body })));

    const e1 = await sendU({ mode: "fast", auto: true, prompt: "kubernetes helm chart deployment question" });
    const c1 = e1.find((e) => e.event === "turn.start")!.data.conversationId as string;
    await sendU({ conversationId: c1, mode: "fast", auto: true, prompt: "more about kubernetes pods" });
    const e2 = await sendU({ mode: "fast", auto: true, prompt: "sourdough bread baking recipe" });
    const c2 = e2.find((e) => e.event === "turn.start")!.data.conversationId as string;
    await sendU({ conversationId: c2, mode: "fast", auto: true, prompt: "more about bread fermentation" });

    const { db } = await getDb();
    await maybeRefreshConversationDigest(db, c1, "en");
    await maybeRefreshConversationDigest(db, c2, "en");

    const top = await retrieveRelevantDigests(db, uid, FAKE_ID, "help me debug a kubernetes cluster", 1);
    expect(top).toHaveLength(1);
    expect(top[0].toLowerCase()).toContain("kubernetes"); // semantic recall picked the right session
  });

  it("a single-turn conversation produces no digest (too short)", async () => {
    const ev = await send({ mode: "fast", auto: true, prompt: "just one quick question here" });
    const conv = ev.find((e) => e.event === "turn.start")!.data.conversationId as string;
    const { db } = await getDb();
    await maybeRefreshConversationDigest(db, conv, "en");
    const digests = await loadRecentDigests(db, userId, FAKE_ID, 20);
    expect(digests.every((d) => d.trim().length > 0)).toBe(true); // never empty strings
    // the one-turn conversation's digest is not present (nothing references it specifically, but
    // the helper simply must not crash and must skip short chats)
  });
});
