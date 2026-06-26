import { MODEL_MAP } from "@/lib/models";
import { estTok } from "@/lib/accounting";
import type { Lang } from "@/lib/types";
import { resolveCandidates, directKeyPresent } from "./providers";
import { log, redactSecrets } from "../log/logger";

/**
 * Low-level single model call. Streams output via onDelta and returns the full
 * text + usage. Every call goes to a real provider — dedicated key → OpenRouter →
 * Vercel AI Gateway (see resolveCandidates). Nothing calls a provider directly.
 */
export type CallRole = "single" | "expert" | "fusion-reason" | "fusion-answer";

export interface StreamedCall {
  text: string;
  outputTokens: number;
  status: "ok" | "error";
  error?: string;
}

export interface StreamOneArgs {
  role: CallRole;
  modelId: string;
  prompt: string;
  lang: Lang;
  trio?: string[];
  /** optional output-token cap (keeps cheap helper calls cheap) */
  maxOutputTokens?: number;
  /** compact user-context preamble to prepend (context-engineering memory) */
  memory?: string;
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}

/** True when the Vercel AI Gateway can authenticate (gateway key or Vercel OIDC). */
export function gatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

/**
 * True when a real model call can be authenticated by EITHER the gateway or a
 * direct provider key (BYOK). Routes use this to gate real (non-demo) chats:
 * with at least one path configured, per-model resolution picks direct-or-gateway
 * and any single unreachable model degrades gracefully.
 */
export function llmConfigured(): boolean {
  return gatewayConfigured() || directKeyPresent();
}

export async function streamOne(args: StreamOneArgs): Promise<StreamedCall> {
  try {
    return await streamViaGateway(args);
  } catch (err) {
    return { text: "", outputTokens: 0, status: "error", error: String(err) };
  }
}

/**
 * Extract a clean, user-facing message from a provider / AI Gateway / AI SDK error.
 * The result is shown to the user (inline `answer.error`) and logged, so it is
 * scrubbed of any secret-shaped substrings (some providers echo a partial key in
 * auth errors).
 */
function errMessage(e: unknown): string {
  const raw = ((): string => {
    if (e && typeof e === "object") {
      const any = e as { message?: unknown; responseBody?: unknown };
      if (typeof any.responseBody === "string") {
        try {
          const j = JSON.parse(any.responseBody) as { error?: { message?: string } };
          if (j?.error?.message) return j.error.message;
        } catch {
          /* not json */
        }
      }
      if (typeof any.message === "string" && any.message && any.message !== "[object Object]") {
        return any.message;
      }
    }
    return e instanceof Error ? e.message : String(e);
  })();
  return redactSecrets(raw);
}

async function streamViaGateway(args: StreamOneArgs): Promise<StreamedCall> {
  const { streamText } = await import("ai");
  const prompt = buildGatewayPrompt(args);
  // Ordered candidates: dedicated provider → OpenRouter → gateway slug.
  const candidates = await resolveCandidates(args.modelId);

  let lastError = "The model returned no output";
  const tried: string[] = [];
  for (const cand of candidates) {
    tried.push(cand.label);
    // The AI SDK does NOT throw stream errors during iteration — it routes them to onError.
    // We capture them so a failed model surfaces as status:"error", and so we can fall through
    // to the next candidate when a provider rejects BEFORE emitting any output.
    let capturedError: string | null = null;
    const result = streamText({
      model: cand.model,
      prompt,
      abortSignal: args.signal,
      ...(args.maxOutputTokens ? { maxOutputTokens: args.maxOutputTokens } : {}),
      onError: (ev: { error: unknown }) => {
        capturedError = errMessage(ev?.error);
      },
    });

    let text = "";
    let emitted = false;
    try {
      for await (const delta of result.textStream) {
        if (args.signal?.aborted) break;
        text += delta;
        emitted = true;
        args.onDelta(delta);
      }
    } catch (e) {
      capturedError = capturedError ?? errMessage(e);
    }

    let outputTokens = estTok(text);
    try {
      const usage = await result.usage;
      if (usage && typeof usage.outputTokens === "number" && usage.outputTokens > 0) {
        outputTokens = usage.outputTokens;
      }
    } catch (e) {
      capturedError = capturedError ?? errMessage(e);
    }

    if (!capturedError && text.trim().length > 0) {
      // Note when a non-primary candidate served — signals a dedicated id worth fixing.
      if (tried.length > 1) {
        log.info("llm.fallback_used", { modelId: args.modelId, role: args.role, served: cand.label, tried });
      }
      return { text, outputTokens, status: "ok" };
    }
    lastError = capturedError ?? lastError;
    // Don't retry once we've streamed partial output to the client (would concatenate two
    // different answers), or once the client aborted.
    if (emitted || args.signal?.aborted) break;
  }

  log.warn("llm.call_failed", { modelId: args.modelId, role: args.role, error: lastError, tried });
  return { text: "", outputTokens: 0, status: "error", error: lastError };
}

function buildGatewayPrompt(args: StreamOneArgs): string {
  const name = (id: string) => MODEL_MAP[id]?.name ?? id;
  let base: string;
  if (args.role === "fusion-reason") {
    base = `You are the fusion compiler. Compare the answers from the experts (${(args.trio ?? []).map(name).join(", ")}) for the user prompt below. Think step by step about how to de-duplicate and consolidate their strongest points. Output only your reasoning trace.\n\nPrompt: ${args.prompt}`;
  } else if (args.role === "fusion-answer") {
    base = `You are the fusion compiler. Rewrite ONE consolidated best answer that merges the strongest point from each expert (${(args.trio ?? []).map(name).join(", ")}), deduplicated — not a meta-summary.\n\nPrompt: ${args.prompt}`;
  } else {
    base = args.prompt;
  }
  // Prepend the compact user-context memory when present (single + fusion only).
  return args.memory ? `${args.memory}\n\n---\n\n${base}` : base;
}
