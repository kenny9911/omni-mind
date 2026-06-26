import { MODEL_MAP, MODELS } from "./models";
import { aggregate, type Aggregate } from "./accounting";
import { api, ApiClientError } from "./client/api";
import {
  prefsToState,
  enabledFromModels,
  recordCallsToLedger,
  type CallUsage,
  type ModelListItem,
} from "./client/live";
import type {
  AssistantMessage,
  ChatMessage,
  StreamCall,
  FusionState,
  LedgerRecord,
  OmniState,
  Lang,
  Mode,
} from "./types";

export interface OmniConfig {
  defaultMode?: Mode;
  defaultLang?: Lang;
  platformFee?: number;
  live?: boolean;
}

// ---- persisted-conversation rehydration (GET /api/conversations/:id/messages) ----

interface PersistedCall {
  modelId: string;
  text?: string;
  inputTokens?: number;
  status?: string;
}
interface PersistedTurn {
  turnId: string;
  user?: { text?: string };
  assistant?: {
    mode?: Mode;
    deepResearch?: boolean;
    routeText?: string | null;
    sources?: { title?: string; url: string }[];
    single?: PersistedCall;
    experts?: PersistedCall[];
    fusion?: {
      modelId: string;
      reasonText?: string;
      answerText?: string;
      answerError?: string | null;
      inputTokens?: number;
    };
  };
}

/** A persisted (already-complete) model call → a fully-shown, done StreamCall. */
function streamCallFromPersisted(c: PersistedCall): StreamCall {
  const full = c.text ?? "";
  return { modelId: c.modelId, full, shown: full.length, delay: 0, inTok: Number(c.inputTokens) || 0, done: true };
}

/** Map one persisted turn → a completed AssistantMessage for the chat view. */
function hydrateAssistant(id: number, conversationId: string, tn: PersistedTurn): AssistantMessage {
  const a = tn.assistant ?? {};
  const mode: Mode = a.mode === "fast" ? "fast" : "expert";
  const msg: AssistantMessage = {
    id,
    role: "assistant",
    mode,
    deepResearch: !!a.deepResearch,
    promptText: tn.user?.text ?? "",
    errorNote: null,
    serverTurnId: tn.turnId,
    serverConversationId: conversationId,
  };
  if (a.routeText != null) msg.routeText = a.routeText;
  if (Array.isArray(a.sources) && a.sources.length) {
    msg.sources = a.sources
      .filter((s) => s && typeof s.url === "string")
      .map((s) => ({ title: String(s.title || s.url), url: String(s.url) }));
  }
  if (a.single) msg.single = streamCallFromPersisted(a.single);
  if (a.experts) msg.experts = a.experts.map(streamCallFromPersisted);
  if (a.fusion) {
    const f = a.fusion;
    const reason = f.reasonText ?? "";
    const full = f.answerText ?? "";
    msg.fusion = {
      modelId: f.modelId,
      reason,
      reasonShown: reason.length,
      reasonDone: true,
      full,
      shown: full.length,
      delay: 0,
      started: true,
      inTok: Number(f.inputTokens) || 0,
      done: true,
      answerError: f.answerError ?? null,
    };
  }
  return msg;
}

/**
 * Vanilla observable store — a faithful port of the prototype's DCLogic class.
 * Streaming mutates message objects in place, then bumps `state.tick` (a fresh
 * state identity) to notify React via useSyncExternalStore.
 */
export class OmniStore {
  readonly PF: number;
  readonly live: boolean;
  state: OmniState;
  private listeners = new Set<() => void>();

  // streaming internals
  private cur: AssistantMessage | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  // live turn abort handle
  private liveAbort: AbortController | null = null;

  // memoized aggregate (invalidated when ledger array identity changes)
  private aggRef: LedgerRecord[] | null = null;
  private aggVal: Aggregate | null = null;

