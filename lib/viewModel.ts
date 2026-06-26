import { MODELS, MODEL_MAP, OPENROUTER_MODELS } from "./models";
import { estTok, respCost, fmtNum, fmtMoney, fmtTime } from "./accounting";
import { i18n, pick, researchCountLabel, type Dict } from "./i18n";
import type { OmniStore } from "./store";
import type {
  AssistantMessage,
  OmniState,
  Lang,
  Theme,
  View,
  StreamCall,
} from "./types";

export type IconKey =
  | "chat"
  | "usage"
  | "models"
  | "billing"
  | "user"
  | "code"
  | "pen"
  | "compare"
  | "map"
  | "spark"
  | "search"
  | "route"
  | "globe"
  | "agent"
  | "coins";

export interface NavItemVM {
  key: View;
  label: string;
  icon: IconKey;
  active: boolean;
  onClick: () => void;
}
export interface RecentVM {
  /** server conversation id (always present for a real conversation) */
  id?: string;
  title: string;
  color: string;
  /** true when this is the currently-open conversation */
  active?: boolean;
  /** present only for real (server) conversations — restores the transcript */
  onClick?: () => void;
  /** inline edit affordance state for this row */
  editing?: "rename" | "confirmDelete" | null;
  /** working rename draft (when editing === "rename") */
  draft?: string;
}
export interface LangOptVM {
  key: Lang;
  label: string;
  active: boolean;
  dot: string;
  fg: string;
  onClick: () => void;
}
export interface ChipVM {
  name: string;
  color: string;
  initials: string;
}
export interface ModelPickVM {
  auto: boolean;
  isModel: boolean;
  name: string;
  sub: string;
  color?: string;
  initials?: string;
  active: boolean;
  bg: string;
  onClick: () => void;
}
export interface TrioPickVM {
  id: string;
  name: string;
  sub: string;
  color: string;
  initials: string;
  selected: boolean;
  /** true when this row is one of the three currently-active experts */
  active: boolean;
  onClick: () => void;
}
export interface SuggestionVM {
  text: string;
  color: string;
  icon: IconKey;
  onClick: () => void;
}

export interface CallVM {
  modelId: string;
  name: string;
  color: string;
  initials: string;
  vendor: string;
  text: string;
  thinking: boolean;
  streaming: boolean;
  done: boolean;
  inTokStr: string;
  outTokStr: string;
  tokStr: string;
  costStr: string;
  onCopy: () => void;
  copied: boolean;
  copyIdle: boolean;
}
export interface FusionVM {
  name: string;
  color: string;
  modelId: string;
  compilerName: string;
  waiting: boolean;
  streaming: boolean;
  showReason: boolean;
  expanded: boolean;
  chevronRot: string;
  reasonText: string;
  reasonActive: boolean;
  reasonStreaming: boolean;
  reasonThinking: boolean;
  reasonDone: boolean;
  showAnswer: boolean;
  answerText: string;
  answerError?: string | null;
  answerThinking: boolean;
  answerStreaming: boolean;
  onToggle: () => void;
  done: boolean;
  onCopy: () => void;
  copied: boolean;
  copyIdle: boolean;
  costStr: string;
}
export interface UserMsgVM {
  id: number;
  isUser: true;
  isAssistant: false;
  text: string;
  onCopy: () => void;
  copied: boolean;
  /** reload this message into the composer to edit & resend */
  onEdit: () => void;
}
export interface AssistantMsgVM {
  id: number;
  isUser: false;
  isAssistant: true;
  isExpert: boolean;
  deepResearch: boolean;
  routeText?: string | null;
  researchSteps: string[];
  sources: { index: number; title: string; url: string; domain: string }[];
  errorNote?: string | null;
  single?: CallVM;
  experts?: CallVM[];
  fusion?: FusionVM;
  onRerun: () => void;
  turnTokStr: string;
  turnCostStr: string;
  turnFeeStr: string;
  turnTotalStr: string;
  callCount: number;
}
export type MessageVM = UserMsgVM | AssistantMsgVM;

export interface UsageStatVM {
  label: string;
  value: string;
  sub: string;
  color: string;
}
export interface TrendDayVM {
  label: string;
  valStr: string;
  h: string;
}
export interface PerModelVM {
  name: string;
  color: string;
  costStr: string;
  shareStr: string;
  w: string;
}
export interface LedgerRowVM {
  id: number;
  time: string;
  prompt: string;
  modeLabel: string;
  modeBg: string;
  modeFg: string;
  dots: { color: string; name: string }[];
  tokStr: string;
  mcStr: string;
  feeStr: string;
  totalStr: string;
}
export interface ModelCardVM {
  id: string;
  name: string;
  vendor: string;
  color: string;
  initials: string;
  ctx: string;
  tags: string[];
  tierLabel: string;
  tierBg: string;
  tierFg: string;
  inPrice: string;
  outPrice: string;
  border: string;
  mainLabel: string;
  mainBg: string;
  mainFg: string;
  mainBorder: string;
  onMain: () => void;
  onToggle: () => void;
  toggleBg: string;
  switchBg: string;
  switchX: string;
}
export interface PlanVM {
  name: string;
  price: string;
  period: string;
  creditNote: string;
  current: boolean;
  features: string[];
  border: string;
  btnLabel: string;
  btnBg: string;
  btnFg: string;
  btnBorder: string;
}
export interface InvoiceVM {
  date: string;
  plan: string;
  amount: string;
  status: string;
}

