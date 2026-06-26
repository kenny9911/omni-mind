# Decision: LLM Integration — Build a custom SDK vs. use the Vercel AI SDK

**Status:** Accepted · **Date:** 2026-06-18 · **Owner:** Engineering

## Question

OmniMind must call **12 first-party models across 6+ vendors** (DeepSeek, Zhipu, ByteDance,
Moonshot, MiniMax, Alibaba, Google, OpenAI, Anthropic) **plus OpenRouter** as a gateway to
300+ more, in two orchestration modes (single best-model "Fast", and parallel "Multi-expert"
with a fusion/compiler stage), with **precise per-call token & cost accounting**, streaming,
intent routing, and full activity logging.

Do we **build our own multi-provider LLM service/SDK**, or **adopt the Vercel AI SDK**
(optionally via the Vercel **AI Gateway**)?

## Options

### A. Build a bespoke multi-provider SDK
Hand-roll HTTP clients per vendor, normalize request/response/stream shapes, implement
SSE parsing, tool-calling, structured output, retries, and a usage/cost normalizer.

- **Pros:** maximal control; no dependency.
- **Cons:** we would re-implement — and then maintain — exactly what already exists as a
  hardened, standardized layer: per-provider auth, streaming protocol differences,
  tool/format normalization, token-usage normalization, failover. High cost, ongoing
  breakage risk as 12+ provider APIs drift, and slower delivery. Token-usage fields differ
  per vendor; getting cost accounting "very precise" (an explicit requirement) is exactly
  the fiddly part a normalized SDK solves.

### B. Vercel AI SDK v6 (+ AI Gateway)  ✅ CHOSEN
Use the `ai` package with a **unified `"provider/model"` string** routed through the
**AI Gateway**. One API for every provider, **standardized `usage` object**
(`inputTokens` / `outputTokens` / `reasoningTokens` / `totalTokens`) on every result and
stream, native **streaming**, **tool calling**, **structured output** (`generateObject`),
**provider fallbacks**, observability, and zero-data-retention.

- **Pros:** unified access to all required vendors **and OpenRouter**; standardized usage
  for exact cost math; streaming + multi-step + structured output out of the box; failover;
  far less code to own; fastest path to "implement entirely" and "all use cases pass".
- **Cons:** a dependency and the Gateway as a routing hop (mitigated: AI SDK can also call
  providers directly; the Gateway is opt-in per call).

## Decision

**Adopt the Vercel AI SDK v6, accessed through the AI Gateway via plain `"provider/model"`
strings** (per Vercel guidance — no provider-specific packages unless a model needs direct
wiring). We **wrap** it in our own thin **LLM Gateway service** (`lib/server/llm/`) that
owns the parts that are genuinely _our_ product logic and where we keep "full flexibility":

- **Intent routing** (prompt → best model) and **Multi-expert orchestration** (parallel
  experts → reasoning trace → final-compiler synthesis).
- **Cost engine** — maps the SDK's normalized `usage` to our per-1M pricing table and the
  per-call platform fee; persists a precise ledger.
- **Provider registry** — our 12 models + tiers + pricing + enable/disable + OpenRouter.
- **Deterministic mock provider** — a `MockLanguageModelV2` / `simulateReadableStream`
  implementation backed by the existing content engine, selected by `LLM_MODE=mock`, so the
  whole product **runs and all tests pass with zero API keys**. `LLM_MODE=gateway` switches
  to real models. This dual mode is the key enabler for CI and local dev.

This gives us the flexibility of a custom service (our orchestration, routing, pricing,
logging, mock mode) **without** re-implementing the commodity transport/normalization layer.

## Consequences

- Add deps: `ai` (v6). Optional `@ai-sdk/openai` etc. only if a model ever needs direct wiring.
- All model calls go through `lib/server/llm/gateway.ts`; nothing calls a provider directly.
- Cost accounting is driven by the SDK's standardized `usage`, not scraped per-vendor.
- Env: `AI_GATEWAY_API_KEY` (prod), `LLM_MODE=mock|gateway` (default `mock`).

---

## Addendum (2026-06-26): Option A — direct providers (BYOK), gateway optional

Follow-up question: *"If Vercel AI Gateway costs extra, why not implement the gateway
myself and support a limited number of models?"*

**Finding (verified against Vercel docs, updated 2026-06-20):** the cost premise is
largely false. The AI Gateway adds **no markup** over provider list price — *"no markup or
fee from AI Gateway"* with BYOK, and zero‑markup on Vercel‑billed credits too (the historical
~5% credit markup is gone). There is no flat per‑request gateway fee; the only extra charges
are opt‑in add‑ons (custom reporting, team allowlist, team ZDR) that this app does not enable.
Caveats: BYOK requires the paid tier (a purchased credits balance), and a failed BYOK request
silently bills a fallback against credits.

