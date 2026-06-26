// Shared domain types for OmniMind, ported from the design handoff.

export type Lang = "zh" | "zh-TW" | "en" | "ja";
export type Theme = "dark" | "light";
export type Mode = "fast" | "expert";
export type View = "chat" | "usage" | "models" | "billing" | "profile" | "users";
export type Tier = "flagship" | "fast" | "balanced";
export type MenuKind = "lang" | "model" | "trio" | null;

export interface ModelDef {
  id: string;
  name: string;
  vendor: string;
  color: string;
  initials: string;
  tier: Tier;
  tags: string[];
  tagsEn: string[];
  tagsTW: string[];
  tagsJa: string[];
  ctx: string;
  /** input price per 1M tokens (¥) */
  pin: number;
  /** output price per 1M tokens (¥) */
  pout: number;
}

/** A single streaming model response inside an assistant turn. */
export interface StreamCall {
  modelId: string;
  full: string;
  shown: number;
  delay: number;
  inTok: number;
  done: boolean;
  /** transient wall-clock start marker (performance.now based) */
  t0?: number;
}

/** The fusion / compiler stage of a multi-expert turn. */
export interface FusionState {
  modelId: string;
  reason: string;
  reasonShown: number;
  reasonDone: boolean;
  full: string;
  shown: number;
  delay: number;
  started: boolean;
  inTok: number;
  done: boolean;
  /** set when the compiler model failed (e.g. rate-limited); shown inline on the fusion card */
  answerError?: string | null;
  // transient wall-clock markers
  rt0?: number;
  at0?: number;
}

export interface UserMessage {
  id: number;
  role: "user";
  text: string;
}

export interface AssistantMessage {
  id: number;
  role: "assistant";
  mode: Mode;
  deepResearch: boolean;
  promptText: string;
  routeText?: string | null;
  single?: StreamCall;
  experts?: StreamCall[];
  fusion?: FusionState;
  /** real web sources retrieved by Deep Research (empty/undefined otherwise) */
  sources?: { title: string; url: string }[];
  // transient: experts-stage wall-clock start marker
  _t0?: number;
  // server identifiers captured during a live turn (for regenerate)
  serverTurnId?: string;
  serverConversationId?: string;
  /** optional inline error note surfaced by a live turn */
  errorNote?: string | null;
}

export type ChatMessage = UserMessage | AssistantMessage;

/** A completed billing record in the usage ledger. */
export interface LedgerCall {
  id: string;
  inTok: number;
  outTok: number;
}
export interface LedgerRecord {
  ts: Date;
  prompt: string;
  mode: Mode;
  calls: LedgerCall[];
}

export interface OmniState {
  view: View;
  theme: Theme;
  lang: Lang;
  mode: Mode;
  input: string;
  streaming: boolean;
  mainModel: string;
  auto: boolean;
  trio: string[];
  /** transient working copy of the trio while the expert picker is open */
  trioDraft: string[];
  enabled: Record<string, boolean>;
  deepResearch: boolean;
  deepAgents: boolean;
  collapsed: Record<number, boolean>;
  copied: string | null;
  menu: MenuKind;
  sidebarW: number;
  sidebarOpen: boolean;
  messages: ChatMessage[];
  ledger: LedgerRecord[];
  /** render tick — bumped on every streaming frame to force a re-render */
  tick: number;
  /** bumped to ask the composer to focus (e.g. after "edit" on a user message) */
  composerFocusTick: number;

  // ---- live-mode bootstrap state ----
  /** true once the live session/preferences/models/recents have hydrated */
  bootstrapped: boolean;
  /** non-null when bootstrap hit an unexpected (non-401) failure */
  bootError: string | null;
  /** signed-in user, or null in non-live / pre-bootstrap */
  user: { id: string; name: string; email: string; role?: string; isDemo?: boolean } | null;
  /** signed-in user's role ("user" | "admin"); drives admin-only nav */
  userRole: string;
  /** subscription plan id (e.g. "pro") */
  plan: string;
  /** server-provided recent conversations (empty → fall back to demo recents) */
  serverRecents: { id: string; title: string; color: string }[];
  /** the conversation currently shown/threaded (null → a fresh, unsaved chat) */
  activeConversationId: string | null;
  /** freshly-generated empty-state example prompts (null → use static fallback) */
  dynamicSuggestions: { text: string; icon: string; color: string }[] | null;
  /** transient sidebar rename/delete affordance for a single recent, or null */
  recentEdit: { id: string; mode: "rename" | "confirmDelete"; draft: string } | null;

  // ---- profile / admin lazy caches ----
  /** loaded profile payload (api.profile.get().profile), or null until loaded */
  profileData: any | null;
  /** compact context-memory facts (Profile view), null until loaded */
  memoryFacts: string[] | null;
  /** last-updated timestamp (ms) of the context memory */
  memoryUpdatedAt: number;
  /** real invoices (Billing view), null until loaded */
  billingInvoices:
    | { id: string; date: number; planLabel: string | null; kind: string; amountMicro: number; status: string }[]
    | null;
  /** real subscription view (plan + credit + month usage), null until loaded */
  billingSub: any | null;
  /** real all-time usage (summary/trend/by-model/ledger), null until loaded */
  usageData: any | null;
  /** transient profile save/load error message */
  profileError: string | null;
  /** loaded admin user list (api.admin.users().users), or null until loaded */
  adminUsers: any[] | null;
  /** transient admin action error message */
  usersError: string | null;
}
