import { PRICE_MAP } from "@/lib/models";

/**
 * Cost accounting in integer micro-CNY (1 ¥ = 1_000_000 micro) — exact, no float drift.
 * Model prices are ¥ per 1M tokens, so ¥/1M × tokens / 1e6 × 1e6(micro) == price × tokens.
 * Reasoning tokens are billed at the output price (they are generated output).
 * See docs/technical-design.md §3.5.
 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export const PLATFORM_FEE_MICRO = (): number => {
  const cny = Number(process.env.PLATFORM_FEE_CNY ?? "0.05");
  return Math.round((Number.isFinite(cny) ? cny : 0.05) * 1_000_000);
};

export function modelCostMicro(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  modelId: string,
): { costMicro: number; pricingFallback: boolean } {
  const p = PRICE_MAP[modelId];
  const price = p || { in: 5, out: 15 };
  const costMicro =
    Math.round(inputTokens * price.in) +
    Math.round((outputTokens + reasoningTokens) * price.out);
  return { costMicro, pricingFallback: !p };
}

export interface BilledCall extends Usage {
  modelId: string;
  costMicro: number;
  platformFeeMicro: number;
  pricingFallback: boolean;
}

export function billCall(usage: Usage, modelId: string): BilledCall {
  const { costMicro, pricingFallback } = modelCostMicro(
    usage.inputTokens,
    usage.outputTokens,
    usage.reasoningTokens,
    modelId,
  );
  return {
    ...usage,
    modelId,
    costMicro,
    platformFeeMicro: PLATFORM_FEE_MICRO(),
    pricingFallback,
  };
}

export const microToCny = (micro: number): number => micro / 1_000_000;
export const cnyToMicro = (cny: number): number => Math.round(cny * 1_000_000);

/** Format micro-CNY the way the UI does (mirrors lib/accounting fmtMoney). */
export function formatMicro(micro: number): string {
  const n = microToCny(micro);
  if (n >= 1) return "¥" + n.toFixed(2);
  if (n >= 0.001 || n === 0) return "¥" + n.toFixed(4);
  return "¥" + n.toFixed(6);
}
