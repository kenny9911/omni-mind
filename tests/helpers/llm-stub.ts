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
export async function streamOneStub(args: StreamOneArgs): Promise<StreamedCall> {
  const fail = process.env.MOCK_FAIL_MODELS;
  if (fail && fail.split(",").map((s) => s.trim()).includes(args.modelId)) {
    return { text: "", outputTokens: 0, status: "error", error: "injected failure" };
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