export interface ProfileStatVM {
  label: string;
  value: string;
  sub: string;
  color: string;
}
export interface ProfileMemoryVM {
  loaded: boolean;
  facts: string[];
  title: string;
  hint: string;
  emptyText: string;
  clearLabel: string;
  updatedLabel: string;
  onClear: () => void;
}
export interface ProfileVM {
  loaded: boolean;
  id: string;
  name: string;
  email: string;
  initial: string;
  role: string;
  roleLabel: string;
  roleIsAdmin: boolean;
  planLabel: string;
  isDemo: boolean;
  memberSince: string;
  stats: ProfileStatVM[];
  memory: ProfileMemoryVM;
}
export interface UserRowVM {
  id: string;
  name: string;
  email: string;
  initial: string;
  avatarColor: string;
  role: "user" | "admin";
  planId: "free" | "pro" | "team" | "ent";
  callsStr: string;
  spendStr: string;
  joined: string;
  lastActive: string;
  isSelf: boolean;
  deletable: boolean;
}

export interface ViewModel {
  theme: Theme;
  t: Dict;
  lang: Lang;
  platformFee: number;

  // live bootstrap
  bootstrapped: boolean;
  bootError: string | null;

  // user / account
  userName: string;
  userEmail: string;
  userInitial: string;
  planLabel: string;
  signOutLabel: string;
  onLogout: () => void;
  isAdmin: boolean;
  onOpenProfile: () => void;

  // shell / nav
  navs: NavItemVM[];
  recents: RecentVM[];
  // sidebar conversation management
  onBeginRenameRecent: (id: string, title: string) => void;
  onBeginDeleteRecent: (id: string) => void;
  onRecentDraft: (v: string) => void;
  onCommitRenameRecent: () => void;
  onConfirmDeleteRecent: () => void;
  onCancelRecentEdit: () => void;
  recentRenameTitle: string;
  recentDeleteTitle: string;
  sidebarOpen: boolean;
  sidebarClosed: boolean;
  sidebarWpx: string;
  onToggleSidebar: () => void;
  onResize: (e: React.MouseEvent) => void;
  isDark: boolean;
  langLabel: string;
  langOptions: LangOptVM[];
  menuLang: boolean;
  langBtnBorder: string;
  menuOpen: boolean;
  closeMenu: () => void;
  onToggleTheme: () => void;
  onToggleLang: () => void;
  onNewChat: () => void;

  // view flags
  isChat: boolean;
  isUsage: boolean;
  isModels: boolean;
  isBilling: boolean;
  isProfile: boolean;
  isUsers: boolean;

  // chat top bar
  isFast: boolean;
  isExpert: boolean;
  modeDesc: string;
  onFast: () => void;
  onExpert: () => void;
  fastBg: string;
  fastFg: string;
  fastSh: string;
  expBg: string;
  expFg: string;
  expSh: string;
  auto: boolean;
  onToggleAuto: () => void;
  autoBg: string;
  autoFg: string;
  autoBorder: string;
  mainColor: string;
  mainInitials: string;
  mainName: string;
  onOpenModel: () => void;
  menuModel: boolean;
  modelBtnBorder: string;
  modelPickerTitle: string;
  modelPicker: ModelPickVM[];
  trioChips: ChipVM[];
  // editable expert trio
  onOpenTrio: () => void;
  menuTrio: boolean;
  trioBtnBorder: string;
  trioPickerTitle: string;
  trioPickerHint: string;
  trioPicker: TrioPickVM[];
  trioCountLabel: string;
  onApplyTrio: () => void;
  trioApplyDisabled: boolean;
  trioApplyLabel: string;

  // chat body
  isEmpty: boolean;
  suggestions: SuggestionVM[];
  msgs: MessageVM[];

  // composer
  input: string;
  composerFocusTick: number;
  onInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  sendDisabled: boolean;
  sendBg: string;
  sendColor: string;
  sendCursor: string;
  onToggleDR: () => void;
  onToggleDA: () => void;
  drBg: string;
  drFg: string;
  drBorder: string;
  daBg: string;
  daFg: string;
  daBorder: string;
  modeHint: string;

  // usage
  usageStats: UsageStatVM[];
  trendDays: TrendDayVM[];
  perModel: PerModelVM[];
  ledgerRows: LedgerRowVM[];

  // models
  modelCards: ModelCardVM[];
  orModels: string[];

  // billing
  usedPct: string;
  remaining: string;
  monthTotal: string;
  mcTotal: string;
  feeTotal: string;
  plans: PlanVM[];
  invoices: InvoiceVM[];

  // profile
  profile: ProfileVM;
  profileError: string | null;
  onSaveProfile: (b: { name?: string; currentPassword?: string; newPassword?: string }) => void;

  // user management (admin)
  users: UserRowVM[];
  usersLoaded: boolean;
  usersError: string | null;
  onAdminSetRole: (id: string, role: "user" | "admin") => void;
  onAdminSetPlan: (id: string, planId: "free" | "pro" | "team" | "ent") => void;
  onAdminDeleteUser: (id: string) => void;
}

