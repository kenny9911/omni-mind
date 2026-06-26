import { MODEL_MAP } from "@/lib/models";
import { buildAnswer, buildReason, buildFusion } from "./content";
import { estTok } from "@/lib/accounting";
import type { StreamOneArgs, StreamedCall } from "@/lib/server/llm/gateway";

/**
 * Test-only deterministic provider stub. The production app has NO mock engine —
 * every call hits a real provider. Tests stub `streamOne` (the single network seam)
 * with this so the suite stays keyless, fast, and deterministic. Reuses the shared
 * content engine so token/cost math is identical to a real-but-fixed response.
 *
 * Fault injection: MOCK_FAIL_MODELS="id1,id2" forces those model ids to error
 * (used to exercise degraded-turn handling).
 */
/** Test-inspectable record of every stubbed call (so tests can assert what the
 *  fusion compiler actually received — e.g. the experts' answers). Cleared per test. */
export const __stubCalls: StreamOneArgs[] = [];

export async function streamOneStub(args: StreamOneArgs): Promise<StreamedCall> {
  __stubCalls.push(args);
  const fail = process.env.MOCK_FAIL_MODELS;
  if (fail && fail.split(",").map((s) => s.trim()).includes(args.modelId)) {
    return { text: "", outputTokens: 0, status: "error", error: "injected failure" };
  }
  // Role-based fault injection: MOCK_FAIL_ROLES="fusion-reason" fails only that call role
  // (used to exercise e.g. a failed reasoning trace while the fusion answer still succeeds).
  const failRoles = process.env.MOCK_FAIL_ROLES;
  if (failRoles && failRoles.split(",").map((s) => s.trim()).includes(args.role)) {
    return { text: "", outputTokens: 0, status: "error", error: "injected role failure" };
  }
  // Core profile (L0) rewrite: deterministic short text for tests.
  if (args.prompt.startsWith("REWRITE_PROFILE")) {
    const firstFact = (args.prompt.match(/- \[[^\]]*\] ([^\n]+)/)?.[1] || "this user").slice(0, 80);
    const profile = `Core profile: ${firstFact}`;
    args.onDelta(profile);
    return { text: profile, outputTokens: estTok(profile), status: "ok" };
  }
  // Rolling conversation summary (compaction): deterministic short text for tests.
  if (args.prompt.startsWith("SUMMARIZE_HISTORY")) {
    const firstUser = (args.prompt.match(/User: ([^\n]+)/)?.[1] || "earlier turns").slice(0, 60);
    const summary = `Running summary: earlier the user discussed ${firstUser}.`;
    args.onDelta(summary);
    return { text: summary, outputTokens: estTok(summary), status: "ok" };
  }
  // Conversation digest (cross-session memory): deterministic short text for tests.
  if (args.prompt.startsWith("SUMMARIZE_CONVERSATION")) {
    const firstUser = (args.prompt.match(/User: ([^\n]+)/)?.[1] || "the topic").slice(0, 60);
    const digest = `Session digest: the user discussed ${firstUser}.`;
    args.onDelta(digest);
    return { text: digest, outputTokens: estTok(digest), status: "ok" };
  }
  // Intent classifier: return deterministic typed JSON so classifyIntent() exercises its real
  // parse/route path in tests (the actual follow-up rewrite quality is verified live).
  if (args.prompt.startsWith("INTENT_CLASSIFY")) {
    const m = args.prompt.match(/Latest user message:\n"""([\s\S]*?)"""/);
    const latest = (m?.[1] || "").trim();
    const s = latest.toLowerCase();
    const intent = /code|代码|python|算法|排序|sql|bug/.test(s)
      ? "code"
      : /写|文案|story|poem|email|邮件/.test(s)
        ? "writing"
        : /翻译|translate/.test(s)
          ? "translation"
          : /规划|plan|计划|旅行/.test(s)
            ? "planning"
            : "general";
    const json = JSON.stringify({ intent, standalone_query: latest, complexity: latest.length > 80 ? "complex" : "simple", confidence: 0.9 });
    args.onDelta(json);
    return { text: json, outputTokens: estTok(json), status: "ok" };
  }
  let full: string;
  if (args.role === "fusion-reason") {
    full = buildReason(args.trio ?? [], MODEL_MAP[args.modelId]?.name ?? args.modelId, args.lang);
  } else if (args.role === "fusion-answer") {
    full = buildFusion(args.prompt, args.trio ?? [], args.lang);
  } else {
    full = buildAnswer(args.prompt, args.modelId, args.lang);
  }
  for (let i = 0; i < full.length; i += 80) {
    if (args.signal?.aborted) break;
    args.onDelta(full.slice(i, i + 80));
  }
  return { text: full, outputTokens: estTok(full), status: "ok" };
}
