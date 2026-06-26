import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MODEL_MAP } from "@/lib/models";
import { estTok } from "@/lib/accounting";
import type { Lang } from "@/lib/types";
import type { DB } from "../db/client";
import { messages, turns } from "../db/schema";
import { writeUsage } from "../log/activity";
import { log } from "../log/logger";
import { billCall, PLATFORM_FEE_MICRO } from "./cost";
import { route } from "./router";
import { routeFromIntent, type IntentResult } from "./intent";
import { streamOne } from "./gateway";
import { webSearch, formatResearchForPrompt, researchConfigured, type ResearchSource } from "./research";

export type Emit = (event: string, data: Record<string, unknown>) => void;

export interface RunTurnCfg {
  requestId: string;
  userId: string;
  conversationId: string;
  turnId: string;
  mode: "fast" | "expert";
  prompt: string;
  lang: Lang;
  auto: boolean;
  mainModel: string;
  trio: string[];
  enabledSet: Set<string>;
  deepResearch: boolean;
  deepAgents: boolean;
  /** compact user-context memory preamble (injected into single + fusion calls only) */
  memory?: string;
  /** prior conversation turns (alternating user/assistant), oldest→newest — multi-turn context
   *  sent to every model call so follow-ups are understood in context. */
  history?: { role: "user" | "assistant"; content: string }[];
  /** resolved intent + standalone-query rewrite for this turn (drives fast-mode auto-routing). */
  intent?: IntentResult;
  /** set only when THIS turn created the conversation — lets the client add it to the
   *  sidebar recents immediately (title/color match what the server persisted). */
  newConversation?: { title: string; color: string };
  signal?: AbortSignal;
}

export interface RunTurnResult {
  status: "done" | "partial" | "failed";
  messageId: string;
  routedModelId?: string;
  rollup: { tokens: number; costMicro: number; feeMicro: number; totalMicro: number; callCount: number };
}

// Deep Research and Deep Agents each add real input-token overhead (FR-39) so both
// toggles have an observable, billed effect rather than being inert flags.
const inflate = (base: number, deepResearch: boolean, deepAgents: boolean) =>
  base + (deepResearch ? 600 : 0) + (deepAgents ? 400 : 0);

