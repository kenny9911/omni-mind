# Context Engineering Design — OmniMind

> Status: Design (consolidated from three research passes: long-term memory frameworks, retrieval & context management, intent understanding).
> Scope: How OmniMind carries context, remembers the user, and understands intent — every turn, across conversations, multilingually, and cheaply.
> Audience: Engineers implementing the memory/retrieval/intent layers in `lib/server/llm/*` and `lib/server/contracts/*`.

> **Implementation status**
> - ✅ **Conversation history (L3)** — `loadConversationHistory` (last 10 turns, index-backed, per-message cap). Shipped + live-verified.
> - ✅ **Phase 1 · Intent layer (§6, the keystone)** — `lib/server/llm/intent.ts` `classifyIntent()` (deepseek-flash, typed JSON, `standalone_query` follow-up rewrite, confidence-gated, regex `route()` fallback). Wired into the chat + regenerate routes and fast-mode auto-routing. Shipped + live-verified (a bare "再详细点" follow-up routes to the code model via context).
> - ✅ **Phase 1 · Memory rework** — `memory.ts` now stores **scored, categorized, native-language** facts (`MemoryFact[]`, legacy `string[]` upcast); `formatMemoryForPrompt(facts, standaloneQuery)` injects only the **top-6 relevant** (CJK-aware overlap + importance + recency; importance=3 pinned). Wired into chat + regenerate. Shipped + live-verified (Chinese facts learned & stored).
> - ✅ **Phase 1 · Prompt caching** — the memory block now rides in a separate `system` message marked `cache_control: ephemeral` (Anthropic prompt caching; no-op elsewhere) instead of being prepended. `gateway.ts`. Shipped (chat verified unaffected).
> - ✅ **Phase 1 · Cross-session digests (L2)** — `lib/server/llm/summaries.ts`: each conversation keeps a short native-language digest (`conversations.conversation_digest`), refreshed as it grows; the last 3 are injected as a "Previous sessions" block when a NEW conversation starts. Wired into the chat route (post-stream refresh + new-conversation injection). Schema columns added + migrated to the live DB; unit-tested.
> - ✅ **Phase 2 · Rolling summary / compaction** — `summaries.ts`: the last `MAX_HISTORY_TURNS` turns stay verbatim; everything older is rolled into `conversations.conversation_summary` (incrementally, cheap, native-language) and injected as a "Summary of earlier in this conversation" block on continuing turns — so a long chat never loses its head while per-turn tokens stay bounded. Wired into the chat route (post-stream refresh + continuing-turn injection). Columns migrated; unit-tested.
> - ✅ **Phase 3 · Semantic memory retrieval** — `lib/server/llm/embeddings.ts` (text-embedding-3-small, 512-dim, via the OpenAI key; deterministic fake mode for tests) + `memory.ts`: facts are embedded on learn and `selectAndFormatMemory()` ranks them by **cosine similarity in app code** (keyword overlap as fallback). Wired into chat + regenerate. Unit-tested; **live-verified** real embeddings + cross-lingual recall (推荐系统 ↔ recommendation engine = 0.576 vs unrelated 0.139).
> - ✅ **Phase 1 · Core Profile (L0)** — `memory.ts` `maybeRewriteProfile()` rewrites a stable ≤200-token identity paragraph (`users.user_profile`) whenever a CORE (importance=3) fact appears; injected FIRST in the system block (Letta core-memory pattern). Wired into `learnFromTurn` + the chat route. Unit-tested. **Phase 1 is now complete.**
> - ✅ **Phase 3 · Semantic session retrieval** — `summaries.ts`: conversation digests are embedded (`conversations.digest_embedding`) and `retrieveRelevantDigests()` injects the past sessions most RELEVANT to the new query by cosine (recency fallback). Chosen over per-turn embedding (one embedding per conversation, not per turn) for far better cost/value. Unit-tested.
> - ❌ **Embedding-based router — deliberately NOT built.** It cannot produce the `standalone_query` rewrite (only the LLM can), so the LLM classifier is required every turn regardless; an extra embedding-classify call would be pure redundant cost. The LLM `classifyIntent` (intent + rewrite in one call, regex fallback) stays the router.
> - ⏳ Optional: native-`pgvector` swap (drop-in) once the extension is installed on the DB host.
>
> **Infra note (pgvector):** the target Postgres server does **not** have `pgvector`, and it cannot be installed via SQL (it must be installed at the OS level by an admin with shell access to the DB host). Phase 3 therefore uses **embeddings stored as JSON + cosine similarity in application code** — fine for bounded per-user memory, and a drop-in swap to native `pgvector` (IVFFlat/HNSW) once the extension is installed.

---

## 1. Goals & Non-Goals

### 1.1 Goals (what this design must deliver)

1. **Totally contextual.** Every turn is answered with the right context assembled and injected: the user's profile, durable facts, episodic history, and the live conversation window — robustly, every time, in the user's language.
2. **Memory of the user.** Reliable, persistent, *retrievable* long-term memory that survives across conversations: facts are extracted in their original language, scored, de-duplicated, contradiction-aware, and surfaced when relevant — not a flat capped list that silently forgets.
3. **Understand intent clearly.** Real intent understanding (not regex keyword matching) that resolves short follow-ups into self-contained queries and drives model routing, retrieval, and response quality.

### 1.2 Cross-cutting constraints

