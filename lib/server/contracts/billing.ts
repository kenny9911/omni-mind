import { z } from "zod";
import { PlanEnum } from "./common";

/**
 * Billing & Subscription (US7) zod schemas + DTO shapes.
 * See docs/technical-design.md §2.5. Money is integer micro-CNY.
 */

/** POST /api/billing/subscription — change plan. */
export const ChangePlanBody = z.object({
  planId: PlanEnum,
});
export type ChangePlanBodyT = z.infer<typeof ChangePlanBody>;

/** POST /api/billing/topup — ¥1–¥1000 in micro-CNY. */
export const TopupBody = z.object({
  amountMicro: z.number().int().min(1_000_000).max(1_000_000_000),
});
export type TopupBodyT = z.infer<typeof TopupBody>;

/** PUT /api/billing/payment-method. No PAN/CVV ever; only display-safe fields. */
export const PaymentMethodBody = z.object({
  brand: z.enum(["visa", "mastercard", "unionpay", "amex", "alipay", "wechat"]),
  last4: z.string().regex(/^\d{4}$/, "last4 must be 4 digits"),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2024).max(2099),
});
export type PaymentMethodBodyT = z.infer<typeof PaymentMethodBody>;

export interface InvoiceLineItem {
  label: string;
  amountMicro: number;
}

/** Parse the stored line_items_json into a typed array (tolerant of null/garbage). */
export function parseLineItems(raw: string | null | undefined): InvoiceLineItem[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x.label === "string" && Number.isFinite(x.amountMicro))
      .map((x) => ({ label: String(x.label), amountMicro: Math.trunc(x.amountMicro) }));
  } catch {
    return [];
  }
}