function viewMessages(store: OmniStore, s: OmniState, t: Dict): MessageVM[] {
  const cp = s.copied;
  return s.messages.map((m): MessageVM => {
    if (m.role === "user") {
      const key = "u" + m.id;
      return {
        id: m.id,
        isUser: true,
        isAssistant: false,
        text: m.text,
        onCopy: () => store.copyResult(m.text, key),
        copied: cp === key,
        onEdit: () => store.editUserMessage(m.text),
      };
    }
    const am = m as AssistantMessage;
    const mk = (r: StreamCall): CallVM => {
      const mo = MODEL_MAP[r.modelId];
      const txt = r.full.slice(0, r.shown);
      const outTok = estTok(txt);
      const cost = respCost(r.inTok, outTok, r.modelId);
      return {
        modelId: r.modelId,
        name: mo.name,
        color: mo.color,
        initials: mo.initials,
        vendor: mo.vendor,
        text: txt,
        thinking: r.shown <= 0 && !r.done,
        streaming: !r.done && r.shown > 0,
        done: r.done,
        inTokStr: fmtNum(r.inTok),
        outTokStr: fmtNum(outTok),
        tokStr: fmtNum(r.inTok + outTok),
        costStr: fmtMoney(cost),
        onCopy: () => {},
        copied: false,
        copyIdle: true,
      };
    };
    const sourceVMs = (am.sources ?? []).map((sc, i) => {
      let domain = sc.url;
      try {
        domain = new URL(sc.url).hostname.replace(/^www\./, "");
      } catch {
        /* keep raw */
      }
      return { index: i + 1, title: sc.title, url: sc.url, domain };
    });
    const o: AssistantMsgVM = {
      id: am.id,
      isUser: false,
      isAssistant: true,
      isExpert: am.mode === "expert",
      deepResearch: am.deepResearch,
      routeText: am.routeText,
      researchSteps: [researchCountLabel(s.lang, sourceVMs.length), ...t.researchSteps],
      sources: sourceVMs,
      errorNote: am.errorNote ?? null,
      onRerun: () => store.regenerate(am.id),
      turnTokStr: "",
      turnCostStr: "",
      turnFeeStr: "",
      turnTotalStr: "",
      callCount: 0,
    };
    let calls: StreamCall[] = [];
    if (am.mode === "fast") {
      const sg = mk(am.single!);
      sg.onCopy = () => store.copyResult(am.single!.full, am.id + "-s");
      sg.copied = cp === am.id + "-s";
      sg.copyIdle = cp !== am.id + "-s";
      o.single = sg;
      calls = [am.single!];
    } else {
      o.experts = am.experts!.map((re, i) => {
        const d = mk(re);
        d.onCopy = () => store.copyResult(re.full, am.id + "-e" + i);
        d.copied = cp === am.id + "-e" + i;
        d.copyIdle = cp !== am.id + "-e" + i;
        return d;
      });
      const fz = am.fusion!;
      const mo = MODEL_MAP[fz.modelId];
      const reasonTxt = fz.reason.slice(0, fz.reasonShown);
      const ansTxt = fz.full.slice(0, fz.shown);
      const outTok = estTok(reasonTxt + ansTxt);
      const collapsed = !!s.collapsed[am.id];
      o.fusion = {
        name: mo.name,
        color: mo.color,
        modelId: fz.modelId,
        compilerName: mo.name,
        waiting: !fz.started,
        streaming: fz.started && !fz.done,
        showReason: fz.started,
        expanded: !collapsed,
        chevronRot: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
        reasonText: reasonTxt,
        reasonActive: fz.started && !fz.reasonDone,
        reasonStreaming: fz.started && !fz.reasonDone && fz.reasonShown > 0,
        reasonThinking: fz.started && fz.reasonShown <= 0 && !fz.reasonDone,
        reasonDone: fz.reasonDone,
        showAnswer: fz.reasonDone,
        answerText: ansTxt,
        answerError: fz.answerError ?? null,
        answerThinking: fz.reasonDone && fz.shown <= 0 && !fz.done && !fz.answerError,
        answerStreaming: fz.reasonDone && !fz.done && fz.shown > 0,
        onToggle: () =>
          store.set({ collapsed: { ...s.collapsed, [am.id]: !collapsed } }),
        done: fz.done,
        onCopy: () => store.copyResult(fz.full, am.id + "-f"),
        copied: cp === am.id + "-f",
        copyIdle: cp !== am.id + "-f",
        costStr: fmtMoney(respCost(fz.inTok, outTok, fz.modelId)),
      };
      calls = [...am.experts!, fz];
    }
    let mc = 0;
    let tk = 0;
    calls.forEach((r) => {
      const fs = r as StreamCall & { reason?: string; reasonShown?: number };
      const ot = estTok(
        (fs.reason ? fs.reason.slice(0, fs.reasonShown) : "") +
          r.full.slice(0, r.shown),
      );
      mc += respCost(r.inTok, ot, r.modelId);
      tk += r.inTok + ot;
    });
    const cc = calls.length;
    const fee = store.PF * cc;
    o.turnTokStr = fmtNum(tk);
    o.turnCostStr = fmtMoney(mc);
    o.turnFeeStr = fmtMoney(fee);
    o.turnTotalStr = fmtMoney(mc + fee);
    o.callCount = cc;
    return o;
  });
}

