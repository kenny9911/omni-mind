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
export type CallRole = "single" | "expert" | "fusion-reason" | "fusion-answer" | "intent";

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
  /**
   * The surviving experts' FULL answers, passed to the fusion compiler so it can
   * actually merge their content (not just be told their names). Required for a
   * real, context-preserving fusion — without it the compiler re-answers blind.
   */
  expertAnswers?: { name: string; text: string }[];
  /** optional output-token cap (keeps cheap helper calls cheap) */
  maxOutputTokens?: number;
  /** compact user-context preamble to prepend (context-engineering memory) */
  memory?: string;
  /** prior conversation turns (alternating user/assistant), oldest→newest, for multi-turn context */
  history?: { role: "user" | "assistant"; content: string }[];
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
  const content = buildGatewayPrompt(args);
  // Assemble the request as: [cacheable SYSTEM memory block] + [history turns] + [current user msg].
  // The system block holds the stable user-context (memory) and is marked for Anthropic prompt
  // caching (cache_control: ephemeral) — a no-op for other providers, but big savings for the
  // Claude model in the expert trio. We use a bare prompt only when there's neither memory nor history.
  type Msgs = NonNullable<Parameters<typeof streamText>[0]["messages"]>;
  const history = (args.history ?? []).map((m) => ({ role: m.role, content: m.content }));
  const systemMsg = args.memory
    ? [{ role: "system" as const, content: args.memory, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }]
    : [];
  const request: { messages: Msgs } | { prompt: string } =
    systemMsg.length || history.length
      ? { messages: [...systemMsg, ...history, { role: "user", content }] as Msgs }
      : { prompt: content };
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
      ...request,
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

/** Render the experts' full answers as labeled blocks for the fusion compiler. */
function expertBlocks(args: StreamOneArgs): string {
  const answers = (args.expertAnswers ?? []).filter((e) => e && e.text && e.text.trim().length > 0);
  if (answers.length === 0) {
    // Defensive: a fusion call should always carry the expert answers. Fall back to the
    // trio names so the compiler at least knows the panel, rather than silently blank.
    const names = (args.trio ?? []).map((id) => MODEL_MAP[id]?.name ?? id);
    return names.length ? `(expert answers unavailable; panel: ${names.join(", ")})` : "(no expert answers available)";
  }
  return answers.map((e, i) => `--- Expert ${i + 1} · ${e.name} ---\n${e.text.trim()}`).join("\n\n");
}

export function buildGatewayPrompt(args: StreamOneArgs): string {
  let base: string;
  if (args.role === "fusion-reason") {
    base =
      `You are the fusion compiler in a multi-expert system. ${(args.expertAnswers ?? []).length} experts each answered the user's prompt independently; their FULL answers are below. ` +
      `Compare them: pinpoint each expert's strongest and most correct points, note where they agree, and flag where they conflict or where one is wrong. Plan how to merge them into a single best answer. ` +
      `Think step by step and output ONLY your reasoning trace — do not write the final answer yet.\n\n` +
      `USER PROMPT:\n${args.prompt}\n\nEXPERT ANSWERS:\n${expertBlocks(args)}`;
  } else if (args.role === "fusion-answer") {
    base =
      `You are the fusion compiler in a multi-expert system. ${(args.expertAnswers ?? []).length} experts each answered the user's prompt independently; their FULL answers are below. ` +
      `Write ONE consolidated, standalone best answer that MERGES the strongest, most correct, and complementary points from across ALL experts: keep the useful specifics (facts, code, steps, caveats, examples), drop redundancy and anything wrong, and resolve contradictions in favor of the most accurate. ` +
      `Your answer must be at least as complete and correct as the best single expert — never lose information they provided. ` +
      `Do NOT mention the experts, the merge, or that multiple answers existed; just produce the best possible answer for the user.\n\n` +
      `USER PROMPT:\n${args.prompt}\n\nEXPERT ANSWERS:\n${expertBlocks(args)}`;
  } else {
    base = args.prompt;
  }
  // Memory is NOT prepended here anymore — it rides in a separate, cacheable system message
  // (see streamViaGateway) so the stable user-context block can be reused via prompt caching.
  return base;
}