export async function runTurn(db: DB, cfg: RunTurnCfg, emit: Emit): Promise<RunTurnResult> {
  emit("turn.start", {
    turnId: cfg.turnId,
    conversationId: cfg.conversationId,
    mode: cfg.mode,
    ts: Date.now(),
    // For a freshly-created conversation, hand the client the title+color so it can
    // surface the chat in the sidebar recents right away (no reload needed).
    ...(cfg.newConversation
      ? { newConversation: true, title: cfg.newConversation.title, color: cfg.newConversation.color }
      : {}),
  });

  const fee = PLATFORM_FEE_MICRO();
  // Injected context-memory adds real input tokens to the single + fusion calls;
  // count them so the cost ledger reflects what was actually sent (experts omit it).
  const memTok = cfg.memory ? estTok(cfg.memory) : 0;
  // Conversation history is sent to EVERY model call (single, experts, fusion); count its
  // tokens so the input billing reflects the real multi-turn payload.
  const historyTok = (cfg.history ?? []).reduce((a, m) => a + estTok(m.content), 0);
  let turnStatus: "done" | "partial" | "failed" = "done";
  let payload: Record<string, unknown>;
  let routedModelId: string | undefined;

  // running rollup
  let tokens = 0;
  let costMicro = 0;
  let callCount = 0;

  const persistUsage = async (
    role: "single" | "expert" | "fusion" | "research",
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    reasoningTokens: number,
    latencyMs: number,
    status: "ok" | "error" | "partial",
  ) => {
    const billed = billCall({ inputTokens, outputTokens, reasoningTokens }, modelId);
    await writeUsage(db, {
      requestId: cfg.requestId,
      userId: cfg.userId,
      conversationId: cfg.conversationId,
      turnId: cfg.turnId,
      messageId: null,
      modelId,
      role,
      inputTokens,
      outputTokens,
      reasoningTokens,
      costMicro: billed.costMicro,
      platformFeeMicro: billed.platformFeeMicro,
      latencyMs,
      status,
      meta: billed.pricingFallback ? { pricingFallback: true } : null,
    });
    tokens += inputTokens + outputTokens + reasoningTokens;
    costMicro += billed.costMicro;
    callCount += 1;
    return billed;
  };

  // ---- Deep Research: real web retrieval (real account + OpenRouter key) ----
  // Runs once up front; its sources are surfaced to the UI and its findings are
  // injected (with the memory) into the answer-producing calls. Billed as a call.
  let researchSources: ResearchSource[] = [];
  let researchPreamble: string | undefined;
  if (cfg.deepResearch && researchConfigured()) {
    emit("research.start", {});
    const tR0 = performance.now();
    const research = await webSearch(cfg.prompt, cfg.lang, cfg.signal);
    if (research && research.sources.length) {
      researchSources = research.sources;
      researchPreamble = formatResearchForPrompt(research);
      emit("research.sources", { sources: research.sources });
      await persistUsage(
        "research",
        "deepseek-flash",
        research.inputTokens,
        research.outputTokens,
        0,
        Math.round(performance.now() - tR0),
        "ok",
      );
    }
  }
  // Combined preamble injected into single + fusion (experts stay lean).
  const answerPreamble = [cfg.memory, researchPreamble].filter(Boolean).join("\n\n---\n\n") || undefined;

  if (cfg.mode === "fast") {
    let modelId = cfg.mainModel;
    let routeText: string | null = null;
    if (cfg.auto) {
      // Prefer the intent-classifier routing (resolves follow-ups via standalone_query); the
      // regex route() remains the safety net inside routeFromIntent and when no intent was computed.
      const r = cfg.intent
        ? routeFromIntent(cfg.intent, cfg.lang, cfg.enabledSet)
        : route(cfg.prompt, cfg.lang, cfg.enabledSet);
      modelId = r.id;
      routeText = r.routeText;
      routedModelId = r.id;
      emit("route", { modelId: r.id, label: r.label, routeText: r.routeText, fallback: r.fallback });
    }
    const callId = randomUUID();
    emit("call.start", { callId, modelId, role: "single" });
    const inputTokens = inflate(estTok(cfg.prompt) + 180 + memTok + historyTok, cfg.deepResearch, cfg.deepAgents);
    const t0 = performance.now();
    const call = await streamOne({
      role: "single",
      modelId,
      prompt: cfg.prompt,
      lang: cfg.lang,
      memory: answerPreamble,
      history: cfg.history,
      signal: cfg.signal,
      onDelta: (delta) => emit("call.delta", { callId, modelId, role: "single", delta }),
    });
    const latency = Math.round(performance.now() - t0);
    if (cfg.signal?.aborted) {
      // Client disconnected mid-stream — do not bill a truncated call; turn is partial.
      turnStatus = "partial";
      payload = { routeText, single: { modelId, text: call.text, inputTokens, outputTokens: 0, costMicro: 0, platformFeeMicro: 0 } };
    } else if (call.status === "error") {
      // Fatal for fast mode: emit the error, mark the turn failed, bill nothing.
      emit("call.error", { callId, modelId, role: "single", code: "PROVIDER_ERROR" });
      await db.update(turns).set({ status: "failed" }).where(eq(turns.id, cfg.turnId));
      throw Object.assign(new Error("Provider error"), { code: "PROVIDER_ERROR" });
    } else {
      const billed = await persistUsage("single", modelId, inputTokens, call.outputTokens, 0, latency, "ok");
      emit("call.usage", {
        callId,
        modelId,
        role: "single",
        inputTokens,
        outputTokens: call.outputTokens,
        reasoningTokens: 0,
        costMicro: billed.costMicro,
        platformFeeMicro: billed.platformFeeMicro,
        status: "ok",
      });
      payload = {
        routeText,
        single: {
          modelId,
          text: call.text,
          inputTokens,
          outputTokens: call.outputTokens,
          costMicro: billed.costMicro,
          platformFeeMicro: billed.platformFeeMicro,
        },
      };
    }
  } else {
    // ---- expert mode ----
    // Experts deliberately do NOT receive cfg.memory: they give independent raw
    // takes, and the compiler (fusion-reason/answer) personalizes the synthesis —
    // this keeps the memory preamble out of 3 parallel calls (token frugality).
    const compiler = cfg.mainModel;
    const experts = await Promise.all(
      cfg.trio.map(async (modelId, i) => {
        const callId = randomUUID();
        emit("call.start", { callId, modelId, role: "expert", index: i });
        const inputTokens = inflate(estTok(cfg.prompt) + 180 + historyTok, cfg.deepResearch, cfg.deepAgents);
        const t0 = performance.now();
        const call = await streamOne({
          role: "expert",
          modelId,
          prompt: cfg.prompt,
          lang: cfg.lang,
          history: cfg.history,
          signal: cfg.signal,
          onDelta: (delta) => emit("call.delta", { callId, modelId, role: "expert", index: i, delta }),
        });
        const latency = Math.round(performance.now() - t0);
        if (call.status === "error" || cfg.signal?.aborted) {
          // Failed or truncated-by-abort experts are excluded from fusion and NOT billed.
          if (call.status === "error") {
            emit("call.error", { callId, modelId, role: "expert", index: i, code: "PROVIDER_ERROR" });
          }
          return { modelId, ok: false as const, text: "", inputTokens, outputTokens: 0, latency };
        }
        return { modelId, ok: true as const, text: call.text, inputTokens, outputTokens: call.outputTokens, latency };
      }),
    );

    const surviving = experts.filter((e) => e.ok);
    if (surviving.length < experts.length) turnStatus = "partial";

    const expertPayload = [];
    for (const e of experts) {
      if (!e.ok) {
        expertPayload.push({ modelId: e.modelId, text: "", inputTokens: e.inputTokens, outputTokens: 0, costMicro: 0, platformFeeMicro: 0, status: "error" });
        continue;
      }
      const billed = await persistUsage("expert", e.modelId, e.inputTokens, e.outputTokens, 0, e.latency, "ok");
      emit("call.usage", {
        modelId: e.modelId,
        role: "expert",
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        reasoningTokens: 0,
        costMicro: billed.costMicro,
        platformFeeMicro: billed.platformFeeMicro,
        status: "ok",
      });
      expertPayload.push({ modelId: e.modelId, text: e.text, inputTokens: e.inputTokens, outputTokens: e.outputTokens, costMicro: billed.costMicro, platformFeeMicro: billed.platformFeeMicro, status: "ok" });
    }

    if (surviving.length === 0) {
      // Every expert failed — emit a typed error, bill NO fusion, mark the turn failed (NFR-16).
      emit("error", { code: "ALL_EXPERTS_FAILED", message: "All experts failed", requestId: cfg.requestId });
      turnStatus = "failed";
      payload = { experts: expertPayload };
    } else if (cfg.signal?.aborted) {
      // Client disconnected before fusion — do not run or bill the compiler; partial turn (NFR-17).
      turnStatus = "partial";
      payload = { experts: expertPayload };
    } else {
      // ---- fusion: reasoning trace, then consolidated answer ----
      // The compiler receives the surviving experts' FULL answers so it can actually
      // merge their content — keeping the strongest points from each, not re-answering blind.
      const expertAnswers = surviving.map((e) => ({
        name: MODEL_MAP[e.modelId]?.name ?? e.modelId,
        text: e.text,
      }));
      emit("reason.start", { modelId: compiler });
      const tF0 = performance.now();
      const reason = await streamOne({
        role: "fusion-reason",
        modelId: compiler,
        prompt: cfg.prompt,
        lang: cfg.lang,
        trio: cfg.trio,
        expertAnswers,
        memory: answerPreamble,
        history: cfg.history,
        signal: cfg.signal,
        onDelta: (delta) => emit("reason.delta", { delta }),
      });
      // The reasoning trace is best-effort. If the compiler fails to produce it (e.g. a transient
      // error), degrade gracefully — proceed to the consolidated answer (which carries the full
      // expert context) rather than failing the turn — but surface that reasoning was unavailable
      // instead of silently emitting an empty trace as if the reasoning phase had succeeded.
      const reasonFailed = reason.status === "error";
      const reasonTrace = reasonFailed ? "" : reason.text;
      if (reasonFailed) {
        log.warn("fusion.reason_failed", { requestId: cfg.requestId, modelId: compiler, error: reason.error });
      }
      const reasoningTokens = estTok(reasonTrace);
      emit("reason.done", { reasoningTokens, ...(reasonFailed ? { failed: true } : {}) });

      const answer = await streamOne({
        role: "fusion-answer",
        modelId: compiler,
        prompt: cfg.prompt,
        lang: cfg.lang,
        trio: cfg.trio,
        expertAnswers,
        memory: answerPreamble,
        history: cfg.history,
        signal: cfg.signal,
        onDelta: (delta) => emit("answer.delta", { delta }),
      });
      const fusionLatency = Math.round(performance.now() - tF0);
      // Input the compiler actually receives: the user prompt + a small instruction overhead +
      // injected memory + every surviving expert's full answer (now genuinely sent). The compiler
      // also receives the Deep Research / Agents preamble, so apply the same inflate() overhead the
      // single + expert calls use — otherwise that context is sent but not billed.
      const fusionInput = inflate(
        estTok(cfg.prompt) + 200 + memTok + historyTok + surviving.reduce((a, e) => a + estTok(e.text), 0),
        cfg.deepResearch,
        cfg.deepAgents,
      );

      if (answer.status === "error") {
        // The compiler failed (e.g. rate-limited). Keep the experts visible, surface the
        // error inline on the fusion card, and bill NOTHING for the failed compile.
        emit("answer.error", { modelId: compiler, message: answer.error || "The compiler model is unavailable" });
        turnStatus = "partial";
        payload = {
          experts: expertPayload,
          fusion: {
            modelId: compiler,
            reasonText: reasonTrace,
            ...(reasonFailed ? { reasonFailed: true } : {}),
            answerText: "",
            answerError: answer.error || "The compiler model is unavailable",
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens,
            costMicro: 0,
            platformFeeMicro: 0,
          },
        };
      } else {
        // Success: bill the single fusion record (reason + answer compile = one compiler unit).
        const billedFusion = await persistUsage(
          "fusion",
          compiler,
          fusionInput,
          answer.outputTokens,
          reasoningTokens,
          fusionLatency,
          "ok",
        );
        emit("call.usage", {
          modelId: compiler,
          role: "fusion",
          inputTokens: fusionInput,
          outputTokens: answer.outputTokens,
          reasoningTokens,
          costMicro: billedFusion.costMicro,
          platformFeeMicro: billedFusion.platformFeeMicro,
          status: "ok",
        });

        payload = {
          experts: expertPayload,
          fusion: {
            modelId: compiler,
            reasonText: reasonTrace,
            ...(reasonFailed ? { reasonFailed: true } : {}),
            answerText: answer.text,
            inputTokens: fusionInput,
            outputTokens: answer.outputTokens,
            reasoningTokens,
            costMicro: billedFusion.costMicro,
            platformFeeMicro: billedFusion.platformFeeMicro,
          },
        };
      }
    }
  }

  const feeMicro = fee * callCount;
  const totalMicro = costMicro + feeMicro;

  // attach real research sources so they restore on conversation reload
  if (researchSources.length) payload.sources = researchSources;

  // persist assistant message + flip turn status — atomically, so the turn is never left
  // "streaming" with an orphan message (or marked done with no message) on a mid-write failure.
  const messageId = randomUUID();
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id: messageId,
      conversationId: cfg.conversationId,
      turnId: cfg.turnId,
      role: "assistant",
      mode: cfg.mode,
      payloadJson: JSON.stringify(payload),
      seq: 1,
      createdAt: now,
    });
    await tx.update(turns).set({ status: turnStatus }).where(eq(turns.id, cfg.turnId));
  });

  emit("turn.usage", {
    turnTok: tokens,
    turnCostMicro: costMicro,
    turnFeeMicro: feeMicro,
    turnTotalMicro: totalMicro,
    callCount,
  });
  emit("turn.done", { turnId: cfg.turnId, status: turnStatus, messageId });

  return {
    status: turnStatus,
    messageId,
    routedModelId,
    rollup: { tokens, costMicro, feeMicro, totalMicro, callCount },
  };
}

export function modelName(id: string): string {
  return MODEL_MAP[id]?.name ?? id;
}
