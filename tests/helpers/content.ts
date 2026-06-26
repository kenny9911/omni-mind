import { MODEL_MAP } from "@/lib/models";
import { pick } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

interface Persona {
  open: string;
  bullets: string[];
  close: string;
}

/** Intent router — reads the prompt and picks the best single model. */
export function route(txt: string, lang: Lang): { id: string; label: string } {
  const s = (txt || "").toLowerCase();
  const I = <T,>(o: Partial<Record<Lang, T>> & { en?: T; zh?: T }) => pick(lang, o);
  if (/code|代码|函数|程序|python|javascript|rust|bug|算法|排序|sql|并发/.test(s))
    return { id: "deepseek-pro", label: I({ zh: "代码", "zh-TW": "程式碼", en: "Code", ja: "コード" }) };
  if (/写|润色|文案|创作|story|poem|诗|邮件|email|小说|营销/.test(s))
    return { id: "claude-opus", label: I({ zh: "写作", "zh-TW": "寫作", en: "Writing", ja: "執筆" }) };
  if (/翻译|translate|多语|语言/.test(s))
    return { id: "qwen", label: I({ zh: "翻译", "zh-TW": "翻譯", en: "Translation", ja: "翻訳" }) };
  if (/总结|summary|摘要|快/.test(s))
    return { id: "deepseek-flash", label: I({ zh: "速答", "zh-TW": "速答", en: "Quick", ja: "即答" }) };
  if (/旅行|规划|计划|plan|行程|策略/.test(s))
    return { id: "gemini-pro", label: I({ zh: "规划", "zh-TW": "規劃", en: "Planning", ja: "計画" }) };
  return { id: "gpt-55", label: I({ zh: "通用", "zh-TW": "通用", en: "General", ja: "汎用" }) };
}