export function selectViewModel(store: OmniStore, s: OmniState): ViewModel {
  const t = i18n(s.lang);
  const L = <T,>(o: Partial<Record<Lang, T>> & { en?: T; zh?: T }) => pick(s.lang, o);
  const isDark = s.theme === "dark";

  const isAdmin = s.userRole === "admin";
  const navDefs: [View, string, IconKey][] = [
    ["chat", t.navChat, "chat"],
    ["usage", t.navUsage, "usage"],
    ["models", t.navModels, "models"],
    ["billing", t.navBilling, "billing"],
    ["profile", t.navProfile, "user"],
  ];
  if (isAdmin) navDefs.push(["users", t.navUsers, "models"]);
  const navs: NavItemVM[] = navDefs.map(([key, label, icon]) => ({
    key,
    label,
    icon,
    active: s.view === key,
    onClick: () => store.setView(key),
  }));

  // Real conversations only — no placeholder recents (empty until the user has chats).
  const recents: RecentVM[] = s.serverRecents.map((r) => ({
    id: r.id,
    title: r.title,
    color: r.color,
    active: s.activeConversationId === r.id,
    onClick: () => void store.openConversation(r.id),
    editing: s.recentEdit?.id === r.id ? s.recentEdit.mode : null,
    draft: s.recentEdit?.id === r.id ? s.recentEdit.draft : "",
  }));

  const mainM = MODEL_MAP[s.mainModel];
  const trioChips: ChipVM[] = s.trio
    .map((id) => MODEL_MAP[id])
    .map((m) => ({ name: m.name, color: m.color, initials: m.initials }));
  // Only enabled models may be chosen as experts (disabled ones are excluded).
  const trioPicker: TrioPickVM[] = MODELS.filter((m) => s.enabled[m.id]).map(
    (m): TrioPickVM => ({
      id: m.id,
      name: m.name,
      sub: m.vendor,
      color: m.color,
      initials: m.initials,
      selected: s.trioDraft.includes(m.id),
      active: s.trio.includes(m.id),
      onClick: () => store.toggleTrioDraft(m.id),
    }),
  );
  const trioComplete = new Set(s.trioDraft).size === 3;
  const trioUnchanged =
    s.trioDraft.length === s.trio.length &&
    s.trioDraft.every((id) => s.trio.includes(id));
  const isFast = s.mode === "fast";
  const isExpert = s.mode === "expert";

  const sugColors = ["#4d6bfe", "#d97757", "#0e8f6e", "#9168ff"];
  const SUG_ICONS = new Set<IconKey>(["code", "pen", "compare", "map", "spark", "search", "route", "globe", "agent", "coins"]);
  const sugClick = (text: string) => () => store.set({ input: text }, () => store.send());
  // Server-generated suggestions only (GET /api/suggestions always returns 4, even on
  // LLM failure via its curated fallback). Empty until they load — no hardcoded set.
  const suggestions: SuggestionVM[] = (s.dynamicSuggestions ?? []).slice(0, 4).map((d, i) => ({
    text: d.text,
    color: d.color || sugColors[i % sugColors.length],
    icon: (SUG_ICONS.has(d.icon as IconKey) ? d.icon : "spark") as IconKey,
    onClick: sugClick(d.text),
  }));

  // ---- Usage page: real all-time data from /api/usage (s.usageData), empty until loaded ----
  const ud = s.usageData;
  const m2y = (v: unknown): number => (Number(v) || 0) / 1e6;
  const sumT = (ud?.summary?.totals ?? {}) as Record<string, number>;
  const uTin = Number(sumT.inputTokens) || 0;
  const uTout = Number(sumT.outputTokens) || 0;
  const usageStats: UsageStatVM[] = [
    { label: t.uTotalTokens, value: fmtNum(uTin + uTout), sub: "↑" + fmtNum(uTin) + " ↓" + fmtNum(uTout), color: "var(--text)" },
    { label: t.uModelCost, value: fmtMoney(m2y(sumT.modelCostMicro)), sub: (Number(sumT.callCount) || 0) + L({ zh: " 次模型调用", "zh-TW": " 次模型調用", en: " calls", ja: " 回呼出" }), color: "var(--text)" },
    { label: t.uPlatformFee, value: fmtMoney(m2y(sumT.platformFeeMicro)), sub: "¥" + store.PF.toFixed(2) + L({ zh: " /次", "zh-TW": " /次", en: " /call", ja: " /回" }), color: "var(--text)" },
    { label: t.uTotal, value: fmtMoney(m2y(sumT.totalMicro)), sub: (Number(sumT.requestCount) || 0) + L({ zh: " 个请求", "zh-TW": " 個請求", en: " requests", ja: " リクエスト" }), color: "var(--accent)" },
    { label: t.uReq, value: String(Number(sumT.requestCount) || 0), sub: L({ zh: "累计", "zh-TW": "累計", en: "all-time", ja: "累計" }), color: "var(--text)" },
  ];
  const trendArr = (ud?.trend?.days ?? []) as { label: string; totalMicro: number }[];
  const maxDay = Math.max(0.0001, ...trendArr.map((d) => m2y(d.totalMicro)));
  const trendDays: TrendDayVM[] = trendArr.map((d) => {
    const v = m2y(d.totalMicro);
    return { label: d.label, valStr: "¥" + v.toFixed(1), h: Math.max(4, (v / maxDay) * 100) + "%" };
  });
  const bmArr = (ud?.byModel?.models ?? []) as { name: string; color: string; modelCostMicro: number; sharePct: number }[];
  const maxCost = Math.max(0.0001, ...bmArr.map((p) => m2y(p.modelCostMicro)));
  const perModel: PerModelVM[] = bmArr.slice(0, 6).map((p) => ({
    name: p.name,
    color: p.color,
    costStr: fmtMoney(m2y(p.modelCostMicro)),
    shareStr: (Number(p.sharePct) || 0) + "%",
    w: (m2y(p.modelCostMicro) / maxCost) * 100 + "%",
  }));
  const ledgerArr = (ud?.ledger?.rows ?? []) as {
    ts: number; prompt: string; mode: string;
    models: { name: string; color: string }[];
    inputTokens: number; outputTokens: number; modelCostMicro: number; platformFeeMicro: number; totalMicro: number;
  }[];
  const ledgerRows: LedgerRowVM[] = ledgerArr.slice(0, 12).map((r, i) => {
    const ex = r.mode === "expert";
    return {
      id: i,
      time: fmtTime(new Date(Number(r.ts) || 0)),
      prompt: r.prompt,
      modeLabel: ex ? t.expert : t.fast,
      modeBg: ex ? "var(--accent-soft)" : "var(--surface-2)",
      modeFg: ex ? "var(--accent)" : "var(--muted)",
      dots: (r.models ?? []).map((mm) => ({ color: mm.color, name: mm.name })),
      tokStr: fmtNum((Number(r.inputTokens) || 0) + (Number(r.outputTokens) || 0)),
      mcStr: fmtMoney(m2y(r.modelCostMicro)),
      feeStr: fmtMoney(m2y(r.platformFeeMicro)),
      totalStr: fmtMoney(m2y(r.totalMicro)),
    };
  });

  const tierMap: Record<string, { l: string; bg: string; fg: string }> = {
    flagship: { l: t.tierFlagship, bg: "rgba(124,108,255,.14)", fg: "var(--accent)" },
    fast: { l: t.tierFast, bg: "rgba(58,209,155,.14)", fg: "var(--success)" },
    balanced: { l: t.tierBalanced, bg: "rgba(255,180,84,.14)", fg: "var(--warn)" },
  };
  const modelCards: ModelCardVM[] = MODELS.map((m) => {
    const isMain = s.mainModel === m.id;
    const en = s.enabled[m.id];
    const tr = tierMap[m.tier];
    return {
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      color: m.color,
      initials: m.initials,
      ctx: m.ctx,
      tags: L({ zh: m.tags, "zh-TW": m.tagsTW, en: m.tagsEn, ja: m.tagsJa }),
      tierLabel: tr.l,
      tierBg: tr.bg,
      tierFg: tr.fg,
      inPrice: "¥" + m.pin,
      outPrice: "¥" + m.pout,
      border: isMain ? "var(--accent)" : "var(--border)",
      mainLabel: isMain ? t.isMain : t.setMain,
      mainBg: isMain ? "var(--accent-soft)" : "transparent",
      mainFg: isMain ? "var(--accent)" : "var(--muted)",
      mainBorder: isMain ? "var(--accent)" : "var(--border-2)",
      onMain: () => store.setMainModel(m.id),
      onToggle: () => store.toggleEnabled(m.id),
      toggleBg: en ? "var(--surface-2)" : "var(--surface)",
      switchBg: en ? "var(--accent)" : "var(--border-2)",
      switchX: en ? "16px" : "2px",
    };
  });
  const orModels = OPENROUTER_MODELS;

  // ---- Billing credit: real subscription (plan + included credit + month usage) ----
  const sub = s.billingSub;
  const subUsage = (sub?.usage ?? {}) as Record<string, number>;
  const usedPct = Math.min(100, Math.max(0, Number(sub?.usedPct) || 0)) + "%";
  const remaining = fmtMoney(m2y(sub?.remainingMicro));
  const monthTotal = fmtMoney(m2y(subUsage.monthTotalMicro));
  const mcTotal = fmtMoney(m2y(subUsage.modelCostMicro));
  const feeTotal = fmtMoney(m2y(subUsage.platformFeeMicro));

  const planDefs = [
    { key: "free", name: "Free", price: "¥0", period: "", credit: "", current: false, feats: L({ zh: ["每日 20 次调用", "仅快速模式", "基础模型", "社区支持"], "zh-TW": ["每日 20 次調用", "僅快速模式", "基礎模型", "社群支援"], en: ["20 calls / day", "Fast mode only", "Base models", "Community support"], ja: ["1 日 20 回", "高速モードのみ", "基本モデル", "コミュニティ"] }) },
    { key: "pro", name: "Pro", price: "¥199", period: t.perMonth, credit: "¥150 " + L({ zh: "额度", "zh-TW": "額度", en: "credit", ja: "クレジット" }), current: true, feats: L({ zh: ["含 ¥150 模型额度", "快速 + 多专家模式", "全部 12 模型 + OpenRouter", "深度研究 / 智能体", "超额按量计费"], "zh-TW": ["含 ¥150 模型額度", "快速 + 多專家模式", "全部 12 模型 + OpenRouter", "深度研究 / 智能體", "超額按量計費"], en: ["¥150 model credit", "Fast + Multi-expert", "All 12 models + OpenRouter", "Deep Research / Agents", "Usage-based overage"], ja: ["¥150 のモデルクレジット", "高速 + マルチエキスパート", "全 12 モデル + OpenRouter", "ディープリサーチ / エージェント", "超過は従量課金"] }) },
    { key: "team", name: "Team", price: "¥899", period: t.perMonth, credit: "¥750 " + L({ zh: "共享额度", "zh-TW": "共享額度", en: "shared", ja: "共有" }), current: false, feats: L({ zh: ["含 ¥750 共享额度", "5 个席位", "用量看板与导出", "API 接入", "SSO 单点登录"], "zh-TW": ["含 ¥750 共享額度", "5 個席位", "用量看板與匯出", "API 接入", "SSO 單一登入"], en: ["¥750 shared credit", "5 seats", "Usage analytics & export", "API access", "SSO"], ja: ["¥750 の共有クレジット", "5 席", "使用量分析とエクスポート", "API アクセス", "SSO"] }) },
    { key: "ent", name: "Enterprise", price: L({ zh: "定制", "zh-TW": "客製", en: "Custom", ja: "カスタム" }), period: "", credit: L({ zh: "定制额度", "zh-TW": "客製額度", en: "Custom", ja: "カスタム" }), current: false, feats: L({ zh: ["不限席位", "私有化 / VPC 部署", "自定义模型接入", "SLA 保障", "安全合规审计"], "zh-TW": ["不限席位", "私有化 / VPC 部署", "自訂模型接入", "SLA 保障", "安全合規稽核"], en: ["Unlimited seats", "Private / VPC deploy", "Custom model hookup", "SLA", "Compliance audit"], ja: ["席数無制限", "プライベート / VPC 配置", "カスタムモデル接続", "SLA", "コンプライアンス監査"] }) },
  ];
  // Prefer the authoritative plan id from the subscription payload; fall back to the session.
  const activePlan = (sub?.plan?.id as string) || s.plan || "free";
  const plans: PlanVM[] = planDefs.map((p) => {
    const isCurrent = p.key === activePlan;
    return {
      name: p.name,
      price: p.price,
      period: p.period,
      creditNote: p.credit,
      current: isCurrent,
      features: p.feats,
      border: isCurrent ? "var(--accent)" : "var(--border)",
      btnLabel: isCurrent
        ? t.currentBadge
        : p.key === "ent"
          ? L({ zh: "联系销售", "zh-TW": "聯絡銷售", en: "Contact", ja: "問い合わせ" })
          : L({ zh: "选择", "zh-TW": "選擇", en: "Choose", ja: "選択" }),
      btnBg: isCurrent ? "var(--surface-2)" : p.key === "pro" ? "var(--accent)" : "transparent",
      btnFg: isCurrent ? "var(--muted)" : p.key === "pro" ? "#fff" : "var(--text)",
      btnBorder: isCurrent ? "var(--border-2)" : p.key === "pro" ? "var(--accent)" : "var(--border-2)",
    };
  });
  // Real invoices only (from /api/billing/invoices) — empty until the user has any.
  const topupLabel = L({ zh: "充值", "zh-TW": "儲值", en: "Top-up", ja: "チャージ" });
  const invoices: InvoiceVM[] = (s.billingInvoices ?? []).map((iv) => ({
    date: fmtDate(iv.date),
    plan: iv.planLabel || (iv.kind === "topup" ? topupLabel : iv.kind),
    amount: fmtMoney(iv.amountMicro / 1e6),
    status: iv.status === "paid" ? t.invPaid : iv.status,
  }));

  const modelPicker: ModelPickVM[] = [
    {
      auto: true,
      isModel: false,
      name: t.auto,
      sub: L({ zh: "按意图自动选择", "zh-TW": "依意圖自動選擇", en: "Auto by intent", ja: "意図で自動選択" }),
      active: s.auto,
      bg: s.auto ? "var(--accent-soft)" : "transparent",
      onClick: () => {
        store.set({ menu: null });
        store.setAuto(true);
      },
    },
    ...MODELS.filter((m) => s.enabled[m.id]).map((m): ModelPickVM => {
      const act = !s.auto && s.mainModel === m.id;
      return {
        auto: false,
        isModel: true,
        name: m.name,
        sub: m.vendor,
        color: m.color,
        initials: m.initials,
        active: act,
        bg: act ? "var(--accent-soft)" : "transparent",
        onClick: () => store.setMainModel(m.id, { clearAuto: true, closeMenu: true }),
      };
    }),
  ];

  const userName = s.user?.name ?? "";
  const userEmail = s.user?.email ?? "";
  const userInitial = (userName.trim()[0] || userEmail.trim()[0] || "·").toUpperCase();

  // ---- profile / admin shared helpers ----
  const planName = (id: string): string => {
    const m: Record<string, string> = { free: "Free", pro: "Pro", team: "Team", ent: "Enterprise" };
    return m[id] || id;
  };
  const roleLabel = (role: string): string => (role === "admin" ? t.roleAdmin : t.roleUser);
  const fmtDate = (raw: unknown): string => {
    if (raw === null || raw === undefined || raw === "") return "—";
    const d = new Date(raw as string | number);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(s.lang === "en" ? "en-US" : s.lang === "ja" ? "ja-JP" : "zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };
  const initialOf = (name: string, email: string): string =>
    (name.trim()[0] || email.trim()[0] || "?").toUpperCase();
  const AVATAR_COLORS = ["#7c6cff", "#42d6ff", "#3ad19b", "#ffb454", "#ff6a9c", "#ff8a5b", "#9168ff", "#4d6bfe"];
  const colorFor = (key: string): string => {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  };

  // ---- profile view-model ----
  const pd = s.profileData;
  const pstats = (pd?.stats ?? {}) as Record<string, number>;
  const micro = (v: unknown): number => (Number(v) || 0) / 1e6;
  const profileMemory: ProfileMemoryVM = {
    loaded: s.memoryFacts !== null,
    facts: s.memoryFacts ?? [],
    title: t.memTitle,
    hint: t.memHint,
    emptyText: t.memEmpty,
    clearLabel: t.memClear,
    updatedLabel: s.memoryUpdatedAt ? `${t.memUpdated} ${fmtDate(s.memoryUpdatedAt)}` : "",
    onClear: () => store.clearMemory(),
  };
  const profile: ProfileVM = pd
    ? {
        loaded: true,
        id: String(pd.id ?? ""),
        name: String(pd.name ?? userName),
        email: String(pd.email ?? userEmail),
        initial: initialOf(String(pd.name ?? userName), String(pd.email ?? userEmail)),
        role: String(pd.role ?? s.userRole),
        roleLabel: roleLabel(String(pd.role ?? s.userRole)),
        roleIsAdmin: String(pd.role ?? s.userRole) === "admin",
        planLabel: planName(String(pd.plan ?? s.plan)),
        isDemo: !!pd.isDemo,
        memberSince: fmtDate(pd.createdAt),
        stats: [
          { label: t.uTotalTokens, value: fmtNum(Number(pstats.totalTokens) || 0), sub: t.usageStats, color: "var(--text)" },
          { label: t.uModelCost, value: fmtMoney(micro(pstats.modelCostMicro)), sub: t.uModelCost, color: "var(--text)" },
          { label: t.uPlatformFee, value: fmtMoney(micro(pstats.platformFeeMicro)), sub: t.uPlatformFee, color: "var(--text)" },
          { label: t.uTotal, value: fmtMoney(micro(pstats.totalMicro)), sub: t.uTotal, color: "var(--accent)" },
          { label: t.colCalls, value: fmtNum(Number(pstats.callCount) || 0), sub: t.colCalls, color: "var(--text)" },
          { label: t.uReq, value: fmtNum(Number(pstats.requestCount) || 0), sub: t.uReq, color: "var(--text)" },
        ],
        memory: profileMemory,
      }
    : {
        loaded: false,
        id: "",
        name: userName,
        email: userEmail,
        initial: userInitial,
        role: s.userRole,
        roleLabel: roleLabel(s.userRole),
        roleIsAdmin: isAdmin,
        planLabel: planName(s.plan),
        isDemo: !!s.user?.isDemo,
        memberSince: "—",
        stats: [],
        memory: profileMemory,
      };

  // ---- user management view-model (admin) ----
  const SYSTEM_EMAILS = new Set(["demo", "admin@robohire.io"]);
  const adminList = (s.adminUsers ?? []) as any[];
  const users: UserRowVM[] = adminList.map((u) => {
    const email = String(u?.email ?? "");
    const name = String(u?.name ?? email);
    const isSelf = !!s.user && String(u?.id ?? "") === s.user.id;
    const isSystem = SYSTEM_EMAILS.has(email) || !!u?.isDemo;
    return {
      id: String(u?.id ?? ""),
      name,
      email,
      initial: initialOf(name, email),
      avatarColor: colorFor(String(u?.id ?? email)),
      role: (u?.role === "admin" ? "admin" : "user") as "user" | "admin",
      planId: (["free", "pro", "team", "ent"].includes(u?.plan) ? u.plan : "free") as "free" | "pro" | "team" | "ent",
      callsStr: fmtNum(Number(u?.callCount) || 0),
      spendStr: fmtMoney(micro(u?.totalCostMicro)),
      joined: fmtDate(u?.createdAt),
      lastActive: fmtDate(u?.lastActiveAt),
      isSelf,
      deletable: !isSelf && !isSystem,
    };
  });

  return {
    theme: s.theme,
    t,
    lang: s.lang,
    platformFee: store.PF,

    bootstrapped: s.bootstrapped,
    bootError: s.bootError,

    userName,
    userEmail,
    userInitial,
    planLabel: s.plan,
    signOutLabel: t.signOut,
    onLogout: () => store.logout(),
    isAdmin,
    onOpenProfile: () => store.setView("profile"),

    navs,
    recents,
    onBeginRenameRecent: (id, title) => store.beginRenameRecent(id, title),
    onBeginDeleteRecent: (id) => store.beginDeleteRecent(id),
    onRecentDraft: (v) => store.editRecentDraft(v),
    onCommitRenameRecent: () => store.commitRenameRecent(),
    onConfirmDeleteRecent: () => store.confirmDeleteRecent(),
    onCancelRecentEdit: () => store.cancelRecentEdit(),
    recentRenameTitle: L({ zh: "重命名", "zh-TW": "重新命名", en: "Rename", ja: "名前を変更" }),
    recentDeleteTitle: L({ zh: "删除此对话？", "zh-TW": "刪除此對話？", en: "Delete this chat?", ja: "この会話を削除？" }),
    sidebarOpen: s.sidebarOpen,
    sidebarClosed: !s.sidebarOpen,
    sidebarWpx: s.sidebarW + "px",
    onToggleSidebar: () => store.toggleSidebar(),
    onResize: (e) => store.startResize(e),
    isDark,
    langLabel: L({ zh: "简体中文", "zh-TW": "繁體中文", en: "English", ja: "日本語" }),
    langOptions: (
      [
        { key: "zh", label: "简体中文" },
        { key: "zh-TW", label: "繁體中文" },
        { key: "en", label: "English" },
        { key: "ja", label: "日本語" },
      ] as { key: Lang; label: string }[]
    ).map((o) => ({
      key: o.key,
      label: o.label,
      active: s.lang === o.key,
      dot: s.lang === o.key ? "var(--accent)" : "transparent",
      fg: s.lang === o.key ? "var(--accent)" : "var(--text)",
      onClick: () => store.setLang(o.key),
    })),
    menuLang: s.menu === "lang",
    langBtnBorder: s.menu === "lang" ? "var(--accent)" : "var(--border)",
    menuOpen: !!s.menu,
    closeMenu: () => store.set({ menu: null }),
    onToggleTheme: () => store.setTheme(isDark ? "light" : "dark"),
    onToggleLang: () => store.set({ menu: s.menu === "lang" ? null : "lang" }),
    onNewChat: () => store.newChat(),

    isChat: s.view === "chat",
    isUsage: s.view === "usage",
    isModels: s.view === "models",
    isBilling: s.view === "billing",
    isProfile: s.view === "profile",
    isUsers: s.view === "users",

    isFast,
    isExpert,
    modeDesc: isFast ? t.fastDesc : t.expertDesc,
    onFast: () => store.setMode("fast"),
    onExpert: () => store.setMode("expert"),
    fastBg: isFast ? "var(--surface)" : "transparent",
    fastFg: isFast ? "var(--text)" : "var(--muted)",
    fastSh: isFast ? "0 1px 3px rgba(0,0,0,.25)" : "none",
    expBg: isExpert ? "var(--surface)" : "transparent",
    expFg: isExpert ? "var(--text)" : "var(--muted)",
    expSh: isExpert ? "0 1px 3px rgba(0,0,0,.25)" : "none",
    auto: s.auto,
    onToggleAuto: () => store.setAuto(!s.auto),
    autoBg: s.auto ? "var(--accent-soft)" : "var(--surface)",
    autoFg: s.auto ? "var(--accent)" : "var(--muted)",
    autoBorder: s.auto ? "var(--accent)" : "var(--border)",
    mainColor: mainM.color,
    mainInitials: mainM.initials,
    mainName: s.auto ? t.auto : mainM.name,
    onOpenModel: () => store.set({ menu: s.menu === "model" ? null : "model" }),
    menuModel: s.menu === "model",
    modelBtnBorder: s.menu === "model" ? "var(--accent)" : "var(--border)",
    modelPickerTitle: L({ zh: "选择模型", "zh-TW": "選擇模型", en: "Pick a model", ja: "モデルを選択" }),
    modelPicker,
    trioChips,
    onOpenTrio: () => store.toggleTrioMenu(),
    menuTrio: s.menu === "trio",
    trioBtnBorder: s.menu === "trio" ? "var(--accent)" : "var(--border)",
    trioPickerTitle: L({ zh: "选择 3 位专家", "zh-TW": "選擇 3 位專家", en: "Pick 3 experts", ja: "3 つの専門家を選択" }),
    trioPickerHint: L({ zh: "仅可选择已启用的模型", "zh-TW": "僅可選擇已啟用的模型", en: "Only enabled models can be chosen", ja: "有効なモデルのみ選択可能" }),
    trioPicker,
    trioCountLabel: `${new Set(s.trioDraft).size} / 3`,
    onApplyTrio: () => store.applyTrio(),
    trioApplyDisabled: !trioComplete || trioUnchanged,
    trioApplyLabel: L({ zh: "应用", "zh-TW": "套用", en: "Apply", ja: "適用" }),

    isEmpty: s.messages.length === 0,
    suggestions,
    msgs: viewMessages(store, s, t),

    input: s.input,
    composerFocusTick: s.composerFocusTick,
    onInput: (e) => store.set({ input: e.target.value }),
    onKeyDown: (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        store.send();
      }
    },
    onSend: () => store.send(),
    sendDisabled: !(s.input.trim() && !s.streaming),
    sendBg: s.input.trim() && !s.streaming ? "var(--accent)" : "var(--surface-2)",
    sendColor: s.input.trim() && !s.streaming ? "#fff" : "var(--faint)",
    sendCursor: s.input.trim() && !s.streaming ? "pointer" : "default",
    onToggleDR: () => store.setDeepResearch(!s.deepResearch),
    onToggleDA: () => store.setDeepAgents(!s.deepAgents),
    drBg: s.deepResearch ? "var(--accent-soft)" : "var(--surface)",
    drFg: s.deepResearch ? "var(--accent)" : "var(--muted)",
    drBorder: s.deepResearch ? "var(--accent)" : "var(--border)",
    daBg: s.deepAgents ? "var(--accent-soft)" : "var(--surface)",
    daFg: s.deepAgents ? "var(--accent)" : "var(--muted)",
    daBorder: s.deepAgents ? "var(--accent)" : "var(--border)",
    modeHint: isFast
      ? s.auto
        ? L({ zh: "自动调度", "zh-TW": "自動調度", en: "auto-route", ja: "自動振分" })
        : mainM.name
      : L({ zh: "多专家 → 融合", "zh-TW": "多專家 → 融合", en: "experts → fuse", ja: "複数専門家 → 融合" }),

    usageStats,
    trendDays,
    perModel,
    ledgerRows,

    modelCards,
    orModels,

    usedPct,
    remaining,
    monthTotal,
    mcTotal,
    feeTotal,
    plans,
    invoices,

    profile,
    profileError: s.profileError,
    onSaveProfile: (b) => store.saveProfile(b),

    users,
    usersLoaded: s.adminUsers !== null,
    usersError: s.usersError,
    onAdminSetRole: (id, role) => store.adminSetRole(id, role),
    onAdminSetPlan: (id, planId) => store.adminSetPlan(id, planId),
    onAdminDeleteUser: (id) => store.adminDeleteUser(id),
  };
}
