import type { Lang } from "./types";

/**
 * Pick a localized value, falling back en → zh (matches the prototype's pick()).
 */
export function pick<T>(
  lang: Lang,
  o: Partial<Record<Lang, T>> & { en?: T; zh?: T },
): T {
  const v = o[lang];
  if (v !== undefined) return v;
  if (o.en !== undefined) return o.en;
  return o.zh as T;
}

export interface Dict {
  tagline: string;
  newChat: string;
  recent: string;
  navChat: string;
  navUsage: string;
  navModels: string;
  navBilling: string;
  navProfile: string;
  memTitle: string;
  memHint: string;
  memEmpty: string;
  memClear: string;
  memUpdated: string;
  navUsers: string;
  themeLabel: string;
  proBadge: string;
  fast: string;
  expert: string;
  fastDesc: string;
  expertDesc: string;
  auto: string;
  mainModel: string;
  deepResearch: string;
  deepAgents: string;
  placeholder: string;
  send: string;
  experts: string;
  fusing: string;
  fusedAnswer: string;
  fusedBy: string;
  compiledBy: string;
  thinking: string;
  synthesizing: string;
  waiting: string;
  thinkingProcess: string;
  reasoningUnavailable: string;
  finalAnswer: string;
  copy: string;
  copied: string;
  edit: string;
  rerun: string;
  sourcesLabel: string;
  turnFailed: string;
  thisTurn: string;
  tokens: string;
  cost: string;
  platformFee: string;
  total: string;
  callsX: string;
  emptyTitle: string;
  emptySub: string;
  disclaimer: string;
  usageTitle: string;
  usageSub: string;
  uTotalTokens: string;
  uModelCost: string;
  uPlatformFee: string;
  uTotal: string;
  uReq: string;
  uTrend: string;
  uByModel: string;
  uLedger: string;
  colTime: string;
  colPrompt: string;
  colMode: string;
  colModels: string;
  colTokens: string;
  colMc: string;
  colFee: string;
  colTotal: string;
  creditNote: string;
  modelsTitle: string;
  modelsSub: string;
  context: string;
  inP: string;
  outP: string;
  perM: string;
  enable: string;
  setMain: string;
  isMain: string;
  routeTitle: string;
  routeDesc: string;
  trioTitle: string;
  trioDesc: string;
  gateway: string;
  gatewayDesc: string;
  tierFlagship: string;
  tierFast: string;
  tierBalanced: string;
  billTitle: string;
  billSub: string;
  currentPlan: string;
  included: string;
  used: string;
  remaining: string;
  thisMonth: string;
  modelSpend: string;
  feeSpend: string;
  monthTotal: string;
  topup: string;
  perMonth: string;
  plansTitle: string;
  currentBadge: string;
  invoices: string;
  paymentMethod: string;
  expires: string;
  manage: string;
  collapse: string;
  expand: string;
  resize: string;
  invPaid: string;
  invStatusUnit: string;
  signOut: string;
  // profile
  profileTitle: string;
  profileSub: string;
  accountInfo: string;
  memberSince: string;
  changeName: string;
  currentPassword: string;
  newPassword: string;
  save: string;
  saved: string;
  changePassword: string;
  usageStats: string;
  demoReadonly: string;
  // user management
  userMgmtTitle: string;
  userMgmtSub: string;
  colUser: string;
  colRole: string;
  colPlan: string;
  colCalls: string;
  colSpend: string;
  colJoined: string;
  colLastActive: string;
  colActions: string;
  roleUser: string;
  roleAdmin: string;
  deleteUser: string;
  confirmDelete: string;
  noUsers: string;
  colStatus: string;
  statusActive: string;
  statusSuspended: string;
  newUser: string;
  createUserTitle: string;
  formName: string;
  formEmail: string;
  formPassword: string;
  formRole: string;
  formPlan: string;
  create: string;
  creating: string;
  cancel: string;
  resetPassword: string;
  resetPwPrompt: string;
  passwordTooShort: string;
  suspend: string;
  reactivate: string;
  confirmSuspend: string;
  errEmailTaken: string;
  errValidation: string;
  errDemoteSelf: string;
  errSuspendSelf: string;
  errDeleteSelf: string;
  errModifySystem: string;
  errForbidden: string;
  researchSteps: string[];
}