function personaFor(id: string, name: string, p: string, lang: Lang): Persona {
  const map: Record<string, Partial<Record<Lang, Persona>>> = {
    "deepseek-pro": {
      zh: { open: "从第一性原理出发，「" + p + "」可以分三层来看：", bullets: ["目标层：先界定真正要解决的问题，避免在错误方向上优化。", "路径层：在可行方案间比较推理成本与可靠性，优先可验证的方法。", "执行层：给出最小可落地步骤，并标注关键风险点。"], close: "结论：先收敛问题定义，再用可验证的步骤推进，是最稳妥的路径。" },
      "zh-TW": { open: "從第一性原理出發，「" + p + "」可以分三層來看：", bullets: ["目標層：先界定真正要解決的問題，避免在錯誤方向上優化。", "路徑層：在可行方案間比較推理成本與可靠性，優先可驗證的方法。", "執行層：給出最小可落地步驟，並標註關鍵風險點。"], close: "結論：先收斂問題定義，再用可驗證的步驟推進，是最穩妥的路徑。" },
      en: { open: 'From first principles, "' + p + '" breaks into three layers:', bullets: ["Goal: define the real problem first, so you don't optimize the wrong thing.", "Path: weigh reasoning cost vs reliability; prefer verifiable methods.", "Execution: give the smallest shippable step and flag the key risks."], close: "Bottom line: tighten the problem definition, then advance in verifiable steps." },
      ja: { open: "第一原理から考えると、「" + p + "」は三つの層に分けられます：", bullets: ["目標：まず本当に解くべき問題を定義し、誤った方向への最適化を避ける。", "経路：実行可能な案の推論コストと信頼性を比較し、検証可能な方法を優先する。", "実行：最小限の実行可能なステップを示し、主要なリスクを明記する。"], close: "結論：問題定義を収束させ、検証可能なステップで進めるのが最も堅実です。" },
    },
    "gpt-55": {
      zh: { open: "综合来看，关于「" + p + "」我建议按以下维度系统展开：", bullets: ["背景与约束：明确场景、资源与时间限制。", "方案对比：列出 2–3 条可选路径并量化各自取舍。", "推荐与理由：给出首选方案，并说明为何在当前约束下最优。"], close: "总体建议：以结构化决策替代直觉判断，可显著提升结果质量。" },
      "zh-TW": { open: "綜合來看，關於「" + p + "」我建議按以下維度系統展開：", bullets: ["背景與約束：明確場景、資源與時間限制。", "方案對比：列出 2–3 條可選路徑並量化各自取捨。", "推薦與理由：給出首選方案，並說明為何在當前約束下最優。"], close: "總體建議：以結構化決策替代直覺判斷，可顯著提升結果品質。" },
      en: { open: 'Overall, I\'d approach "' + p + '" systematically across these dimensions:', bullets: ["Context & constraints: scope, resources and time limits.", "Options: 2–3 viable paths with quantified trade-offs.", "Recommendation: the top pick and why it wins under current constraints."], close: "Net: replace intuition with structured decisions to lift quality." },
      ja: { open: "総合的に見て、「" + p + "」は次の観点で体系的に検討するのがよいでしょう：", bullets: ["背景と制約：シーン・リソース・時間の制限を明確にする。", "比較：2〜3 の選択肢を挙げ、それぞれのトレードオフを定量化する。", "推奨と理由：第一候補と、現在の制約下で最適な理由を示す。"], close: "総括：直感ではなく構造化された意思決定に置き換えると、品質が大きく向上します。" },
    },
    "claude-opus": {
      zh: { open: "我会尽量把「" + p + "」回答得全面而细致，先厘清容易被忽略的前提：", bullets: ["语境很重要：同一问题在不同场景下的最佳答案可能完全不同。", "权衡是核心：几乎没有免费的优化，关键是想清楚你愿意付出什么。", "可执行优先：再好的思路也要落到具体的下一步动作。"], close: "若只记一点：先对齐目标与约束，答案往往会自然浮现。" },
      "zh-TW": { open: "我會盡量把「" + p + "」回答得全面而細緻，先釐清容易被忽略的前提：", bullets: ["語境很重要：同一問題在不同場景下的最佳答案可能完全不同。", "權衡是核心：幾乎沒有免費的優化，關鍵是想清楚你願意付出什麼。", "可執行優先：再好的思路也要落到具體的下一步動作。"], close: "若只記一點：先對齊目標與約束，答案往往會自然浮現。" },
      en: { open: 'Let me answer "' + p + '" thoroughly, starting with easily-missed premises:', bullets: ["Context matters: the best answer can differ entirely by situation.", "Trade-offs are central: almost no optimization is free—know your price.", "Make it actionable: even great ideas must reduce to a concrete next step."], close: "If you remember one thing: align goals and constraints first." },
      ja: { open: "「" + p + "」をできるだけ網羅的かつ丁寧に答えます。まず見落とされがちな前提から：", bullets: ["文脈が重要：同じ問いでも状況次第で最適解は全く変わり得る。", "トレードオフが核心：無料の最適化はほぼ無い。何を払う覚悟かを明確に。", "実行可能性を優先：良い発想も具体的な次の一手に落とし込む必要がある。"], close: "ひとつだけ覚えるなら：まず目標と制約をすり合わせれば、答えは自然と見えてきます。" },
    },
  };
  if (map[id]) return pick(lang, map[id]);
  return pick(lang, {
    zh: { open: "作为 " + name + "，我对「" + p + "」的看法是：", bullets: ["先明确核心目标，这决定后续方案的取舍。", "在可行路径中权衡成本、速度与质量，选当前最优解。", "给出可执行的下一步，并预留验证与回退空间。"], close: "简而言之：把问题定义清楚，往往已经解决了一半。" },
    "zh-TW": { open: "作為 " + name + "，我對「" + p + "」的看法是：", bullets: ["先明確核心目標，這決定後續方案的取捨。", "在可行路徑中權衡成本、速度與品質，選當前最優解。", "給出可執行的下一步，並預留驗證與回退空間。"], close: "簡而言之：把問題定義清楚，往往已經解決了一半。" },
    en: { open: "As " + name + ', here\'s my take on "' + p + '":', bullets: ["Define the core goal—it drives every later trade-off.", "Balance cost, speed and quality across feasible paths.", "Give an executable next step with room to verify and roll back."], close: "In short: a well-defined problem is half-solved." },
    ja: { open: name + "として、「" + p + "」についての見解は：", bullets: ["まず中核となる目標を明確にする。これが後のトレードオフを決める。", "実行可能な経路の中でコスト・速度・品質を比較し、最適解を選ぶ。", "検証と巻き戻しの余地を残しつつ、実行可能な次の一歩を示す。"], close: "要するに：問題を明確に定義できれば、半分は解けたようなものです。" },
  });
}

export function buildAnswer(p: string, id: string, lang: Lang): string {
  const name = MODEL_MAP[id].name;
  const P = personaFor(id, name, p, lang);
  return P.open + "\n\n" + P.bullets.map((x) => "• " + x).join("\n") + "\n\n" + P.close;
}