  constructor(config: OmniConfig = {}) {
    this.PF = typeof config.platformFee === "number" ? config.platformFee : 0.05;
    this.live = !!config.live;
    const lang: Lang = config.defaultLang || "zh";
    this.state = {
      view: "chat",
      theme: "dark",
      lang,
      mode: config.defaultMode || "expert",
      input: "",
      streaming: false,
      mainModel: "gpt-55",
      auto: true,
      trio: ["deepseek-pro", "gpt-55", "claude-opus"],
      trioDraft: ["deepseek-pro", "gpt-55", "claude-opus"],
      enabled: Object.fromEntries(
        Object.keys(MODEL_MAP).map((id) => [id, true]),
      ),
      deepResearch: false,
      deepAgents: false,
      collapsed: {},
      copied: null,
      menu: null,
      sidebarW: 256,
      sidebarOpen: true,
      messages: [],
      ledger: [], // seeded client-side post-mount to avoid hydration mismatch
      tick: 0,
      composerFocusTick: 0,
      bootstrapped: false,
      bootError: null,
      user: null,
      userRole: "user",
      plan: "free",
      serverRecents: [],
      activeConversationId: null,
      dynamicSuggestions: null,
      recentEdit: null,
      profileData: null,
      memoryFacts: null,
      memoryUpdatedAt: 0,
      billingInvoices: null,
      billingSub: null,
      usageData: null,
      profileError: null,
      adminUsers: null,
      usersError: null,
    };
  }

  // ---- observable plumbing ----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = (): OmniState => this.state;
  private emit() {
    this.listeners.forEach((l) => l());
  }
  /** Generic state patch + notify (mirrors this.setState). */
  set = (patch: Partial<OmniState>, cb?: () => void): void => {
    this.state = { ...this.state, ...patch };
    this.emit();
    if (cb) cb();
  };


  /**
   * Hydrate the store from the live backend. Called once, client-side, when
   * config.live is set. Redirects to /login on a 401; records bootError on any
   * other unexpected failure so the UI can surface it.
   */
  async bootstrap(): Promise<void> {
    if (this.state.bootstrapped) return;
    try {
      const sess = await api.auth.session();
      // hydrate preferences (theme/lang/mode/auto/mainModel/trio/deep*)
      const su = sess.user as
        | { id: string; name: string; email: string; role?: string; isDemo?: boolean }
        | undefined;
      this.set({
        ...prefsToState(sess.preferences),
        user: su
          ? { id: su.id, name: su.name, email: su.email, role: su.role || "user", isDemo: !!su.isDemo }
          : null,
        userRole: su?.role || "user",
        plan: sess.plan || "free",
      });

      const lang = this.state.lang;

      // models → enabled map + resolved main model
      try {
        const ml = await api.models.list(lang);
        const items = (ml?.models ?? []) as ModelListItem[];
        const { enabled, mainModel } = enabledFromModels(items);
        const patch: Partial<OmniState> = {};
        if (Object.keys(enabled).length) patch.enabled = enabled;
        if (mainModel) patch.mainModel = mainModel;
        if (Object.keys(patch).length) this.set(patch);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 401) {
          this.redirectLogin();
          return;
        }
        // non-fatal: keep registry defaults
      }

      // recent conversations → serverRecents
      try {
        const cl = await api.conversations.list();
        const list = (cl?.conversations ?? []) as Array<{
          id: string;
          title: string;
          color: string;
        }>;
        this.set({
          serverRecents: list.map((c) => ({
            id: c.id,
            title: c.title,
            color: c.color,
          })),
        });
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 401) {
          this.redirectLogin();
          return;
        }
        // non-fatal: fall back to demo recents
      }

      // ledger accumulates from live turns; start empty.
      this.set({ ledger: [], bootstrapped: true, bootError: null });

