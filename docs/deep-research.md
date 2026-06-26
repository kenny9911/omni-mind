# Deep Research — real web retrieval

Deep Research used to be **decorative**: the panel showed a hard-coded `"检索网页 12 篇"`
and the backend only added 600 fake input tokens. There was no web retrieval and no real
sources. Driven by [Prompt 9](prompts.md) — *"真的有检索网页12篇？…请列出 sources"* — it now does
**real** web search.

## How it works

When Deep Research is on (real account + `OPENROUTER_API_KEY`), `runTurn` runs one retrieval pass
up front via [`research.ts`](../lib/server/llm/research.ts):

```
deepResearch ON ─▶ webSearch(prompt)                       OpenRouter web plugin (Exa-backed)
                     │  returns url_citation annotations
                     ▼
        real sources [{title,url}] + grounded notes
                     │
   emit research.start / research.sources ──▶ UI shows the REAL count + clickable chips
                     │
   inject findings (cite [n]) into the single + fusion answer prompts ──▶ grounded answer
                     │
   bill the retrieval call (role="research") ──▶ shows in the cost ledger
```

- **Model:** a cheap web-capable model (`RESEARCH_MODEL`, default `deepseek/deepseek-v4-flash`),
  `max_results: 8`. Sources are deduped by URL and capped at 8.
- **Honest by construction:** the panel's first step is now `"检索网页 N 篇"` with the **real N**
  (or `"联网检索"` when N = 0). Demo/mock accounts and accounts without an OpenRouter key get
  **no fake count** — they show the generic label and no sources.
- **Graceful:** any failure (no key, HTTP error, timeout) returns null → the turn proceeds normally
  with no sources, never blocking the answer.
- **Persisted:** sources are stored in the assistant payload and restored on conversation reload.

## Verified live (your OpenRouter key)

A Deep Research turn on *"newest Vercel AI Gateway features 2026"* retrieved **8 real sources**
(`vercel.com/changelog/opus-4-8-on-ai-gateway`, `github.com/vercel/ai/releases/@ai-sdk/gateway@4.0.0`,
`vercel.com/docs/ai-gateway`, …), the answer cited them, and a `role="research"` row appeared in the
ledger. The UI rendered all 8 as clickable domain chips under the research panel with 0 console
errors.

## Config

`RESEARCH_MODEL` (OpenRouter slug, default `deepseek/deepseek-v4-flash`); requires
`OPENROUTER_API_KEY`. See [.env.example](../.env.example).