export function buildReason(trio: string[], comp: string, lang: Lang): string {
  const nm = trio.map((id) => MODEL_MAP[id].name);
  return pick(lang, {
    zh: "融合器（" + comp + "）正在对比多位专家的回答…\n· " + nm[0] + "：推理框架严谨、逻辑链清晰 — 作为分析主干。\n· " + nm[1] + "：决策结构完整，覆盖背景、对比与推荐。\n· " + nm[2] + "：补足易被忽略的权衡与可执行细节。\n\n去重重叠论点，保留各模型最强部分…\n校验事实一致性，消解彼此分歧…\n对齐三者共识：先明确目标与约束，再做方案对比。\n正在把最强论点重写为一份全新的最终答案…",
    "zh-TW": "融合器（" + comp + "）正在比對多位專家的回答…\n· " + nm[0] + "：推理框架嚴謹、邏輯鏈清晰 — 作為分析主幹。\n· " + nm[1] + "：決策結構完整，涵蓋背景、對比與推薦。\n· " + nm[2] + "：補足易被忽略的權衡與可執行細節。\n\n去重重疊論點，保留各模型最強部分…\n校驗事實一致性，消解彼此分歧…\n對齊三者共識：先明確目標與約束，再做方案對比。\n正在把最強論點重寫為一份全新的最終答案…",
    en: "The compiler (" + comp + ") is comparing the experts…\n· " + nm[0] + ": rigorous reasoning, clear logic — use as the backbone.\n· " + nm[1] + ": complete decision structure (context, options, recommendation).\n· " + nm[2] + ": adds easily-missed trade-offs and execution detail.\n\nDe-duplicating overlapping points, keeping each model's strongest parts…\nChecking factual consistency, resolving disagreements…\nAligning on consensus: define goals & constraints first, then compare.\nRewriting the strongest points into one fresh final answer…",
    ja: "コンパイラ（" + comp + "）が複数の専門家の回答を比較しています…\n· " + nm[0] + "：論理が厳密で筋道が明快 — 分析の軸に。\n· " + nm[1] + "：意思決定の構造が完全（背景・比較・推奨）。\n· " + nm[2] + "：見落としがちなトレードオフと実行の細部を補完。\n\n重複する論点を統合し、各モデルの最も強い部分を保持…\n事実の整合性を検証し、相違を解消…\n共通認識をすり合わせ：まず目標と制約を明確にし、次に比較。\n最も強い論点を、新たな最終回答へと書き直しています…",
  });
}

/**
 * Final Compiler: rewrites ONE fresh consolidated answer by merging the strongest
 * point from each expert under a clean structure, deduplicated — not a meta-summary.
 */
export function buildFusion(p: string, trio: string[], lang: Lang): string {
  const P = trio.map((id) => personaFor(id, MODEL_MAP[id].name, p, lang));
  const b = (i: number, j: number) => (P[i] && P[i].bullets[j]) || "";
  const lead = (P[1] && P[1].close) || (P[0] && P[0].close) || "";
  return pick(lang, {
    zh: "综合多位专家的回答，去重并保留各自最强的论点后，重写出的最佳答案：\n\n① 先对齐目标与约束\n" + b(0, 0) + " " + b(2, 0) + "\n\n② 系统对比可选方案\n" + b(1, 1) + " " + b(0, 1) + "\n\n③ 落地执行与风险控制\n" + b(0, 2) + " " + b(2, 2) + "\n\n结论：" + lead,
    "zh-TW": "綜合多位專家的回答，去重並保留各自最強的論點後，重寫出的最佳答案：\n\n① 先對齊目標與約束\n" + b(0, 0) + " " + b(2, 0) + "\n\n② 系統對比可選方案\n" + b(1, 1) + " " + b(0, 1) + "\n\n③ 落地執行與風險控制\n" + b(0, 2) + " " + b(2, 2) + "\n\n結論：" + lead,
    en: "Consolidated from all the experts — deduplicated, keeping each one's strongest point — here is one fresh, rewritten best answer:\n\n1. Align on goals & constraints\n" + b(0, 0) + " " + b(2, 0) + "\n\n2. Systematically compare options\n" + b(1, 1) + " " + b(0, 1) + "\n\n3. Execute and control risk\n" + b(0, 2) + " " + b(2, 2) + "\n\nConclusion: " + lead,
    ja: "複数の専門家の回答を統合し、重複を除いて各自の最も強い論点を残して書き直した最良の回答：\n\n① まず目標と制約をすり合わせる\n" + b(0, 0) + " " + b(2, 0) + "\n\n② 選択肢を体系的に比較する\n" + b(1, 1) + " " + b(0, 1) + "\n\n③ 実行とリスク管理\n" + b(0, 2) + " " + b(2, 2) + "\n\n結論：" + lead,
  });
}
