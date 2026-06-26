import { pick } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export type PlanId = "free" | "pro" | "team" | "ent";

export interface PlanDef {
  id: PlanId;
  name: string;
  priceMicro: number | null; // null = custom (Enterprise)
  /** included monthly model credit in micro-CNY; null = custom */
  includedCreditMicro: number | null;
  requiresSales: boolean;
}

export const PLANS: PlanDef[] = [
  { id: "free", name: "Free", priceMicro: 0, includedCreditMicro: 0, requiresSales: false },
  { id: "pro", name: "Pro", priceMicro: 199_000_000, includedCreditMicro: 150_000_000, requiresSales: false },
  { id: "team", name: "Team", priceMicro: 899_000_000, includedCreditMicro: 750_000_000, requiresSales: false },
  { id: "ent", name: "Enterprise", priceMicro: null, includedCreditMicro: null, requiresSales: true },
];

export const PLAN_MAP: Record<PlanId, PlanDef> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
) as Record<PlanId, PlanDef>;

export function includedCreditFor(planId: PlanId): number {
  const c = PLAN_MAP[planId]?.includedCreditMicro;
  return c == null ? 0 : c;
}

/** Localized feature bullets, mirroring the frontend plan cards (lib/viewModel.ts). */
export function planFeatures(planId: PlanId, lang: Lang): string[] {
  const L = (o: Partial<Record<Lang, string[]>> & { en?: string[]; zh?: string[] }) => pick(lang, o);
  switch (planId) {
    case "free":
      return L({ zh: ["每日 20 次调用", "仅快速模式", "基础模型", "社区支持"], "zh-TW": ["每日 20 次調用", "僅快速模式", "基礎模型", "社群支援"], en: ["20 calls / day", "Fast mode only", "Base models", "Community support"], ja: ["1 日 20 回", "高速モードのみ", "基本モデル", "コミュニティ"] });
    case "pro":
      return L({ zh: ["含 ¥150 模型额度", "快速 + 多专家模式", "全部 12 模型 + OpenRouter", "深度研究 / 智能体", "超额按量计费"], "zh-TW": ["含 ¥150 模型額度", "快速 + 多專家模式", "全部 12 模型 + OpenRouter", "深度研究 / 智能體", "超額按量計費"], en: ["¥150 model credit", "Fast + Multi-expert", "All 12 models + OpenRouter", "Deep Research / Agents", "Usage-based overage"], ja: ["¥150 のモデルクレジット", "高速 + マルチエキスパート", "全 12 モデル + OpenRouter", "ディープリサーチ / エージェント", "超過は従量課金"] });
    case "team":
      return L({ zh: ["含 ¥750 共享额度", "5 个席位", "用量看板与导出", "API 接入", "SSO 单点登录"], "zh-TW": ["含 ¥750 共享額度", "5 個席位", "用量看板與匯出", "API 接入", "SSO 單一登入"], en: ["¥750 shared credit", "5 seats", "Usage analytics & export", "API access", "SSO"], ja: ["¥750 の共有クレジット", "5 席", "使用量分析とエクスポート", "API アクセス", "SSO"] });
    case "ent":
      return L({ zh: ["不限席位", "私有化 / VPC 部署", "自定义模型接入", "SLA 保障", "安全合规审计"], "zh-TW": ["不限席位", "私有化 / VPC 部署", "自訂模型接入", "SLA 保障", "安全合規稽核"], en: ["Unlimited seats", "Private / VPC deploy", "Custom model hookup", "SLA", "Compliance audit"], ja: ["席数無制限", "プライベート / VPC 配置", "カスタムモデル接続", "SLA", "コンプライアンス監査"] });
  }
}

export function planName(planId: PlanId, lang: Lang): string {
  if (planId === "ent") return PLAN_MAP.ent.name;
  return PLAN_MAP[planId].name;
}

export function planPeriod(planId: PlanId, lang: Lang): string {
  if (planId === "free" || planId === "ent") return "";
  return pick(lang, { zh: "/月", "zh-TW": "/月", en: "/mo", ja: "/月" });
}
