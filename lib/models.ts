import type { ModelDef } from "./types";

// Tag translation tables (Simplified → Traditional / Japanese), ported verbatim.
const TT: Record<string, string> = {
  推理: "推理",
  代码: "程式碼",
  高速: "高速",
  性价比: "性價比",
  中文: "中文",
  通用: "通用",
  多模态: "多模態",
  长文本: "長文本",
  Agent: "Agent",
  创作: "創作",
  角色: "角色",
  多语言: "多語言",
  旗舰: "旗艦",
  复杂任务: "複雜任務",
};

const TJ: Record<string, string> = {
  推理: "推論",
  代码: "コード",
  高速: "高速",
  性价比: "コスパ",
  中文: "中国語",
  通用: "汎用",
  多模态: "マルチモーダル",
  长文本: "長文",
  Agent: "Agent",
  创作: "創作",
  角色: "ロールプレイ",
  多语言: "多言語",
  旗舰: "フラッグシップ",
  复杂任务: "複雑タスク",
};

interface RawModel {
  id: string;
  name: string;
  vendor: string;
  color: string;
  initials: string;
  tier: ModelDef["tier"];
  tags: string[];
  tagsEn: string[];
  ctx: string;
  pin: number;
  pout: number;
}

const RAW: RawModel[] = [
  { id: "deepseek-pro", name: "DeepSeek V4 Pro", vendor: "DeepSeek", color: "#4d6bfe", initials: "DS", tier: "flagship", tags: ["推理", "代码"], tagsEn: ["Reasoning", "Code"], ctx: "128K", pin: 4, pout: 12 },
  { id: "deepseek-flash", name: "DeepSeek V4 Flash", vendor: "DeepSeek", color: "#7aa2ff", initials: "DF", tier: "fast", tags: ["高速", "性价比"], tagsEn: ["Fast", "Value"], ctx: "128K", pin: 1, pout: 2 },
  { id: "glm", name: "GLM 5.2", vendor: "Zhipu AI", color: "#2f7cff", initials: "GL", tier: "balanced", tags: ["中文", "通用"], tagsEn: ["Chinese", "General"], ctx: "200K", pin: 5, pout: 15 },
  { id: "doubao", name: "Doubao", vendor: "ByteDance", color: "#00bcd4", initials: "DB", tier: "fast", tags: ["多模态", "性价比"], tagsEn: ["Multimodal", "Value"], ctx: "256K", pin: 0.8, pout: 2 },
  { id: "kimi", name: "Kimi K2.7", vendor: "Moonshot", color: "#8a7bff", initials: "KM", tier: "balanced", tags: ["长文本", "Agent"], tagsEn: ["Long-ctx", "Agent"], ctx: "1M", pin: 4, pout: 16 },
  { id: "minimax", name: "MiniMax M3", vendor: "MiniMax", color: "#ff4d6d", initials: "MM", tier: "balanced", tags: ["创作", "角色"], tagsEn: ["Creative", "Roleplay"], ctx: "245K", pin: 3, pout: 12 },
  { id: "qwen", name: "Qwen", vendor: "Alibaba", color: "#615ced", initials: "QW", tier: "balanced", tags: ["多语言", "通用"], tagsEn: ["Multilingual", "General"], ctx: "256K", pin: 4, pout: 12 },
  { id: "gemini-flash", name: "Gemini 3 Flash", vendor: "Google", color: "#4796e3", initials: "GF", tier: "fast", tags: ["高速", "多模态"], tagsEn: ["Fast", "Multimodal"], ctx: "1M", pin: 2, pout: 8 },
  { id: "gemini-pro", name: "Gemini 3.1 Pro", vendor: "Google", color: "#9168ff", initials: "GP", tier: "flagship", tags: ["推理", "多模态"], tagsEn: ["Reasoning", "Multimodal"], ctx: "2M", pin: 10, pout: 40 },
  { id: "gpt-mini", name: "GPT-5.4 mini", vendor: "OpenAI", color: "#19c37d", initials: "5m", tier: "fast", tags: ["通用", "性价比"], tagsEn: ["General", "Value"], ctx: "256K", pin: 3, pout: 12 },
  { id: "gpt-55", name: "GPT-5.5", vendor: "OpenAI", color: "#0e8f6e", initials: "55", tier: "flagship", tags: ["旗舰", "复杂任务"], tagsEn: ["Flagship", "Complex"], ctx: "400K", pin: 20, pout: 80 },
  { id: "claude-opus", name: "Claude Opus 4.8", vendor: "Anthropic", color: "#d97757", initials: "CL", tier: "flagship", tags: ["写作", "Agent"], tagsEn: ["Writing", "Agent"], ctx: "500K", pin: 25, pout: 110 },
];

export const MODELS: ModelDef[] = RAW.map((m) => ({
  ...m,
  tagsTW: m.tags.map((x) => TT[x] || x),
  tagsJa: m.tags.map((x) => TJ[x] || x),
}));

export const MODEL_MAP: Record<string, ModelDef> = Object.fromEntries(
  MODELS.map((m) => [m.id, m]),
);

export const PRICE_MAP: Record<string, { in: number; out: number }> =
  Object.fromEntries(MODELS.map((m) => [m.id, { in: m.pin, out: m.pout }]));

export const OPENROUTER_MODELS = [
  "Llama 4 405B",
  "Mistral Large 3",
  "Grok 4",
  "Command R+",
];