const D: Record<Lang, Omit<Dict, "researchSteps">> = {
  zh: {
    tagline: "十二大模型 · 一个最优解", newChat: "新建对话", recent: "近期对话",
    navChat: "对话", navUsage: "用量与费用", navModels: "模型库", navBilling: "订阅计费",
    navProfile: "个人资料", navUsers: "用户管理",
    memTitle: "记住的偏好", memHint: "从你的对话中自动学习的精简记忆，仅你可见，会注入到回答中。", memEmpty: "暂无记忆——继续对话，有用的背景会自动出现在这里。", memClear: "清除", memUpdated: "更新于",
    themeLabel: "主题", proBadge: "Pro 会员",
    fast: "快速模式", expert: "多专家模式", fastDesc: "单模型 · 极速直答", expertDesc: "多专家并行 · 智能融合",
    auto: "自动调度", mainModel: "主模型", deepResearch: "深度研究", deepAgents: "深度智能体",
    placeholder: "输入任意问题，让最合适的模型为你解答…", send: "发送",
    experts: "专家模型并行", fusing: "智能融合", fusedAnswer: "融合答案", fusedBy: "综合多个专家的最优论点", compiledBy: "融合器",
    thinking: "思考中", synthesizing: "融合中", waiting: "等待专家回答完成…", thinkingProcess: "思考过程", reasoningUnavailable: "本次推理过程不可用（已直接生成答案）", finalAnswer: "最终答案", copy: "复制", copied: "已复制", edit: "编辑", rerun: "重新生成", sourcesLabel: "来源",
    turnFailed: "请求未完成",
    thisTurn: "本次用量", tokens: "Tokens", cost: "成本", platformFee: "平台费", total: "合计", callsX: " 次调用",
    emptyTitle: "问一次，多个专家为你作答", emptySub: "快速模式让最合适的单模型极速直答；多专家模式并行调用多个模型，再融合出最优答案。每一次 Token 消耗与费用全程透明、精确可查。",
    disclaimer: "按 Enter 发送，Shift+Enter 换行 · 所有用量与费用实时计入用量账单",
    usageTitle: "用量与费用", usageSub: "精确到每一次模型调用的 Token 消耗与成本",
    uTotalTokens: "总 Tokens", uModelCost: "模型成本", uPlatformFee: "平台调用费", uTotal: "总计费用", uReq: "请求次数",
    uTrend: "近 7 日费用趋势", uByModel: "各模型成本占比", uLedger: "调用明细",
    colTime: "时间", colPrompt: "提示词", colMode: "模式", colModels: "模型", colTokens: "Tokens", colMc: "模型成本", colFee: "平台费", colTotal: "合计",
    creditNote: "额度用尽后，按各模型实际 Token 单价 + 每次调用平台费计费",
    modelsTitle: "模型库", modelsSub: "12 个主流大模型 + OpenRouter 网关，按需启用、按量计费",
    context: "上下文", inP: "输入", outP: "输出", perM: "/百万", enable: "启用", setMain: "设为主模型", isMain: "主模型 ✓",
    routeTitle: "智能调度", routeDesc: "主模型理解你的意图，自动把问题路由到最合适的模型；你也可以固定指定一个主模型。",
    trioTitle: "多专家默认组合", trioDesc: "多专家模式下并行调用，由主模型融合",
    gateway: "网关", gatewayDesc: "通过 OpenRouter 一键接入 300+ 第三方模型，统一计费与用量统计。",
    tierFlagship: "旗舰", tierFast: "高速", tierBalanced: "均衡",
    billTitle: "订阅与计费", billSub: "订阅含额度，超出部分按 Token 用量 + 调用次数计费",
    currentPlan: "当前套餐", included: "包含额度", used: "本月已用", remaining: "剩余",
    thisMonth: "本月账单", modelSpend: "模型成本", feeSpend: "平台调用费", monthTotal: "本月合计", topup: "充值额度", perMonth: "/月",
    plansTitle: "订阅套餐", currentBadge: "当前", invoices: "账单记录", paymentMethod: "支付方式", expires: "有效期", manage: "管理",
    collapse: "收起侧边栏", expand: "展开侧边栏", resize: "拖动调整宽度",
    invPaid: "已支付", invStatusUnit: "",
    signOut: "退出登录",
    profileTitle: "个人资料", profileSub: "管理你的账户信息与安全设置",
    accountInfo: "账户信息", memberSince: "注册于", changeName: "显示名称",
    currentPassword: "当前密码", newPassword: "新密码", save: "保存", saved: "已保存", changePassword: "修改密码",
    usageStats: "累计用量", demoReadonly: "演示账户为只读，无法修改资料或密码。",
    userMgmtTitle: "用户管理", userMgmtSub: "管理全部用户的角色、套餐与访问权限",
    colUser: "用户", colRole: "角色", colPlan: "套餐", colCalls: "调用次数", colSpend: "消费", colJoined: "注册时间", colLastActive: "最近活跃", colActions: "操作",
    roleUser: "普通用户", roleAdmin: "管理员", deleteUser: "删除", confirmDelete: "确定删除该用户？此操作不可撤销。", noUsers: "暂无用户",
    colStatus: "状态", statusActive: "正常", statusSuspended: "已停用",
    newUser: "新建用户", createUserTitle: "创建新账户",
    formName: "姓名", formEmail: "邮箱", formPassword: "密码", formRole: "角色", formPlan: "套餐",
    create: "创建", creating: "创建中…", cancel: "取消",
    resetPassword: "重置密码", resetPwPrompt: "为该用户输入新密码（至少 8 位）：", passwordTooShort: "密码至少需要 8 位字符",
    suspend: "停用", reactivate: "恢复", confirmSuspend: "确定停用该账户？该用户将被登出且无法登录。",
    errEmailTaken: "该邮箱已被注册", errValidation: "请检查输入内容", errDemoteSelf: "无法移除自己的管理员角色",
    errSuspendSelf: "无法停用自己的账户", errDeleteSelf: "无法删除自己的账户", errModifySystem: "系统账户不可修改", errForbidden: "需要管理员权限",
  },
  en: {
    tagline: "Twelve models · one best answer", newChat: "New chat", recent: "Recent",
    navChat: "Chat", navUsage: "Usage & Cost", navModels: "Models", navBilling: "Billing",
    navProfile: "Profile", navUsers: "User Management",
    memTitle: "What we remember", memHint: "A compact memory learned automatically from your chats — private to you, applied to answers.", memEmpty: "Nothing yet — keep chatting and useful context will appear here.", memClear: "Clear", memUpdated: "Updated",
    themeLabel: "Theme", proBadge: "Pro member",
    fast: "Fast", expert: "Multi-expert", fastDesc: "Single model · instant", expertDesc: "Multiple experts in parallel · fused",
    auto: "Auto-route", mainModel: "Main model", deepResearch: "Deep Research", deepAgents: "Deep Agents",
    placeholder: "Ask anything — the right model will answer…", send: "Send",
    experts: "Experts in parallel", fusing: "Fusion", fusedAnswer: "Fused answer", fusedBy: "best points from multiple experts", compiledBy: "compiled by",
    thinking: "Thinking", synthesizing: "Synthesizing", waiting: "Waiting for experts to finish…", thinkingProcess: "Thinking", reasoningUnavailable: "Reasoning trace unavailable (answer generated directly)", finalAnswer: "Final answer", copy: "Copy", copied: "Copied", edit: "Edit", rerun: "Regenerate", sourcesLabel: "Sources",
    turnFailed: "Couldn't complete",
    thisTurn: "This turn", tokens: "Tokens", cost: "Cost", platformFee: "Platform", total: "Total", callsX: " calls",
    emptyTitle: "Ask once, multiple experts answer", emptySub: "Fast mode routes to the single best model for an instant reply. Multi-expert mode runs multiple models in parallel and fuses them into the best answer. Every token and every cost is tracked precisely.",
    disclaimer: "Enter to send, Shift+Enter for newline · all usage billed in real time",
    usageTitle: "Usage & Cost", usageSub: "Token usage and cost, precise to every single call",
    uTotalTokens: "Total tokens", uModelCost: "Model cost", uPlatformFee: "Platform fees", uTotal: "Total cost", uReq: "Requests",
    uTrend: "Last 7 days", uByModel: "Cost by model", uLedger: "Call ledger",
    colTime: "Time", colPrompt: "Prompt", colMode: "Mode", colModels: "Models", colTokens: "Tokens", colMc: "Model", colFee: "Fee", colTotal: "Total",
    creditNote: "Past your credit: charged per model token price + a platform fee per call",
    modelsTitle: "Model library", modelsSub: "12 leading models + OpenRouter gateway, enabled and billed on demand",
    context: "Context", inP: "In", outP: "Out", perM: "/1M", enable: "Enable", setMain: "Set as main", isMain: "Main ✓",
    routeTitle: "Smart routing", routeDesc: "The main model reads your intent and routes each prompt to the best model — or pin one main model yourself.",
    trioTitle: "Default expert trio", trioDesc: "Run in parallel in multi-expert mode, fused by the main model",
    gateway: "gateway", gatewayDesc: "Tap 300+ third-party models through OpenRouter with unified billing and usage.",
    tierFlagship: "Flagship", tierFast: "Fast", tierBalanced: "Balanced",
    billTitle: "Billing & Subscription", billSub: "Plans include credit; overage billed by token usage + per-call fee",
    currentPlan: "Current plan", included: "Included credit", used: "Used", remaining: "Left",
    thisMonth: "This month", modelSpend: "Model cost", feeSpend: "Platform fees", monthTotal: "Month total", topup: "Top up", perMonth: "/mo",
    plansTitle: "Plans", currentBadge: "Current", invoices: "Invoices", paymentMethod: "Payment method", expires: "Expires", manage: "Manage",
    collapse: "Collapse sidebar", expand: "Expand sidebar", resize: "Drag to resize",
    invPaid: "Paid", invStatusUnit: "",
    signOut: "Sign out",
    profileTitle: "Profile", profileSub: "Manage your account details and security",
    accountInfo: "Account info", memberSince: "Member since", changeName: "Display name",
    currentPassword: "Current password", newPassword: "New password", save: "Save", saved: "Saved", changePassword: "Change password",
    usageStats: "Lifetime usage", demoReadonly: "The demo account is read-only — profile and password can't be changed.",
    userMgmtTitle: "User Management", userMgmtSub: "Manage roles, plans and access for every user",
    colUser: "User", colRole: "Role", colPlan: "Plan", colCalls: "Calls", colSpend: "Spend", colJoined: "Joined", colLastActive: "Last active", colActions: "Actions",
    roleUser: "User", roleAdmin: "Admin", deleteUser: "Delete", confirmDelete: "Delete this user? This cannot be undone.", noUsers: "No users",
    colStatus: "Status", statusActive: "Active", statusSuspended: "Suspended",
    newUser: "New user", createUserTitle: "Create a new account",
    formName: "Name", formEmail: "Email", formPassword: "Password", formRole: "Role", formPlan: "Plan",
    create: "Create", creating: "Creating…", cancel: "Cancel",
    resetPassword: "Reset password", resetPwPrompt: "Enter a new password (min 8 characters) for this user:", passwordTooShort: "Password must be at least 8 characters",
    suspend: "Suspend", reactivate: "Reactivate", confirmSuspend: "Suspend this account? The user will be signed out and unable to log in.",
    errEmailTaken: "A user with this email already exists", errValidation: "Please check the form fields", errDemoteSelf: "You cannot remove your own admin role",
    errSuspendSelf: "You cannot suspend your own account", errDeleteSelf: "You cannot delete your own account", errModifySystem: "System accounts cannot be modified", errForbidden: "Admin access required",
  },
  "zh-TW": {
    tagline: "十二大模型 · 一個最優解", newChat: "新建對話", recent: "近期對話",
    navChat: "對話", navUsage: "用量與費用", navModels: "模型庫", navBilling: "訂閱計費",
    navProfile: "個人資料", navUsers: "用戶管理",
    memTitle: "記住的偏好", memHint: "從你的對話中自動學習的精簡記憶，僅你可見，會注入到回答中。", memEmpty: "暫無記憶——繼續對話，有用的背景會自動出現在這裡。", memClear: "清除", memUpdated: "更新於",
    themeLabel: "主題", proBadge: "Pro 會員",
    fast: "快速模式", expert: "多專家模式", fastDesc: "單模型 · 極速直答", expertDesc: "多專家並行 · 智能融合",
    auto: "自動調度", mainModel: "主模型", deepResearch: "深度研究", deepAgents: "深度智能體",
    placeholder: "輸入任意問題，讓最合適的模型為你解答…", send: "發送",
    experts: "專家模型並行", fusing: "智能融合", fusedAnswer: "融合答案", fusedBy: "綜合多個專家的最優論點", compiledBy: "融合器",
    thinking: "思考中", synthesizing: "融合中", waiting: "等待專家回答完成…", thinkingProcess: "思考過程", reasoningUnavailable: "本次推理過程不可用（已直接生成答案）", finalAnswer: "最終答案", copy: "複製", copied: "已複製", edit: "編輯", rerun: "重新生成", sourcesLabel: "來源",
    turnFailed: "請求未完成",
    thisTurn: "本次用量", tokens: "Tokens", cost: "成本", platformFee: "平台費", total: "合計", callsX: " 次調用",
    emptyTitle: "問一次，多個專家為你作答", emptySub: "快速模式讓最合適的單模型極速直答；多專家模式並行調用多個模型，再融合出最優答案。每一次 Token 消耗與費用全程透明、精確可查。",
    disclaimer: "按 Enter 發送，Shift+Enter 換行 · 所有用量與費用即時計入用量帳單",
    usageTitle: "用量與費用", usageSub: "精確到每一次模型調用的 Token 消耗與成本",
    uTotalTokens: "總 Tokens", uModelCost: "模型成本", uPlatformFee: "平台調用費", uTotal: "總計費用", uReq: "請求次數",
    uTrend: "近 7 日費用趨勢", uByModel: "各模型成本占比", uLedger: "調用明細",
    colTime: "時間", colPrompt: "提示詞", colMode: "模式", colModels: "模型", colTokens: "Tokens", colMc: "模型成本", colFee: "平台費", colTotal: "合計",
    creditNote: "額度用盡後，按各模型實際 Token 單價 + 每次調用平台費計費",
    modelsTitle: "模型庫", modelsSub: "12 個主流大模型 + OpenRouter 網關，按需啟用、按量計費",
    context: "上下文", inP: "輸入", outP: "輸出", perM: "/百萬", enable: "啟用", setMain: "設為主模型", isMain: "主模型 ✓",
    routeTitle: "智能調度", routeDesc: "主模型理解你的意圖，自動把問題路由到最合適的模型；你也可以固定指定一個主模型。",
    trioTitle: "多專家預設組合", trioDesc: "多專家模式下並行調用，由主模型融合",
    gateway: "網關", gatewayDesc: "透過 OpenRouter 一鍵接入 300+ 第三方模型，統一計費與用量統計。",
    tierFlagship: "旗艦", tierFast: "高速", tierBalanced: "均衡",
    billTitle: "訂閱與計費", billSub: "訂閱含額度，超出部分按 Token 用量 + 調用次數計費",
    currentPlan: "目前方案", included: "包含額度", used: "本月已用", remaining: "剩餘",
    thisMonth: "本月帳單", modelSpend: "模型成本", feeSpend: "平台調用費", monthTotal: "本月合計", topup: "儲值額度", perMonth: "/月",
    plansTitle: "訂閱方案", currentBadge: "目前", invoices: "帳單記錄", paymentMethod: "付款方式", expires: "有效期", manage: "管理",
    collapse: "收合側邊欄", expand: "展開側邊欄", resize: "拖曳調整寬度",
    invPaid: "已付款", invStatusUnit: "",
    signOut: "登出",
    profileTitle: "個人資料", profileSub: "管理你的帳戶資訊與安全設定",
    accountInfo: "帳戶資訊", memberSince: "註冊於", changeName: "顯示名稱",
    currentPassword: "目前密碼", newPassword: "新密碼", save: "儲存", saved: "已儲存", changePassword: "修改密碼",
    usageStats: "累計用量", demoReadonly: "示範帳戶為唯讀，無法修改資料或密碼。",
    userMgmtTitle: "用戶管理", userMgmtSub: "管理所有用戶的角色、方案與存取權限",
    colUser: "用戶", colRole: "角色", colPlan: "方案", colCalls: "調用次數", colSpend: "消費", colJoined: "註冊時間", colLastActive: "最近活躍", colActions: "操作",
    roleUser: "一般用戶", roleAdmin: "管理員", deleteUser: "刪除", confirmDelete: "確定刪除該用戶？此操作無法復原。", noUsers: "暫無用戶",
    colStatus: "狀態", statusActive: "正常", statusSuspended: "已停用",
    newUser: "新增用戶", createUserTitle: "建立新帳戶",
    formName: "姓名", formEmail: "電子郵件", formPassword: "密碼", formRole: "角色", formPlan: "方案",
    create: "建立", creating: "建立中…", cancel: "取消",
    resetPassword: "重設密碼", resetPwPrompt: "為該用戶輸入新密碼（至少 8 位）：", passwordTooShort: "密碼至少需要 8 個字元",
    suspend: "停用", reactivate: "恢復", confirmSuspend: "確定停用該帳戶？該用戶將被登出且無法登入。",
    errEmailTaken: "該電子郵件已被註冊", errValidation: "請檢查輸入內容", errDemoteSelf: "無法移除自己的管理員角色",
    errSuspendSelf: "無法停用自己的帳戶", errDeleteSelf: "無法刪除自己的帳戶", errModifySystem: "系統帳戶不可修改", errForbidden: "需要管理員權限",
  },
  ja: {
    tagline: "12 のモデル · ひとつの最適解", newChat: "新規チャット", recent: "最近",
    navChat: "チャット", navUsage: "使用量と料金", navModels: "モデル", navBilling: "サブスク",
    navProfile: "プロフィール", navUsers: "ユーザー管理",
    memTitle: "記憶している情報", memHint: "あなたの会話から自動的に学習したコンパクトな記憶です。あなただけに表示され、回答に反映されます。", memEmpty: "まだありません——会話を続けると、役立つ背景がここに表示されます。", memClear: "消去", memUpdated: "更新",
    themeLabel: "テーマ", proBadge: "Pro 会員",
    fast: "高速モード", expert: "マルチエキスパート", fastDesc: "単一モデル · 即答", expertDesc: "複数モデル並列 · 融合",
    auto: "自動振り分け", mainModel: "メインモデル", deepResearch: "ディープリサーチ", deepAgents: "ディープエージェント",
    placeholder: "なんでも入力してください — 最適なモデルが答えます…", send: "送信",
    experts: "エキスパート並列", fusing: "融合", fusedAnswer: "融合された回答", fusedBy: "複数の専門家の最良の論点を統合", compiledBy: "融合器",
    thinking: "思考中", synthesizing: "融合中", waiting: "専門家の回答を待機中…", thinkingProcess: "思考プロセス", reasoningUnavailable: "推論トレースは利用できません（回答は直接生成されました）", finalAnswer: "最終回答", copy: "コピー", copied: "コピー済み", edit: "編集", rerun: "再生成", sourcesLabel: "出典",
    turnFailed: "完了できませんでした",
    thisTurn: "今回の使用量", tokens: "トークン", cost: "コスト", platformFee: "手数料", total: "合計", callsX: " 回呼出",
    emptyTitle: "一度の質問に、複数の専門家が回答", emptySub: "高速モードは最適な単一モデルが即座に回答。マルチエキスパートモードは複数のモデルを並列で動かし、最良の回答へ融合します。すべてのトークンとコストを正確に記録します。",
    disclaimer: "Enter で送信、Shift+Enter で改行 · すべての使用量と料金はリアルタイムで計上",
    usageTitle: "使用量と料金", usageSub: "1 回ごとの呼び出しまで正確なトークン消費とコスト",
    uTotalTokens: "総トークン", uModelCost: "モデルコスト", uPlatformFee: "プラットフォーム手数料", uTotal: "合計料金", uReq: "リクエスト数",
    uTrend: "過去 7 日間の料金推移", uByModel: "モデル別コスト比率", uLedger: "呼び出し明細",
    colTime: "時刻", colPrompt: "プロンプト", colMode: "モード", colModels: "モデル", colTokens: "トークン", colMc: "モデル", colFee: "手数料", colTotal: "合計",
    creditNote: "クレジット超過後は、各モデルの実トークン単価 + 1 回ごとの手数料で課金",
    modelsTitle: "モデルライブラリ", modelsSub: "主要 12 モデル + OpenRouter ゲートウェイ、必要に応じて有効化・従量課金",
    context: "コンテキスト", inP: "入力", outP: "出力", perM: "/100万", enable: "有効化", setMain: "メインに設定", isMain: "メイン ✓",
    routeTitle: "スマートルーティング", routeDesc: "メインモデルが意図を読み取り、最適なモデルへ自動で振り分けます。任意のモデルに固定することもできます。",
    trioTitle: "デフォルトの専門家トリオ", trioDesc: "マルチエキスパートモードで並列実行し、メインモデルが融合",
    gateway: "ゲートウェイ", gatewayDesc: "OpenRouter 経由で 300+ のサードパーティモデルに接続。課金と使用量を一元管理。",
    tierFlagship: "フラッグシップ", tierFast: "高速", tierBalanced: "バランス",
    billTitle: "請求とサブスクリプション", billSub: "プランにはクレジットを含み、超過分はトークン使用量 + 呼び出し回数で課金",
    currentPlan: "現在のプラン", included: "含まれるクレジット", used: "今月の使用", remaining: "残り",
    thisMonth: "今月の請求", modelSpend: "モデルコスト", feeSpend: "プラットフォーム手数料", monthTotal: "今月合計", topup: "チャージ", perMonth: "/月",
    plansTitle: "プラン", currentBadge: "現在", invoices: "請求履歴", paymentMethod: "支払い方法", expires: "有効期限", manage: "管理",
    collapse: "サイドバーを閉じる", expand: "サイドバーを開く", resize: "ドラッグで幅調整",
    invPaid: "支払済", invStatusUnit: "",
    signOut: "サインアウト",
    profileTitle: "プロフィール", profileSub: "アカウント情報とセキュリティを管理",
    accountInfo: "アカウント情報", memberSince: "登録日", changeName: "表示名",
    currentPassword: "現在のパスワード", newPassword: "新しいパスワード", save: "保存", saved: "保存しました", changePassword: "パスワード変更",
    usageStats: "累計使用量", demoReadonly: "デモアカウントは読み取り専用です。プロフィールやパスワードは変更できません。",
    userMgmtTitle: "ユーザー管理", userMgmtSub: "全ユーザーのロール・プラン・アクセスを管理",
    colUser: "ユーザー", colRole: "ロール", colPlan: "プラン", colCalls: "呼出回数", colSpend: "利用額", colJoined: "登録日", colLastActive: "最終活動", colActions: "操作",
    roleUser: "一般ユーザー", roleAdmin: "管理者", deleteUser: "削除", confirmDelete: "このユーザーを削除しますか？この操作は取り消せません。", noUsers: "ユーザーがいません",
    colStatus: "状態", statusActive: "有効", statusSuspended: "停止中",
    newUser: "新規ユーザー", createUserTitle: "新しいアカウントを作成",
    formName: "名前", formEmail: "メール", formPassword: "パスワード", formRole: "ロール", formPlan: "プラン",
    create: "作成", creating: "作成中…", cancel: "キャンセル",
    resetPassword: "パスワードをリセット", resetPwPrompt: "このユーザーの新しいパスワード（8 文字以上）を入力：", passwordTooShort: "パスワードは 8 文字以上が必要です",
    suspend: "停止", reactivate: "再有効化", confirmSuspend: "このアカウントを停止しますか？ユーザーはログアウトされ、ログインできなくなります。",
    errEmailTaken: "このメールは既に登録されています", errValidation: "入力内容を確認してください", errDemoteSelf: "自分の管理者ロールは解除できません",
    errSuspendSelf: "自分のアカウントは停止できません", errDeleteSelf: "自分のアカウントは削除できません", errModifySystem: "システムアカウントは変更できません", errForbidden: "管理者権限が必要です",
  },
};

// The leading "searched N pages" step is built dynamically from the REAL source
// count (see viewModel); these are the process steps that follow it.
const RESEARCH_STEPS: Record<Lang, string[]> = {
  zh: ["提取关键事实", "交叉验证来源", "综合成答案"],
  "zh-TW": ["提取關鍵事實", "交叉驗證來源", "綜合成答案"],
  en: ["Extracted facts", "Cross-checked sources", "Synthesized"],
  ja: ["重要な事実を抽出", "情報源を相互検証", "回答に統合"],
};

/** Localized "searched N pages" / generic web-lookup label for the research panel. */
export function researchCountLabel(lang: Lang, n: number): string {
  if (n > 0) {
    return { zh: `检索网页 ${n} 篇`, "zh-TW": `檢索網頁 ${n} 篇`, en: `Searched ${n} pages`, ja: `${n} 件のページを検索` }[lang];
  }
  return { zh: "联网检索", "zh-TW": "聯網檢索", en: "Web search", ja: "ウェブ検索" }[lang];
}

export function i18n(lang: Lang): Dict {
  const base = D[lang] || D.en;
  return { ...base, researchSteps: RESEARCH_STEPS[lang] || RESEARCH_STEPS.en };
}