- **Cost is shown to the user.** Per-token cost *and* a per-call platform fee are billed and displayed (`billCall`, `PLATFORM_FEE_MICRO`, money in micro-CNY). Every extra LLM/embedding call is visible. Therefore: minimize calls, prefer `deepseek-flash`, prefer prompt caching, and never add a call without a quantified payoff.
- **Multilingual first.** zh, zh-TW, en, ja. Memory and summaries are stored in the user's native language. No forced English round-trip.
- **No new services.** Everything lives on the existing Postgres + Drizzle stack. The only new infrastructure permitted is the `pgvector` extension (Phase 3) and the `text-embedding-3-small` embedding model. No Pinecone, no Mem0/Letta/Zep/Cognee runtime dependencies — we adapt their *patterns*.
- **Best-effort, never block the turn.** Memory and summarization run post-stream and must never throw into the chat path (today's `learnFromTurn` already follows this rule).

### 1.3 Non-Goals

- Importing any memory framework as a dependency (we adapt patterns — see §8).
- A separate vector database or external retrieval service.
- Graph-based knowledge memory (Zep/Cognee graph layer) — out of scope; bi-temporal validity (§5.3) gives us the high-value subset.
- Real-time/streaming memory updates mid-turn. Memory is updated *after* the answer streams.
- Cross-user / shared memory. Memory is strictly per `userId`.
- Tool-calling agents or function memory — orthogonal to this document.

---

## 2. Current State & Gaps

### 2.1 What exists today (cite: real files)

| Layer | File | Behavior today |
|---|---|---|
| Long-term memory | `lib/server/llm/memory.ts` | Flat `string[]`, **≤16 facts** (`MAX_FACTS`), each ≤120 chars. Distilled by `deepseek-flash` (`MEMORY_MODEL`) post-turn via `learnFromTurn`. **Facts forced to English** ("Write each fact in English"). Injected verbatim as a preamble by `formatMemoryForPrompt`. No scoring, no categories, no retrieval — *all* facts injected every turn. |
| Storage | `lib/server/db/schema.ts` | `user_memory` is **one row per user** (`userId` PRIMARY KEY, `facts_json` TEXT). No per-fact rows, no embeddings, no timestamps per fact. |
| Intent routing | `lib/server/llm/router.ts` | `route()` is **pure regex** over a lowercased prompt → one model id + a localized label. Synchronous, no LLM, no context. Order-significant regexes for code/writing/translation/summary/planning, else general. |
| Conversation window | `lib/server/contracts/chat-helpers.ts` | `loadConversationHistory` returns the **last 10 complete turns** as alternating `messages[]`, each capped at 4000 chars. No summarization. Comment already anticipates "A future summarization layer will compress further." |
| Prompt assembly | `lib/server/llm/gateway.ts` | `buildGatewayPrompt` prepends `memory` to `single` + `fusion-*` prompts; `history` sent as a `messages[]` array. **Experts deliberately omit memory** (token frugality). |
| Turn orchestration | `lib/server/llm/fusion.ts` | `runTurn`: fast = 1 call (optional `route()` auto-pick); expert = 3 parallel experts + fusion `reason` then `answer`. Billing via `inflate()` + `estTok()`; `memTok`/`historyTok` counted into input tokens; per-call `PLATFORM_FEE_MICRO`. |
| Pipeline entry | `app/api/chat/route.ts` | Loads memory + history, builds `RunTurnCfg`, streams, then fires `learnFromTurn` post-stream. |

### 2.2 Gaps (mapped to goals)

**G1 "Totally contextual":**
- Only the last 10 turns are visible. Anything older is *gone* — a 40-turn planning conversation loses its head. (No summary/compaction.)
- Memory is all-or-nothing: 16 facts injected regardless of relevance to the current prompt; irrelevant facts waste tokens and dilute focus.
- No cross-session context: starting a new conversation forgets everything discussed in prior ones except whatever made it into the 16 global facts.

**G2 "Memory of the user":**
- Hard cap of 16 means fact #17 silently drops the oldest — *forgetting by overflow*, not by relevance or recency.
- No contradiction handling: "I use React" and a later "I switched to Vue" coexist forever.
- English-only storage corrupts nuance for zh/ja users and burns tokens on translation.
- No retrievability: facts can't be searched; you get all or none.
- No importance/recency scoring: a one-off preference ranks equal to "user is a backend engineer."

**G3 "Understand intent clearly":**
- Regex routing is brittle and monolingual-ish (mixed zh/en patterns, no ja-specific intent terms beyond the few hardcoded).
- A follow-up like `好` / `yes` / `继续` routes as *general* with no idea what it refers to — the single biggest follow-up-quality bug.
- No `complexity` or `confidence` signal to inform fast-vs-expert hints or fallback.
- Intent doesn't inform retrieval at all.

---

## 3. Target Architecture

### 3.1 The four memory layers + intent layer

We model context as four layers (adapting Letta/MemGPT's tiering) plus a dedicated intent layer that sits *before* assembly:

| Layer | What it holds | Lifetime | Source of truth | Retrieval cost |
|---|---|---|---|---|
| **L0 — Core / Profile** | 200–300 token user profile: name, working language, expertise, 3–5 pinned facts | Persistent, slowly rewritten | `users.user_profile` (new col) | **Zero** (always injected, no query) |
| **L1 — Semantic memory** | Durable facts (`semantic`/`episodic`/`procedural`), scored, language-native, bi-temporal | Persistent, contradiction-aware | `user_memory` rows (Phase 3 schema) | 1 embedding + 1 vector query (Phase 3); keyword overlap (Phase 1) |
| **L2 — Episodic summaries** | Per-conversation digests + rolling in-conversation summary | Persistent (digests) / per-conversation (rolling) | `conversations.*` + `conversation_summaries` | Cheap reads, lazy `deepseek-flash` writes |
| **L3 — Working / History** | Last N complete turns of the *current* conversation | Current conversation | `turns` + `messages` (today's `loadConversationHistory`) | Free (already loaded) |
| **Intent layer** | `{intent, standalone_query, complexity, confidence}` | Per turn (ephemeral) | One `deepseek-flash` call (`classifyIntent`) | 1 cheap call/turn (replaces regex) |

The intent layer runs **first** and feeds the other layers: `standalone_query` becomes the retrieval key (so a `好` follow-up retrieves what it actually refers to), `intent` drives routing, `complexity`/`confidence` inform fast-vs-expert hints and fallback.

### 3.2 Per-turn prompt-assembly pipeline (with token budget)

```
 USER PROMPT (raw, may be a terse follow-up e.g. "好" / "yes" / "再详细点")
   │
   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ [0] INTENT  (deepseek-flash, ~1 cheap call)                                │
│     in:  raw prompt + last ~4 turns (already in memory)                    │
│     out: { intent, standalone_query, complexity, confidence }              │
│     standalone_query = self-contained rewrite of the follow-up             │
└──────────────────────────────────────────────────────────────────────────┘
   │  standalone_query ─────────────────────────────────┐
   │  intent ──────────────► routing (§6.4)             │ (retrieval key)
   │  complexity/confidence ► fast/expert hint, fallback│
   ▼                                                    ▼
┌────────────────────────────┐        ┌────────────────────────────────────┐
│ [1] CORE / PROFILE  (L0)   │        │ [2] RETRIEVAL  (L1 + L2)             │
│   users.user_profile       │        │   P1: keyword-overlap top-6 facts   │
│   ~250 tok, ZERO retrieval  │        │   P3: hybrid (vector+FTS+RRF) top-10│
│                            │        │       on standalone_query           │
│                            │        │   + last 3 cross-session digests    │
│                            │        │   + rolling summary if window>3k tok│
└────────────────────────────┘        └────────────────────────────────────┘
   │                                                    │
   └───────────────────────┬────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ [3] HISTORY  (L3) — loadConversationHistory                                │
│     last 10 complete turns  →  {summary?, recentTurns[]}  (P2 compaction)  │
└──────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ [4] ASSEMBLE  (buildGatewayPrompt)                                         │
│                                                                            │
│   ┌── SYSTEM / MEMORY BLOCK ─────────────── [cache_control: ephemeral] ──┐ │
│   │  PROFILE (L0)             ~250 tok   ← stable across turns → CACHED   │ │
│   │  Previous sessions (L2)  ~300 tok   ← last 3 digests                 │ │
│   │  Relevant memory (L1)    ~300 tok   ← top facts for standalone_query │ │
│   │  Rolling summary (L2)    ~400 tok   ← only if window compacted       │ │
│   └──────────────────────────────────────────────────────────────────────┘ │
│   ── HISTORY messages[] (L3) ──────────── recent turns, oldest→newest      │
│   ── CURRENT USER PROMPT ──────────────── the raw prompt (verbatim)        │
└──────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              streamOne(single)  OR  3×expert ∥ → fusion(reason→answer)
                           │
                           ▼ (post-stream, non-blocking, best-effort)
┌──────────────────────────────────────────────────────────────────────────┐
│ [5] LEARN  (deepseek-flash)                                                │
│   extractFacts → score → contradiction check → embed (P3) → upsert         │
│   maybe rewrite PROFILE (L0) if an importance=3 fact appeared              │
│   maybe re-summarize conversation (L2) every ~20 turns / on close          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Token budget (target per turn)

| Block | Phase 1 budget | Notes |
|---|---|---|
| Profile (L0) | ~250 tok | Always present, **cacheable** |
| Relevant memory (L1) | ~300 tok (top-6 facts) | Down from ~16 facts injected today |
| Previous sessions (L2 digests) | ~300 tok (3 × ~100) | Only on a fresh conversation's early turns |
| Rolling summary (L2) | ~400 tok | Only when current window > ~3000 tok |
| History (L3) | ≤ ~3000 tok | Bounded by 10 turns × 4000-char cap; compacted in P2 |
| Intent overhead | ~250 out tok (its own cheap call) | Not in the main prompt |
| **Memory/system block total** | **~850–1250 tok** | vs. today's variable ≤16-fact dump; and ~90% of it is **cache-eligible** |

Design rule: the **stable** part (Profile + digests) goes *first* and is wrapped with `cache_control:{type:'ephemeral'}` so Anthropic models in the expert trio re-read it nearly free; the **volatile** part (query-specific facts, rolling summary) goes after the cache breakpoint.

---

## 4. Data Model Changes

All DDL is Postgres / Drizzle, consistent with `schema.ts` conventions: ids `TEXT` (uuid), times `BIGINT` epoch-ms, JSON columns `TEXT`, booleans `BOOLEAN`.

### 4.1 Phase 1 — no migration of storage *engine*, only column shape (still TEXT JSON)

Keep `user_memory` as one row per user for Phase 1, but change `facts_json` from `string[]` to a **structured array** so we can score and filter without new tables yet.

```jsonc
// user_memory.facts_json (Phase 1 shape) — still a TEXT JSON column
[
  { "text": "用户是后端工程师，主攻 Go 和分布式系统", // NATIVE language
    "category": "role",        // role | preference | goal | domain | style | language | other
    "lastSeen": 1750000000000, // epoch-ms
    "score": 3 }               // importance 1..3
]
```

No Drizzle DDL change is required for Phase 1 (the column stays TEXT); only the *encoding* changes. Add a tiny migration step in code to read legacy `string[]` and upcast to `{text, category:"other", lastSeen:updatedAt, score:2}` on first load.

Add the **Profile (L0)** column to `users`:

```ts
// schema.ts — add to users table
userProfile: text("user_profile").notNull().default(""), // 200-300 token core memory block, native language
userProfileAt: bigint("user_profile_at", { mode: "number" }).notNull().default(0),
```

Add **cross-session digest** columns to `conversations`:

```ts
// schema.ts — add to conversations table
conversationDigest: text("conversation_digest"),        // ~150-word native-language summary of the whole conversation
digestedAt: bigint("digested_at", { mode: "number" }),  // epoch-ms; null until first digest
```

### 4.2 Phase 2 — rolling summary (one migration)

```ts
// schema.ts — add to conversations table
conversationSummary: text("conversation_summary"),                     // rolling, lazily refreshed
summaryUpToTurn: integer("summary_up_to_turn").notNull().default(0),   // # of turns already folded into the summary
```

Raw DDL:

```sql
ALTER TABLE conversations
  ADD COLUMN conversation_summary  TEXT,
  ADD COLUMN summary_up_to_turn    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN conversation_digest   TEXT,
  ADD COLUMN digested_at           BIGINT;

ALTER TABLE users
  ADD COLUMN user_profile     TEXT   NOT NULL DEFAULT '',
  ADD COLUMN user_profile_at  BIGINT NOT NULL DEFAULT 0;
```

### 4.3 Phase 3 — pgvector + per-fact memory rows

Enable the extension and promote `user_memory` to **one row per fact** with embeddings and bi-temporal validity (adapting Mem0 additive extraction + Zep bi-temporality):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

```sql
-- New per-fact table (replaces the single-row user_memory; see migration in §9 Phase 3)
CREATE TABLE user_memory_facts (
  id               TEXT PRIMARY KEY,                 -- uuid
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content          TEXT NOT NULL,                    -- the fact, NATIVE language
  category         TEXT NOT NULL DEFAULT 'other',    -- role|preference|goal|domain|style|language|other
  memory_type      TEXT NOT NULL DEFAULT 'semantic', -- semantic | episodic | procedural
  importance_score DOUBLE PRECISION NOT NULL DEFAULT 2, -- 1..3
  retrieval_count  INTEGER NOT NULL DEFAULT 0,       -- bumped when injected (popularity signal)
  embedding        VECTOR(1536),                     -- text-embedding-3-small
  content_tsv      TSVECTOR,                         -- for hybrid full-text (generated/maintained)
  conversation_id  TEXT,                             -- provenance (nullable)
  valid_from       BIGINT NOT NULL,                  -- epoch-ms
  invalid_at       BIGINT,                           -- epoch-ms; NULL = currently valid (bi-temporal)
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL
);

CREATE INDEX ix_umf_user_valid   ON user_memory_facts (user_id) WHERE invalid_at IS NULL;
CREATE INDEX ix_umf_user_score   ON user_memory_facts (user_id, importance_score DESC);
CREATE INDEX ix_umf_tsv          ON user_memory_facts USING GIN (content_tsv);
-- IVFFlat ANN index (cosine). lists≈sqrt(rows); start at 100, ANALYZE after backfill.
CREATE INDEX ix_umf_embedding    ON user_memory_facts
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

```ts
// schema.ts (Phase 3) — Drizzle. Use a custom vector type or drizzle pgvector helper.
import { customType } from "drizzle-orm/pg-core";
const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() { return "vector(1536)"; },
  toDriver(v) { return `[${v.join(",")}]`; },
});

export const userMemoryFacts = pgTable("user_memory_facts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  category: text("category").notNull().default("other"),
  memoryType: text("memory_type").notNull().default("semantic"),
  importanceScore: doublePrecision("importance_score").notNull().default(2),
  retrievalCount: integer("retrieval_count").notNull().default(0),
  embedding: vector1536("embedding"),
  conversationId: text("conversation_id"),
  validFrom: bigint("valid_from", { mode: "number" }).notNull(),
  invalidAt: bigint("invalid_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
```

Optional Phase 3 add-on — **semantic turn retrieval** (adapting "relevant prior context"):

```sql
ALTER TABLE turns ADD COLUMN prompt_embedding VECTOR(1536);
CREATE INDEX ix_turns_embedding ON turns
  USING ivfflat (prompt_embedding vector_cosine_ops) WITH (lists = 100);
```

### 4.4 Intent-class centroids (Phase 3, for embedding router)

Stored as a small static asset, not a table (10 example sentences per class × {zh, en, ja}, embedded once, centroids checked into a JSON file under `lib/server/llm/intent-centroids.json`). No DB change.

---

## 5. Retrieval & Extraction Algorithms

### 5.1 Extraction (the "learn" step) — adapt Mem0 additive extraction

Runs in `learnFromTurn` (post-stream, best-effort). One `deepseek-flash` call per real send. New output schema (typed JSON, not bare strings):

```jsonc
// extractFacts() output — extract in ORIGINAL language
[
  { "content": "用户正在做一个多模型聊天应用 OmniMind",
    "category": "goal",
    "importance": 3,                  // 1=minor preference, 2=stable trait, 3=defining/core
    "contradicts_memory_id": null }   // or an existing fact id this supersedes (Phase 3)
]
```

Algorithm:
1. Load existing facts (Phase 1: from `facts_json`; Phase 3: top-N valid facts for the user).
2. Prompt `deepseek-flash` with the user's message + known facts; **instruct it to write facts in the user's native language**, score importance 1–3, emit `category`, and (Phase 3) name a `contradicts_memory_id` if the new fact supersedes an old one.
3. **Sensitivity filter unchanged**: never record contact details, financial/health data, credentials, or government IDs (carry over today's guard verbatim).
4. Phase 1: merge into `facts_json` (dedupe by lowercased `text`, keep highest `score`, refresh `lastSeen`). Replace the hard 16-cap with **soft eviction by effective score** (§5.4).
5. Phase 3: embed each new fact with `text-embedding-3-small`; on contradiction set `invalid_at = now` on the old row (it stays for audit/temporal queries but is excluded from retrieval); insert the new row.
6. If any fact has `importance === 3`, mark the profile dirty → rewrite L0 (§5.5).

### 5.2 Injection / retrieval — phased

**Phase 1 (keyword overlap, no infra):** At assembly time, score each stored fact by token overlap with the **`standalone_query`** (from the intent layer) plus a recency bonus; inject **top-6**. This alone cuts injected memory tokens ~50% and makes them relevant.

```
score(fact) = overlap(tokens(fact.text), tokens(standalone_query))
            + 0.5 * fact.score                 // importance weight
            + recencyBonus(fact.lastSeen)       // small decay term
inject top-6 by score, but always include any fact.score === 3 (pinned)
```

**Phase 3 (hybrid retrieval, pgvector):**
1. Embed `standalone_query` once (reuse the embedding for the intent router, §6.5 — **one embedding serves both**).
2. **Vector arm:** top-8 valid facts by cosine distance (`embedding <=> :q`, `invalid_at IS NULL`).
3. **Lexical arm:** top-5 by Postgres full-text (`content_tsv @@ plainto_tsquery(:q)`).
4. **Dedupe + Reciprocal Rank Fusion (RRF):** `rrf(d) = Σ 1/(k + rank_i(d))`, `k=60`; take top-10.
5. Bump `retrieval_count` on the chosen rows (popularity signal for future ranking).
6. Optionally append **top-3 semantically-similar prior turns** not already in the L3 window, as a "Relevant prior context" block.

### 5.3 Bi-temporal validity (adapt Zep)

A fact has `valid_from` and a nullable `invalid_at`. Retrieval filters `invalid_at IS NULL`. When extraction detects a contradiction, the superseded fact gets `invalid_at = now` instead of being deleted — so "I switched from React to Vue" cleanly retires the React fact while preserving history for the Profile/audit. No fact is ever lost to overflow.

### 5.4 Effective-score ranking (replaces the 16-cap)

```
effective_score(fact) = importance * exp(-0.01 * days_old)
```

- **Injection ordering** uses `effective_score` (most-important-and-recent first).
- **Eviction** (when a per-user soft cap, e.g. 200 facts, is exceeded) drops the *lowest* `effective_score` **invalid** facts first, then lowest-effective valid facts — never by raw insertion order. A `score === 3` fact is effectively never evicted.

### 5.5 Core Memory / Profile rewrite (adapt Letta Core Memory)

`users.user_profile` is a 200–300 token block: name, working language, expertise, and 3–5 pinned defining facts. It is rewritten by `deepseek-flash` **only when an `importance === 3` fact appears** (not every turn) — so it's nearly free and always injected first with zero retrieval latency. Rewrite prompt: "Given the current profile and these new defining facts, produce an updated ≤300-token profile in the user's language."

### 5.6 Episodic summaries (adapt Letta/Zep episodic)

- **Rolling summary (in-conversation, Phase 2):** when `loadConversationHistory`'s window exceeds ~3000 tokens, return `{ summary, recentTurns }` instead of all 10 turns. Summary is lazily (re)built by `deepseek-flash` only when stale (`summary_up_to_turn` lags the latest turn), folding older turns into prose while keeping the most recent turns verbatim.
- **Cross-session digest (Phase 1):** after a conversation's last turn (or every ~20 turns), write a ~150-word `conversation_digest`. When a **new** conversation starts, inject the user's **last 3 digests** as a "Previous sessions" block so the assistant continues coherently across sessions.

---

## 6. Intent Understanding Design

### 6.1 Replace the regex router with one typed LLM call

Replace `route()` (regex) with `classifyIntent()` — a single `deepseek-flash` call returning typed JSON:

```ts
interface IntentResult {
  intent: "code" | "writing" | "translation" | "planning" | "general";
  standalone_query: string;                 // self-contained rewrite of the user's message
  complexity: "simple" | "complex";
  confidence: number;                        // 0..1
}
```

Prompt (sketch): "You are an intent classifier for a multilingual AI chat. Given the conversation so far and the user's latest message, return JSON with: `intent` (one of …); `standalone_query` — rewrite the latest message into a self-contained question that needs no prior context, resolving pronouns/ellipsis using the conversation (keep the user's language); `complexity` — simple if a single model suffices, complex if it benefits from multiple experts; `confidence` 0–1. Output ONLY JSON."

### 6.2 The `standalone_query` rewrite — the keystone

This is the single highest-leverage fix for follow-up quality. A bare `好` / `yes` / `再详细点` / `そうして` carries no routable or retrievable signal. The rewrite turns it into, e.g., `请详细解释 IVFFlat 索引的 lists 参数如何选择` using the conversation context. That rewritten query then threads into **three** places:

1. **History/answer quality:** the raw prompt is still what the model answers (verbatim), but the assembled context is selected *for* the resolved intent — so the model isn't guessing what `好` means.
2. **Retrieval (§5.2):** `standalone_query` is the retrieval key for both keyword-overlap (P1) and hybrid vector/FTS (P3). A follow-up now retrieves the facts/turns it actually refers to.
3. **Routing (§6.4):** `intent` is computed on the *resolved* meaning, so `好` after a coding question routes to the code model, not "general."

### 6.3 Confidence gating & fallback

- `confidence ≥ 0.6` → trust `intent` for routing/retrieval.
- `confidence < 0.6` → fall back to the cheap default model (today's `gpt-55`/tier fallback via `firstEnabledByTier`) and inject memory generously (don't over-narrow retrieval).
- Malformed JSON or call failure → degrade to the **existing regex `route()`** as a safety net (keep it, don't delete it — it becomes the fallback path). This guarantees the new call can never make routing *worse*.

### 6.4 Routing with intent

`intent → model id` reuses today's mapping (code→`deepseek-pro`, writing→`claude-opus`, translation→`qwen`, planning→`gemini-pro`, general→`gpt-55`), still enablement-aware via `firstEnabledByTier`. New: `complexity === "complex"` can surface a "consider Expert mode" hint in fast mode (advisory only — never silently change the user's mode or billing).

### 6.5 Embedding-based router (Phase 3, optional refinement)

Once embeddings exist, classify `intent` by cosine similarity of the `standalone_query` embedding against pre-computed **class centroids** (10 example sentences per class in zh+en+ja, §4.4). This **reuses the same embedding already computed for retrieval** — so it adds *zero* extra calls — and removes one `deepseek-flash` classification call when the centroid match is confident. The LLM classifier remains the fallback for `standalone_query` rewriting (centroids can't rewrite).

---

## 7. Cost & Latency Analysis

### 7.1 Extra calls/tokens per turn (and how we keep them cheap)

| Item | When | Extra calls | Token cost | Mitigation |
|---|---|---|---|---|
| Intent classify | Every send | +1 `deepseek-flash` | ~300 in + ~120 out | Cheapest model; tiny output; *replaces* zero-cost regex but buys correct follow-ups |
| Fact extraction | Every send (existing) | 0 net new (already exists) | unchanged | Already post-stream, best-effort |
| Embedding (P3) | Every send | +1 embedding | ~$0.00002/query (text-embedding-3-small ≈ $0.02/M) | Negligible; **reused** for both retrieval and router |
| Profile rewrite | Only on importance=3 fact | rare `deepseek-flash` | ~400 tok | Gated by importance; not per-turn |
| Rolling summary | Only when window>3k tok & stale | rare `deepseek-flash` | ~1–2k in → ~400 out | Lazy; amortized across many turns |
| Digest | End of conversation / ~20 turns | rare `deepseek-flash` | ~history in → ~200 out | Amortized; off the hot path |

Net **per-turn hot path** increase: **+1 cheap classify call** (P1–P2) and **+1 embedding** (P3). Everything else is amortized/rare. All are billed and shown — the design's job is to ensure each is *cheap and earns its place.*

### 7.2 Savings that offset (and exceed) the additions

1. **Relevance-scored injection (P1):** top-6 facts vs. ≤16 → ~50% fewer memory tokens *every turn, on every call that carries memory* (single + fusion).
2. **Native-language storage:** no English-translation token inflation for zh/ja facts.
3. **Prompt caching (`cache_control:{type:'ephemeral'}`):** wrap the stable Profile+digests block. In **Expert mode** the trio often includes `claude-opus`; Anthropic prompt caching saves up to ~90% on the cached prefix — and the prefix is the most stable part of the prompt across the 3 experts + 2 fusion calls of a single turn.
4. **Expert-mode memory budget (already the case, formalized):** memory is injected **only into the fusion call**, never into the 3 experts (`fusion.ts` already does this) → ~30% cheaper expert turns with no quality loss (the compiler personalizes).
5. **Confidence-gated routing:** low-confidence turns skip narrow retrieval work; high-confidence complex turns are the only ones nudged toward (opt-in) Expert mode.

Net: the +1 classify/+1 embedding is comfortably paid for by the ~50% memory-token reduction and caching; **expected per-turn cost is flat-to-lower**, while context quality rises sharply.

### 7.3 Latency

- Intent classify adds one `deepseek-flash` round-trip **before** the main call (serial, since routing/retrieval depend on it). Mitigate by keeping output tiny (~120 tok) and capping `maxOutputTokens`. Budget ~300–600 ms.
- Embedding (P3) is ~50–100 ms and can run **in parallel** with profile/digest loads.
- Summary/digest/profile rewrites are **off the hot path** (post-stream or lazy).
- Hybrid retrieval is two indexed Postgres queries (~ms) + RRF in app code.

---

## 8. Adopt vs. Build

We adopt **patterns**, not dependencies. Nothing below adds a runtime framework.

| Capability | Framework that inspired it | What we **adopt** (pattern) | What we **build** (on Postgres/Drizzle) | Do **not** import |
|---|---|---|---|---|
| Additive fact extraction | Mem0 | Extract→score→dedupe→contradiction-aware merge | `extractFacts` returning typed JSON; merge logic | `mem0ai` SDK |
| Bi-temporal validity | Zep | `valid_from` / `invalid_at`, retire-don't-delete | nullable `invalid_at` column + filter | Zep service |
| Core Memory block | Letta / MemGPT | Always-injected, slowly-rewritten profile | `users.user_profile` + gated rewrite | Letta runtime / agent loop |
| Tiered memory (working/recall/archival) | Letta / MemGPT | L0–L3 layering, retrieval into a bounded window | Our assembly pipeline (§3.2) | MemGPT paging engine |
| Episodic summaries | Zep / Letta | Rolling summary + cross-session digests | `conversation_summary` / `conversation_digest` | — |
| Hybrid retrieval (vector+lexical+RRF) | Common RAG / Cognee | Embed query, vector+FTS, RRF dedupe | pgvector + tsvector + RRF in app | Standalone vector DB (Pinecone) |
| Graph memory | Zep / Cognee | **Not adopted** (out of scope) | — | Graph store |
| Embedding model | OpenAI | `text-embedding-3-small`, 1536-d (or reduced via `dimensions`) | One embedding call/turn via existing gateway | — |

Rationale: we already have a transactional Postgres with Drizzle, billing, and a streaming pipeline. The frameworks' *value* is in their patterns; their *cost* is operational surface area we don't want when one extension (`pgvector`) closes the gap.

---

## 9. Phased Roadmap

Ordering principle (from the retrieval research): **most impact / least effort first.** Phase 2 Step "rolling summary" is the highest-impact change for long-conversation quality; Phase 1 "relevance-scored injection" is second. Defer pgvector until Phases 1–2 are stable.

### Phase 1 — No new infra, shippable now

**Goal:** relevant, native-language, scored memory + intent + caching, with zero migrations to storage engine.

| # | Change | Files |
|---|---|---|
| 1.1 | Structured, scored facts: `facts_json` becomes `[{text,category,lastSeen,score}]`; extraction emits `category`+`importance` and writes **native-language** facts (drop "Write each fact in English"). Code-side upcast of legacy `string[]`. | `lib/server/llm/memory.ts` |
| 1.2 | Relevance injection: `formatMemoryForPrompt` takes the `standalone_query` and injects **top-6** by keyword overlap + importance + recency (always keep `score===3`). | `lib/server/llm/memory.ts`, callers in `app/api/chat/route.ts` |
| 1.3 | Intent layer: add `classifyIntent()` (typed JSON, `deepseek-flash`); keep `route()` as the fallback. Wire `intent`→model, `standalone_query`→retrieval, `confidence`→fallback. | `lib/server/llm/router.ts` (or new `intent.ts`), `lib/server/llm/fusion.ts`, `app/api/chat/route.ts` |
| 1.4 | Prompt caching: add `cache_control:{type:'ephemeral'}` after the Profile/memory block for Anthropic models. | `lib/server/llm/gateway.ts` (`buildGatewayPrompt` / `streamViaGateway`) |
| 1.5 | Formalize expert-mode budget: confirm memory only on fusion (already true) and document the invariant in code. | `lib/server/llm/fusion.ts` |
| 1.6 | Core Profile (L0): add `users.user_profile`/`user_profile_at`; gated rewrite on importance=3; inject first. (Column add is trivial; no data migration.) | `schema.ts`, `memory.ts`, `route.ts` |
| 1.7 | Cross-session digests: add `conversations.conversation_digest`/`digested_at`; write on conversation end/every ~20 turns; inject last 3 on a new conversation. | `schema.ts`, `memory.ts`/new `summaries.ts`, `route.ts` |

**Exit criteria:** memory tokens/turn down ~50%; follow-ups (`好`/`yes`) correctly routed & contextualized; Anthropic cache hits visible in usage.

### Phase 2 — One migration (rolling summary & compaction) — **highest long-conversation impact**

| # | Change | Files |
|---|---|---|
| 2.1 | Add `conversations.conversation_summary` + `summary_up_to_turn` (migration in §4.2). | `schema.ts` + migration |
| 2.2 | `loadConversationHistory` returns `{ summary?, recentTurns }` when the window > ~3000 tok; inject the summary into the system block, recent turns as `messages[]`. | `lib/server/contracts/chat-helpers.ts` |
| 2.3 | Lazy re-summarization with `deepseek-flash` when `summary_up_to_turn` is stale (off hot path). | new `lib/server/llm/summaries.ts` |
| 2.4 | Bill/account the summary call like other helper calls (it's shown to the user). | `lib/server/llm/fusion.ts` / accounting |

**Exit criteria:** a 40-turn conversation no longer loses its head; total history tokens bounded even as conversations grow.

### Phase 3 — pgvector (semantic memory & retrieval)

| # | Change | Files |
|---|---|---|
| 3.1 | `CREATE EXTENSION vector`; create `user_memory_facts` (§4.3); backfill from `facts_json` (embed each legacy fact once). | migration |
| 3.2 | Embedding helper via the gateway (`text-embedding-3-small`); embed query + new facts. | new `lib/server/llm/embeddings.ts` |
| 3.3 | Hybrid retrieval (vector top-8 + FTS top-5 + RRF top-10) on `standalone_query`; bi-temporal `invalid_at` on contradiction; `effective_score` ranking. | `memory.ts`, `embeddings.ts` |
| 3.4 | Semantic turn retrieval: `turns.prompt_embedding`; embed prompts async post-turn; inject top-3 similar prior turns as "Relevant prior context." | `schema.ts`, `chat-helpers.ts`, `fusion.ts` |
| 3.5 | Embedding-based intent router: cosine vs. centroids (reuse the query embedding); LLM classifier remains fallback + rewriter. | `router.ts`/`intent.ts`, `intent-centroids.json` |

**Exit criteria:** facts retrievable by meaning across languages; contradictions retire cleanly; intent classification adds zero extra calls (embedding reused).

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Intent classify adds latency before the main answer | Med | Med | Tiny output cap (~120 tok); cheapest model; show "routing…" affordance; centroid path (P3) removes the call when confident. |
| `standalone_query` rewrite drifts/hallucinates a different question | Med | High | Answer the **raw** prompt verbatim; `standalone_query` only drives *selection* (routing/retrieval), never replaces the user's words. Confidence gate + regex fallback. |
| Extra calls visibly raise the user's bill | Med | High | Quantified offsets (§7): ~50% memory-token cut + caching ≥ the +1 cheap call/+1 embedding. Make memory/summary calls *visible* and *cheap*; keep `MEMORY_DISABLED` style kill-switches. |
| pgvector IVFFlat recall too low (small `lists`) | Med | Med | Start `lists=100`, `ANALYZE` after backfill, tune to ~sqrt(rows); FTS arm + RRF cover ANN misses. |
| Contradiction detection wrong → retires a still-valid fact | Low | Med | `invalid_at` is reversible (data retained); only contradictions with explicit `contradicts_memory_id` retire; importance=3 facts never auto-retired without profile-rewrite confirmation. |
| Native-language facts confuse a cross-lingual model | Low | Low | Models in the trio are multilingual; Profile records `working language`; retrieval keyed by `standalone_query` in the same language. |
| Cache breakpoint misplaced → volatile content invalidates cache | Med | Med | Strict ordering: stable (Profile+digests) before the `cache_control` breakpoint; volatile (query facts, rolling summary) after it. |
| Summary loses critical detail | Med | Med | Keep most-recent turns verbatim; summary only folds *older* turns; re-summarize lazily so errors don't compound. |
| Migration of `user_memory` (Phase 3) loses data | Low | High | Backfill, don't drop: keep `user_memory` until `user_memory_facts` is verified; dual-read window; embed legacy facts before cutover. |
| Best-effort memory write silently fails | Med | Low | Already non-throwing (`learnFromTurn`); add structured `log.warn` on every failure path (some exist today) and a profile-health surface in the admin/profile view. |

---

## 11. Test & Verification Strategy

### 11.1 Unit
- **Fact merge/eviction:** dedupe by lowercased text; keep highest `score`; `effective_score` ordering; importance=3 never evicted; legacy `string[]` upcasts correctly.
- **Relevance injection (P1):** top-6 selection deterministic for a given `standalone_query`; `score===3` always included.
- **Intent parsing:** malformed JSON → regex fallback; confidence gate boundaries (0.6); `standalone_query` passthrough when the message is already self-contained.
- **Bi-temporal (P3):** contradiction sets `invalid_at`; retrieval excludes invalid; audit query can still read retired facts.
- **RRF (P3):** known vector+FTS rank inputs produce the expected fused top-10.

### 11.2 Integration
- **Follow-up resolution (the keystone):** a scripted conversation `["如何用 pgvector 建索引?", "好，再详细点"]` must (a) rewrite the second turn into a self-contained query, (b) route to the code model, (c) retrieve the pgvector facts. Repeat in zh, zh-TW, en, ja.
- **Cross-session memory:** conversation A teaches a fact; a *new* conversation B surfaces it (via digest in P1, via retrieval in P3).
- **Long-conversation compaction (P2):** a 40-turn conversation keeps head context via the rolling summary; assert the summary covers turn 1 facts after turn 35.
- **Expert-mode budget:** assert experts receive **no** memory preamble and fusion does (snapshot the prompts built by `buildGatewayPrompt`).

### 11.3 Cost/latency regression (it's billed and shown!)
- Golden-token test: assert injected memory tokens/turn drop vs. baseline (≥ ~40% on a fixed fixture).
- Assert Anthropic prompt-cache `cache_creation`/`cache_read` tokens appear in usage for Expert turns with a stable profile.
- Latency budget assertion on `classifyIntent` (p95 under a threshold with a mocked fast model).
- Per-turn call-count assertion: fast turn = 1 answer + 1 classify (+1 embedding in P3); expert turn = 3 experts + 2 fusion + 1 classify (+1 embedding) — no accidental extra calls.

### 11.4 Quality (offline eval)
- A small labeled set per language for **intent accuracy** vs. the old regex (must not regress; target meaningful lift on follow-ups).
- Retrieval relevance (P3): precision@10 on a hand-labeled fact/query set; RRF vs. vector-only vs. FTS-only ablation.
- Contradiction handling: scripted "I switched X→Y" pairs; assert old fact retired and new surfaced.

### 11.5 Safety / regression guards
- Sensitivity filter still blocks contact/financial/health/credential/ID data (carry over today's test).
- Kill switches: `MEMORY_DISABLED=1` (existing) plus new `INTENT_LLM_DISABLED` (fall back to regex) and `SUMMARY_DISABLED` — verify the chat path is unaffected when each is off.
- Best-effort guarantee: inject a thrown error into extraction/summary/embedding and assert the user-facing turn still completes and bills correctly.

---

## Appendix A — File-level change map (quick reference)

| File | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| `lib/server/db/schema.ts` | `users.user_profile*`, `conversations.conversation_digest*`; (facts_json shape only, no DDL) | `conversations.conversation_summary`, `summary_up_to_turn` | `user_memory_facts` table, `turns.prompt_embedding`, `vector` ext |
| `lib/server/llm/memory.ts` | structured/native/scored facts, top-6 injection, profile rewrite, digests | — | per-fact rows, bi-temporal, hybrid retrieval, effective_score |
| `lib/server/llm/router.ts` (+ new `intent.ts`) | `classifyIntent()`, keep `route()` as fallback | — | centroid embedding router |
| `lib/server/llm/gateway.ts` | `cache_control` on memory block | — | embedding helper plumbing |
| `lib/server/llm/fusion.ts` | wire intent result; keep experts memory-free | bill summary call | bill embedding; inject "relevant prior context" |
| `lib/server/contracts/chat-helpers.ts` | — | `{summary, recentTurns}` compaction | semantic turn retrieval |
| `app/api/chat/route.ts` | call `classifyIntent`; pass `standalone_query` to retrieval; inject profile+digests | pass summary into assembly | pass embedding/retrieved context |
| new: `lib/server/llm/summaries.ts` | digests | rolling summary | — |
| new: `lib/server/llm/embeddings.ts` | — | — | `text-embedding-3-small` calls |
| new: `lib/server/llm/intent-centroids.json` | — | — | class centroids (zh/en/ja) |
