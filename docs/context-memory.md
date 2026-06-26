# Context Engineering — Compact User Memory

A bounded, distilled memory of *who the user is* that personalizes answers without
replaying whole histories into every prompt. Built for [Prompt 8](prompts.md): "design and
implement a context engineering mechanism … a compact memory … so that we don't pollute the
current context and over-spend on the tokens."

## Principle

We do **not** store or inject raw conversation history. After each real send, a cheap model
distills **0–3 durable facts about the user** and merges them into a small, capped set. That set
is injected as a tiny preamble into the answer-producing calls. So context is **distilled, not
accumulated**, and stays small by construction.

```
send ─▶ runTurn (answer streams) ─▶ void learnFromTurn()   ── fire-and-forget, cheap
                                          │
                                          ▼
                        deepseek-flash extracts 0–3 user facts
                                          │  merge: dedupe + cap (16 facts × 120 chars)
                                          ▼
                                   user_memory (DB)
                                          │
next send ─▶ loadMemoryFacts ─▶ formatMemoryForPrompt ─▶ injected into single + fusion calls
```

## Compactness (the explicit goal)

| Bound | Value | Where |
|---|---|---|
| Max facts kept | **16** (newest win) | `mergeFacts` cap |
| Max chars/fact | **120** | per-fact truncation |
| Max memory size | ≈ **1.9 KB** (~500 tokens) | 16 × 120 |
| Injected into | **single + fusion-reason + fusion-answer only** | not the 3 experts |
| Extraction output cap | **220 tokens** | `maxOutputTokens` |

The experts deliberately run *without* the preamble — they give independent raw takes and the
compiler (which has the memory) personalizes the synthesis. That keeps the memory out of 3
parallel calls. Injected memory tokens **are** counted into `inputTokens` so the cost ledger
stays accurate ([fusion.ts](../lib/server/llm/fusion.ts)).

## Learning (distillation)

[`lib/server/llm/memory.ts`](../lib/server/llm/memory.ts) · `learnFromTurn`:
- Skipped entirely for the **mock/demo** engine and when `MEMORY_DISABLED=1`; skipped for sends
  under 8 chars. Best-effort — never throws, never affects the chat turn.
- The cheap model (`MEMORY_MODEL`, default `deepseek-flash`) is told the already-known facts and
  asked for **only new** ones, **only about the user** (not the assistant's reply, not one-off
  task specifics). It **never records sensitive PII** (contact details, financial, health,
  credentials, government IDs). Facts are written in English for compactness.
- `mergeFacts` normalizes whitespace, truncates to 120 chars, dedupes case-insensitively, and
  caps to the newest 16. Only persisted if something changed; logs `memory.updated` with **counts
  only** (never fact content).
- Extraction goes through `streamOne` → `resolveCandidates`, so it inherits the full provider
  fallback chain (dedicated → OpenRouter → gateway).

## Injection

The chat route loads the caller's facts → `formatMemoryForPrompt` → `cfg.memory`; `fusion.ts`
passes it to the single + fusion `streamOne` calls; `buildGatewayPrompt` prepends:

```
Context about this user (apply when relevant; never mention or repeat it verbatim):
- User is a data scientist.
- User works primarily in Python and pandas.
- User prefers detailed explanations.

---

<the user's actual prompt>
```

## Transparency & control

- `GET /api/memory` → `{ facts, updatedAt }`; `DELETE /api/memory` clears it.
- The **Profile** page shows "What we remember" — the live fact list, last-updated time, and a
  **Clear** button (hidden for the read-only demo account).
- Strictly per-user: every read/write is scoped to `requireUser`'s id; `user_memory` cascades on
  account deletion (and is also deleted explicitly by the admin delete handler).

## Verified

- **Cross-conversation recall (the real test):** established "my name is Zephyr Qu-7, I program
  in Haskell" in one conversation; in a **brand-new** conversation, "what is my name and language?"
  → *"Your name is Zephyr Qu-7, and you exclusively program in Haskell."* The model recalled it
  purely from the injected memory, not shared history.
- Incremental, deduped learning across turns; PII guard holds; demo learns nothing; `tsc` clean;
  **233 tests** pass incl. [`tests/memory.test.ts`](../tests/memory.test.ts) (merge/cap/format +
  GET/DELETE + mock no-op). Adversarially reviewed (privacy/isolation, token-cost, UX) with fixes
  applied.

## Config

`MEMORY_MODEL` (default `deepseek-flash`), `MEMORY_DISABLED=1` to turn off — see
[.env.example](../.env.example).