So "self‑host the gateway to dodge the markup" saves nothing on tokens. The real alternative
is **not** hand‑rolling raw `fetch()` per provider (that re‑litigates Option A — rejected
above and forfeits the SDK's streaming/usage normalization). It is keeping the AI SDK and
swapping the **gateway default resolver** for **direct `@ai-sdk/*` provider packages with
BYOK** — no Vercel hop, no markup, ~one small change.

### What was implemented

- `lib/server/llm/providers.ts` — `resolveModel(id)` returns a direct provider instance when
  that model's key is set, else the bare gateway slug string (current behavior). Resolution is
  **per‑model**, so adoption is incremental: set `OPENAI_API_KEY` → GPT goes direct; leave a
  provider's key unset → it transparently uses the gateway. `LLM_FORCE_GATEWAY=1` overrides.
- `lib/server/llm/gateway.ts` — the single `streamText({ model })` call now takes
  `await resolveModel(id)`; everything else (onError capture, usage, streaming) is unchanged.
  Added `llmConfigured()` = gateway key **or** any direct key; the real‑chat 503 guard uses it.
- Packages: `@ai-sdk/openai@3`, `@ai-sdk/anthropic@3`, `@ai-sdk/google@3`, `@ai-sdk/deepseek@2`,
  `@ai-sdk/openai-compatible@2` — pinned to the `@ai-sdk/provider@3` majors that match
  `ai@6.0.207` (the `@4` line targets the unreleased `provider@4`/`LanguageModelV4` spec).
- Coverage: `tests/providers.test.ts` (7 cases — selection, force‑gateway, gateway‑only
  models, OpenAI‑compatible opt‑in, `llmConfigured`). Live‑verified the gateway **fallback**
  still streams a real chat. Full suite: 219 green.

### Provider mapping (gateway‑only by default for the long tail)

| Model id | Direct path | Key |
|---|---|---|
| gpt-55, gpt-mini | `@ai-sdk/openai` | `OPENAI_API_KEY` |
| claude-opus | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` |
| gemini-pro, gemini-flash | `@ai-sdk/google` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| deepseek-pro, deepseek-flash | `@ai-sdk/deepseek` | `DEEPSEEK_API_KEY` |
| qwen | `@ai-sdk/openai-compatible` (DashScope) | `DASHSCOPE_API_KEY` |
| kimi | `@ai-sdk/openai-compatible` (Moonshot) | `MOONSHOT_API_KEY` |
| glm, doubao, minimax | **gateway only** (no first‑party package) | — |

Per‑provider model‑id strings live in `providers.ts`; edit them to whatever your account
exposes (they need not equal the gateway slug). The Chinese long‑tail keeps using the gateway,
which is exactly the OpenAI‑compatibility plumbing self‑hosting would force you to maintain.

### Recommendation captured

Don't switch for cost (no markup exists). If you want off Vercel for independence, use this
direct‑provider path (not raw `fetch`), limited to the first‑party‑package providers. Keep the
gateway for the single key, the Chinese models out‑of‑the‑box, and latent failover/ZDR — and
fund the paid tier so `claude-opus`/`gpt-5` stop hitting free‑tier 403/429.

---

## Addendum 2 (2026-06-26): layered resolution with the user's real keys

The user supplied real keys for OpenAI, Anthropic, Gemini, DeepSeek, Kimi (Moonshot),
GLM (Zhipu), plus **OpenRouter** and the Vercel gateway. `resolveCandidates(id)` now returns
an **ordered candidate list** and `streamViaGateway` tries them in turn, falling through only
when a candidate errors *before emitting output* (so a wrong model id or a slow endpoint
degrades transparently, never mid-stream):

1. **Dedicated** provider (your own key) — cheapest/direct.
2. **OpenRouter** (`OPENROUTER_API_KEY`) — one key, slugs verified against its live catalog;
   primary for models without a dedicated key, fallback for the rest.
3. **Vercel AI Gateway** slug — final fallback.

A `llm.fallback_used` info log fires whenever a non-primary candidate serves, so a misconfigured
dedicated id is observable. `LLM_FORCE_GATEWAY=1` collapses to the gateway only.

### Verified live (all 12 models stream real output)

| Served by **dedicated key** (cheapest) | Served by **OpenRouter** |
|---|---|
| deepseek-pro/flash, gpt-55/mini, gemini-pro/flash, glm, kimi, **claude-opus** | qwen, doubao, minimax |

### Provider gotchas found & fixed (per `lib/server/llm/providers.ts`)

- **Anthropic**: `@ai-sdk/anthropic@3` fails to parse the stream against this `ai@6.0.207`
  line ("stream ended without a finish chunk") even though raw HTTP works. Routed claude-opus
  through Anthropic's **OpenAI-compatible endpoint** (`https://api.anthropic.com/v1`,
  `@ai-sdk/openai-compatible`) instead — uses the direct key, streams correctly.
- **Kimi**: the supplied Moonshot key authenticates on the **`.cn`** endpoint, not `.ai`
  (`https://api.moonshot.cn/v1`, model `kimi-k2.6`). (China endpoint can be slow → OpenRouter
  `moonshotai/kimi-k2.6` covers it if the dedicated call times out.)
- **OpenRouter slugs** (verified): `deepseek/deepseek-v4-pro|flash`, `openai/gpt-5.5|gpt-5.4-mini`,
  `anthropic/claude-opus-4.8`, `google/gemini-3.1-pro-preview|gemini-3.5-flash`, `z-ai/glm-5.2`,
  `bytedance-seed/seed-2.0-mini`, `moonshotai/kimi-k2.6`, `minimax/minimax-m3`, `qwen/qwen3.7-plus`.

Dedicated model ids favor cost (e.g. `deepseek-chat`, `gemini-2.5-pro`, `glm-4.5`); bump them in
`providers.ts` if you want the exact newest versions the OpenRouter slugs target.