      // fresh empty-state suggestions (non-blocking; the static set shows until this lands)
      if (this.state.messages.length === 0) void this.loadSuggestions();
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        this.redirectLogin();
        return;
      }
      const msg = e instanceof Error ? e.message : "Bootstrap failed";
      this.set({ bootError: msg, bootstrapped: true });
    }
  }

  private redirectLogin(): void {
    if (typeof window !== "undefined") window.location.href = "/login";
  }

  aggregate(): Aggregate {
    if (this.aggRef === this.state.ledger && this.aggVal) return this.aggVal;
    const result = aggregate(this.state.ledger, this.PF);
    this.aggRef = this.state.ledger;
    this.aggVal = result;
    return result;
  }

  // ---- sidebar resize ----
  startResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = this.state.sidebarW;
    const move = (ev: MouseEvent) => {
      let w = startW + (ev.clientX - startX);
      w = Math.max(190, Math.min(440, w));
      this.set({ sidebarW: w });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  toggleSidebar = (): void => {
    this.set({ sidebarOpen: !this.state.sidebarOpen, menu: null });
  };

  newChat = (): void => {
    if (this.liveAbort) {
      this.liveAbort.abort();
      this.liveAbort = null;
    }
    this.cur = null;
    this.set({ messages: [], streaming: false, view: "chat", activeConversationId: null });
    void this.loadSuggestions(); // fresh examples each new chat
  };

  /** Fetch fresh empty-state example prompts (live only; silent on failure). */
  async loadSuggestions(): Promise<void> {
    if (!this.live) return;
    try {
      const res = await api.suggestions.get(this.state.lang);
      if (res?.suggestions?.length) this.set({ dynamicSuggestions: res.suggestions });
    } catch {
      /* keep whatever's shown (dynamic-or-static); never block the empty state */
    }
  }

  /**
   * Restore a historical conversation (US8.UC5): fetch its persisted turns and
   * rehydrate the chat view with the full history and results — completed single
   * answers, expert panels, and fusion (incl. any inline compiler error). New
   * messages then thread into the same conversation.
   */
  openConversation = async (id: string): Promise<void> => {
    if (!this.live) return;
    // Stop any in-flight stream before swapping the transcript.
    if (this.liveAbort) {
      this.liveAbort.abort();
      this.liveAbort = null;
    }
    this.cur = null;
    this.set({ view: "chat", menu: null, streaming: false });
    try {
      const res = await api.conversations.messages(id);
      const turns = (res?.turns ?? []) as PersistedTurn[];
      const base = Date.now();
      const messages: ChatMessage[] = [];
      turns.forEach((tn, i) => {
        messages.push({ id: base + i * 2, role: "user", text: tn.user?.text ?? "" });
        messages.push(hydrateAssistant(base + i * 2 + 1, id, tn));
      });
      this.set({
        messages,
        collapsed: {},
        activeConversationId: id,
        streaming: false,
      });
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        this.redirectLogin();
        return;
      }
      // Non-fatal: leave the current view in place but note it on the recents path.
      this.set({ activeConversationId: id });
    }
  };

  // ---- sidebar conversation management (rename / delete) ----

  beginRenameRecent = (id: string, title: string): void =>
    this.set({ recentEdit: { id, mode: "rename", draft: title } });
  beginDeleteRecent = (id: string): void =>
    this.set({ recentEdit: { id, mode: "confirmDelete", draft: "" } });
  cancelRecentEdit = (): void => this.set({ recentEdit: null });
  editRecentDraft = (draft: string): void => {
    const e = this.state.recentEdit;
    if (e) this.set({ recentEdit: { ...e, draft } });
  };

  /** Commit an in-progress rename: optimistic title swap + persist. */
  commitRenameRecent = (): void => {
    const e = this.state.recentEdit;
    if (!e || e.mode !== "rename") return;
    const title = e.draft.trim();
    if (!title) {
      this.set({ recentEdit: null });
      return;
    }
    const serverRecents = this.state.serverRecents.map((r) =>
      r.id === e.id ? { ...r, title } : r,
    );
    this.setAndPersist({ serverRecents, recentEdit: null }, () =>
      api.conversations.rename(e.id, title),
    );
  };

  /** Confirm a delete: drop it from recents (and clear the view if it's open) + persist. */
  confirmDeleteRecent = (): void => {
    const e = this.state.recentEdit;
    if (!e || e.mode !== "confirmDelete") return;
    const serverRecents = this.state.serverRecents.filter((r) => r.id !== e.id);
    const patch: Partial<OmniState> = { serverRecents, recentEdit: null };
    if (this.state.activeConversationId === e.id) {
      if (this.liveAbort) {
        this.liveAbort.abort();
        this.liveAbort = null;
      }
      this.cur = null;
      patch.messages = [];
      patch.activeConversationId = null;
      patch.streaming = false;
    }
    this.setAndPersist(patch, () => api.conversations.remove(e.id));
  };

  // ---- send / stream ----
  send = (): void => {
    const txt = this.state.input.trim();
    if (!txt || this.state.streaming) return;
    this.sendLive(txt);
  };

  // ---- live send / stream ----

  /** Build an empty streaming assistant skeleton (live mode). */
  private buildLiveSkeleton(
    id: number,
    opts: {
      mode: Mode;
      prompt: string;
      auto: boolean;
      mainModel: string;
      trio: string[];
      deepResearch: boolean;
      serverTurnId?: string;
      serverConversationId?: string;
    },
  ): AssistantMessage {
    if (opts.mode === "fast") {
      return {
        id,
        role: "assistant",
        mode: "fast",
        deepResearch: opts.deepResearch,
        routeText: opts.auto ? null : undefined,
        promptText: opts.prompt,
        errorNote: null,
        serverTurnId: opts.serverTurnId,
        serverConversationId: opts.serverConversationId,
        single: { modelId: opts.mainModel, full: "", shown: 0, delay: 0, inTok: 0, done: false },
      };
    }
    return {
      id,
      role: "assistant",
      mode: "expert",
      deepResearch: opts.deepResearch,
      promptText: opts.prompt,
      errorNote: null,
      serverTurnId: opts.serverTurnId,
      serverConversationId: opts.serverConversationId,
      experts: opts.trio.map((mid) => ({ modelId: mid, full: "", shown: 0, delay: 0, inTok: 0, done: false })),
      fusion: {
        modelId: opts.mainModel,
        reason: "",
        reasonShown: 0,
        reasonDone: false,
        full: "",
        shown: 0,
        delay: 0,
        started: false,
        inTok: 0,
        done: false,
      },
    };
  }

  private sendLive(txt: string): void {
    const s = this.state;
    const id = Date.now();
    const userMsg = { id, role: "user" as const, text: txt };
    const asst = this.buildLiveSkeleton(id + 1, {
      mode: s.mode,
      prompt: txt,
      auto: s.auto,
      mainModel: s.mainModel,
      trio: s.trio.slice(),
      deepResearch: s.deepResearch,
    });
    const body = {
      mode: s.mode,
      prompt: txt,
      auto: s.auto,
      mainModel: s.mainModel,
      trio: s.trio.slice(),
      deepResearch: s.deepResearch,
      deepAgents: s.deepAgents,
      // continue the open conversation if one is active (else server creates one)
      ...(s.activeConversationId ? { conversationId: s.activeConversationId } : {}),
    };
    this.set(
      { messages: [...this.state.messages, userMsg, asst], input: "", streaming: true },
      () => {
        this.cur = asst;
        void this.runLiveTurn(asst, () => api.streamChat(body, this.newAbort()));
      },
    );
  }

  private newAbort(): AbortSignal {
    if (this.liveAbort) this.liveAbort.abort();
    this.liveAbort = new AbortController();
    return this.liveAbort.signal;
  }

  /** repaint — same mechanism as the simulation tick(). */
  private repaint(): void {
    this.set({ tick: this.state.tick + 1 });
  }

  /**
   * Consume an SSE event stream and drive the assistant message's streaming
   * fields, reusing the EXISTING viewModel rendering machinery. On completion,
   * append a real LedgerRecord built from the collected per-call usage.
   */
  private async runLiveTurn(
    asst: AssistantMessage,
    open: () => AsyncGenerator<{ event: string; data: any }>,
  ): Promise<void> {
    const usages: CallUsage[] = [];
    let finished = false;
    try {
      for await (const ev of open()) {
        const d = ev.data || {};
        switch (ev.event) {
          case "turn.start": {
            if (typeof d.turnId === "string") asst.serverTurnId = d.turnId;
            if (typeof d.conversationId === "string") {
              asst.serverConversationId = d.conversationId;
              // Pin the active conversation so the next turn threads into it
              // (and so the sidebar can highlight the open conversation).
              this.state.activeConversationId = d.conversationId;
            }
            break;
          }
          case "route": {
            if (typeof d.routeText === "string") asst.routeText = d.routeText;
            break;
          }
          case "research.sources": {
            if (Array.isArray(d.sources)) {
              asst.sources = d.sources
                .filter((x: unknown): x is { title: string; url: string } => !!x && typeof (x as { url?: unknown }).url === "string")
                .map((x: { title?: string; url: string }) => ({ title: String(x.title || x.url), url: String(x.url) }));
            }
            break;
          }
          case "call.start": {
            if (d.role === "single") {
              if (!asst.single) asst.single = { modelId: d.modelId, full: "", shown: 0, delay: 0, inTok: 0, done: false };
              else asst.single.modelId = d.modelId;
            } else if (d.role === "expert") {
              const i = d.index as number;
              if (asst.experts && asst.experts[i]) asst.experts[i].modelId = d.modelId;
              else if (asst.experts) asst.experts[i] = { modelId: d.modelId, full: "", shown: 0, delay: 0, inTok: 0, done: false };
            }
            break;
          }
          case "call.delta": {
            const target =
              d.role === "single"
                ? asst.single
                : d.role === "expert" && asst.experts
                  ? asst.experts[d.index as number]
                  : null;
            if (target) {
              target.full += d.delta;
              target.shown = target.full.length;
            }
            break;
          }
          case "call.usage": {
            const it = Number(d.inputTokens) || 0;
            const ot = Number(d.outputTokens) || 0;
            const rt = Number(d.reasoningTokens) || 0;
            if (d.role === "single" && asst.single) {
              asst.single.inTok = it;
              asst.single.done = true;
            } else if (d.role === "expert" && asst.experts) {
              let e = typeof d.index === "number" ? asst.experts[d.index] : undefined;
              if (!e) e = asst.experts.find((x) => x.modelId === d.modelId);
              if (e) {
                e.inTok = it;
                e.done = true;
              }
            } else if (d.role === "fusion" && asst.fusion) {
              asst.fusion.inTok = it;
              asst.fusion.done = true;
            }
            if (typeof d.modelId === "string") {
              usages.push({ modelId: d.modelId, inputTokens: it, outputTokens: ot, reasoningTokens: rt });
            }
            break;
          }
          case "call.error": {
            const target =
              d.role === "single"
                ? asst.single
                : d.role === "expert" && asst.experts && typeof d.index === "number"
                  ? asst.experts[d.index]
                  : null;
            if (target) target.done = true;
            break;
          }
          case "reason.start": {
            if (asst.fusion) asst.fusion.started = true;
            break;
          }
          case "reason.delta": {
            if (asst.fusion) {
              asst.fusion.reason += d.delta;
              asst.fusion.reasonShown = asst.fusion.reason.length;
            }
            break;
          }
          case "reason.done": {
            if (asst.fusion) asst.fusion.reasonDone = true;
            break;
          }
          case "answer.delta": {
            if (asst.fusion) {
              asst.fusion.full += d.delta;
              asst.fusion.shown = asst.fusion.full.length;
            }
            break;
          }
          case "answer.error": {
            // Compiler failed but the experts survived → inline error on the fusion card.
            if (asst.fusion) {
              asst.fusion.answerError = typeof d.message === "string" ? d.message : "Compiler unavailable";
              asst.fusion.reasonDone = true;
              asst.fusion.done = true;
            }
            break;
          }
          case "error": {
            asst.errorNote = typeof d.message === "string" ? d.message : "Error";
            if (asst.single) asst.single.done = true;
            asst.experts?.forEach((e) => (e.done = true));
            if (asst.fusion) asst.fusion.done = true;
            break;
          }
          case "turn.done": {
            if (asst.single) asst.single.done = true;
            asst.experts?.forEach((e) => (e.done = true));
            if (asst.fusion) {
              asst.fusion.reasonDone = true;
              asst.fusion.done = true;
            }
            finished = true;
            break;
          }
          default:
            break;
        }
        this.repaint();
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        this.redirectLogin();
        return;
      }
      asst.errorNote = e instanceof Error ? e.message : "Stream failed";
      if (asst.single) asst.single.done = true;
      asst.experts?.forEach((ex) => (ex.done = true));
      if (asst.fusion) asst.fusion.done = true;
    } finally {
      this.liveAbort = null;
      if (this.cur === asst) this.cur = null;
      const patch: Partial<OmniState> = { streaming: false };
      if (finished && usages.length) {
        const rec = recordCallsToLedger({ prompt: asst.promptText, mode: asst.mode, calls: usages });
        patch.ledger = [rec, ...this.state.ledger];
      }
      this.set(patch);
    }
  }


  copyResult = (text: string, key: string): void => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
    } catch {
      /* noop */
    }
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.set({ copied: key });
    this.copyTimer = setTimeout(() => this.set({ copied: null }), 1500);
  };

  /**
   * Load a user message's text back into the composer to revise and resend. This
   * is a "reuse & edit" affordance — it does not mutate the original turn (which
   * stays in the transcript and DB); sending the revised text appends a new turn.
   */
  editUserMessage = (text: string): void => {
    this.set({ input: text, composerFocusTick: this.state.composerFocusTick + 1 });
  };

  regenerate = (msgId: number): void => {
    if (this.state.streaming) return;
    const msgs = this.state.messages.slice();
    const idx = msgs.findIndex((m) => m.id === msgId && m.role === "assistant");
    if (idx < 0) return;
    const old = msgs[idx] as AssistantMessage;
    this.regenerateLive(msgs, idx, old);
  };

  /** Live regenerate — replays the server turn via /api/chat/regenerate. */
  private regenerateLive(
    msgs: typeof this.state.messages,
    idx: number,
    old: AssistantMessage,
  ): void {
    const conversationId = old.serverConversationId;
    const turnId = old.serverTurnId;
    if (!conversationId || !turnId) return; // need server identifiers
    const asst = this.buildLiveSkeleton(old.id, {
      mode: old.mode,
      prompt: old.promptText,
      auto: old.routeText !== undefined,
      mainModel: old.fusion?.modelId ?? old.single?.modelId ?? this.state.mainModel,
      trio: old.experts ? old.experts.map((e) => e.modelId) : this.state.trio.slice(),
      deepResearch: old.deepResearch,
      serverTurnId: turnId,
      serverConversationId: conversationId,
    });
    const next = msgs.slice();
    next[idx] = asst;
    this.set({ messages: next, streaming: true }, () => {
      this.cur = asst;
      void this.runLiveTurn(asst, () =>
        api.streamRegenerate({ conversationId, turnId }, this.newAbort()),
      );
    });
  }

  // ---- live persistence (fire-and-forget; optimistic local update first) ----

  /** Optimistic local set + (live only) fire-and-forget backend persist. */
  setAndPersist = (
    patch: Partial<OmniState>,
    persist: () => Promise<unknown>,
  ): void => {
    this.set(patch);
    if (this.live) void persist().catch(() => {});
  };

  // Preference setters: optimistic local update + (live) persist.
  setTheme = (theme: OmniState["theme"]): void =>
    this.setAndPersist({ theme }, () => api.preferences.patch({ theme }));
  setLang = (lang: Lang): void =>
    this.setAndPersist({ lang, menu: null }, () => api.preferences.patch({ lang }));
  setMode = (mode: Mode): void =>
    this.setAndPersist({ mode }, () => api.preferences.patch({ mode }));
  setAuto = (auto: boolean): void =>
    this.setAndPersist({ auto }, () => api.preferences.patch({ auto }));
  setDeepResearch = (deepResearch: boolean): void =>
    this.setAndPersist({ deepResearch }, () => api.preferences.patch({ deepResearch }));
  setDeepAgents = (deepAgents: boolean): void =>
    this.setAndPersist({ deepAgents }, () => api.preferences.patch({ deepAgents }));

  /** Set main model (and disable auto), persisting via models.setMain. */
  setMainModel = (id: string, opts?: { closeMenu?: boolean; clearAuto?: boolean }): void => {
    const patch: Partial<OmniState> = { mainModel: id };
    if (opts?.clearAuto) patch.auto = false;
    if (opts?.closeMenu) patch.menu = null;
    this.setAndPersist(patch, () => api.models.setMain(id));
  };

  /** Toggle a model's enabled flag, persisting via models.setEnabled. */
  toggleEnabled = (id: string): void => {
    const next = !this.state.enabled[id];
    const enabled = { ...this.state.enabled, [id]: next };
    const patch: Partial<OmniState> = { enabled };
    // A disabled model must not stay selected as an expert: drop it from the
    // trio and backfill with the first still-enabled model (mirrors the server,
    // which reconciles authoritatively via the PATCH response below).
    if (!next && this.state.trio.includes(id)) {
      const kept = this.state.trio.filter((t) => t !== id);
      const repl = MODELS.find(
        (m) => m.id !== id && !kept.includes(m.id) && (enabled[m.id] ?? true),
      );
      patch.trio = repl ? [...kept, repl.id] : kept;
    }
    this.setAndPersist(patch, async () => {
      const res = await api.models.setEnabled(id, next);
      if (res?.trio) this.set({ trio: res.trio });
    });
  };

  // ---- editable expert trio (US4 / expert mode) ----

  /** Open/close the expert-trio picker; seed the draft from the live trio. */
  toggleTrioMenu = (): void => {
    if (this.state.menu === "trio") this.set({ menu: null });
    else this.set({ menu: "trio", trioDraft: this.state.trio.slice() });
  };

  /**
   * Toggle a model in the pending trio draft. Adding a 4th drops the oldest so
   * the draft never exceeds three; only enabled models ever reach this action.
   */
  toggleTrioDraft = (id: string): void => {
    const draft = this.state.trioDraft;
    let next: string[];
    if (draft.includes(id)) next = draft.filter((x) => x !== id);
    else next = draft.length >= 3 ? [...draft.slice(1), id] : [...draft, id];
    this.set({ trioDraft: next });
  };

  /** Commit the draft (must be exactly 3) as the active trio and persist it. */
  applyTrio = (): void => {
    const draft = this.state.trioDraft;
    if (new Set(draft).size !== 3) return;
    this.setAndPersist(
      { trio: draft.slice(), menu: null },
      () => api.preferences.patch({ trio: draft.slice() }),
    );
  };

  async logout(): Promise<void> {
    try {
      await api.auth.logout();
    } catch {
      /* ignore — still redirect */
    }
    this.redirectLogin();
  }

  // ---- profile / admin ----

  /**
   * Switch the active view. When opening Profile or (admin-only) User
   * Management, lazily load the backing data into the store.
   */
  setView = (view: OmniState["view"]): void => {
    this.set({ view });
    if (view === "profile") {
      void this.loadProfile();
      void this.loadMemory();
    } else if (view === "billing") {
      void this.loadBilling();
    } else if (view === "usage") {
      void this.loadUsage();
    } else if (view === "users" && this.state.userRole === "admin")
      void this.loadUsers();
  };

  /** Load the real subscription + invoices for the Billing view. */
  async loadBilling(): Promise<void> {
    if (!this.live) {
      this.set({ billingInvoices: [], billingSub: null });
      return;
    }
    try {
      const [sub, inv] = await Promise.all([api.billing.subscription(), api.billing.invoices()]);
      this.set({
        billingSub: sub ?? null,
        billingInvoices: (inv?.invoices ?? []) as OmniState["billingInvoices"],
      });
    } catch {
      this.set({ billingInvoices: [] });
    }
  }

  /** Load real all-time usage (summary/trend/by-model/ledger) for the Usage view. */
  async loadUsage(): Promise<void> {
    if (!this.live) {
      this.set({ usageData: null });
      return;
    }
    try {
      const [summary, trend, byModel, ledger] = await Promise.all([
        api.usage.summary("all"),
        api.usage.trend(7),
        api.usage.byModel("all", 6),
        api.usage.ledger(12),
      ]);
      this.set({ usageData: { summary, trend, byModel, ledger } });
    } catch {
      /* keep prior */
    }
  }

  /** Load the compact context-memory facts into state (Profile view). */
  async loadMemory(): Promise<void> {
    if (!this.live) {
      this.set({ memoryFacts: [] }); // non-live: show the empty state, not a spinner
      return;
    }
    try {
      const res = await api.memory.get();
      this.set({ memoryFacts: res?.facts ?? [], memoryUpdatedAt: res?.updatedAt ?? 0 });
    } catch {
      this.set({ memoryFacts: [] });
    }
  }

  /** Clear what we've learned about the user (optimistic + persist). */
  clearMemory = (): void => {
    this.setAndPersist({ memoryFacts: [], memoryUpdatedAt: 0 }, () => api.memory.clear());
  };

  /** Load the current user's profile payload into state.profileData. */
  async loadProfile(): Promise<void> {
    if (!this.live) return;
    try {
      const res = await api.profile.get();
      this.set({ profileData: res?.profile ?? null, profileError: null });
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        this.redirectLogin();
        return;
      }
      this.set({ profileError: e instanceof Error ? e.message : "Load failed" });
    }
  }

  /** Load the admin user list into state.adminUsers (admin only). */
  async loadUsers(): Promise<void> {
    if (!this.live) return;
    if (this.state.userRole !== "admin") return;
    try {
      const res = await api.admin.users();
      this.set({ adminUsers: (res?.users ?? []) as any[], usersError: null });
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        this.redirectLogin();
        return;
      }
      this.set({ usersError: e instanceof Error ? e.message : "Load failed" });
    }
  }

  /** Update name and/or password, then refresh profileData. */
  async saveProfile(b: {
    name?: string;
    currentPassword?: string;
    newPassword?: string;
  }): Promise<void> {
    if (!this.live) return;
    try {
      const res = await api.profile.update(b);
      const patch: Partial<OmniState> = { profileError: null };
      if (res?.profile) {
        patch.profileData = res.profile;
        if (typeof res.profile.name === "string" && this.state.user) {
          patch.user = { ...this.state.user, name: res.profile.name };
        }
      }
      this.set(patch);
      await this.loadProfile();
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        this.redirectLogin();
        return;
      }
      const code = e instanceof ApiClientError ? e.code : "";
      const msg =
        code || (e instanceof Error ? e.message : "Save failed");
      this.set({ profileError: msg });
    }
  }

  /** Run an admin user-mutation then reload the list, surfacing errors. */
  private async adminMutate(op: () => Promise<unknown>): Promise<void> {
    if (!this.live) return;
    if (this.state.userRole !== "admin") return;
    try {
      await op();
      this.set({ usersError: null });
      await this.loadUsers();
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        this.redirectLogin();
        return;
      }
      const code = e instanceof ApiClientError ? e.code : "";
      this.set({ usersError: code || (e instanceof Error ? e.message : "Action failed") });
    }
  }

  adminSetRole = (id: string, role: "user" | "admin"): Promise<void> =>
    this.adminMutate(() => api.admin.updateUser(id, { role }));

  adminSetPlan = (id: string, planId: "free" | "pro" | "team" | "ent"): Promise<void> =>
    this.adminMutate(() => api.admin.updateUser(id, { planId }));

  adminDeleteUser = (id: string): Promise<void> =>
    this.adminMutate(() => api.admin.deleteUser(id));

  dispose() {
    if (this.copyTimer) clearTimeout(this.copyTimer);
    if (this.liveAbort) this.liveAbort.abort();
    this.listeners.clear();
  }
}
