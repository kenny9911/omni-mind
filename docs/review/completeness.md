# OmniMind Backend Review — PRD/Functional Completeness

**Dimension:** Cross-check of every FR-*/NFR-* in `docs/PRD.md` against the implementation in
`lib/server/**` and `app/api/**`, with emphasis on the mandatory "log every activity / token / cost /
latency" requirement. Claims were verified by reading code, not comments.

**Verdict:** The backend is broadly faithful and unusually complete — all 46 FRs have a corresponding
route/handler, all 10 user stories are wired, and the pervasive-observability requirement (NFR-13) is
genuinely met through a shared wrapper. The findings below are mostly partial-implementation gaps and
spec-vs-code drifts; none are showstoppers, but two functional flags are effectively dead.

---

## Findings

### P1 — `deepAgents` flag is completely inert (FR-39, US9.UC3)
**Evidence:** `deepAgents` is validated, persisted, returned by `me`, threaded into `RunTurnCfg`
(`lib/server/llm/fusion.ts:28`, `app/api/chat/route.ts:102,139`, `regenerate/run.ts:93`), but it is
**never read** in the turn execution. Grep of `lib/server/llm/fusion.ts` shows the only behavioral input
flag consumed is `deepResearch` (via `inflate`, lines 39/104/145). `deepAgents` appears nowhere in the
run logic, token math, content, or emitted events.
FR-39 / US9.UC3: "Deep Research / Deep Agents toggles persist and **annotate subsequent turns**." The
persistence half is done; the "annotate subsequent turns" half is missing for Deep Agents entirely.
**Recommendation:** Give `deepAgents` an observable effect parallel to `deepResearch` — e.g. an
agent-step annotation in the payload and/or an input-token inflation — or explicitly document in the PRD
that Deep Agents is persistence-only in v1 (it currently reads as a functional toggle).

### P1 — Deep Research has no model-call-level effect beyond a token bump; "research-step annotations" are not produced by the backend (FR-39)
**Evidence:** The only effect of `deepResearch` is `inflate(base, dr) = base + (dr ? 600 : 0)`
(`lib/server/llm/fusion.ts:39`), adding 600 input tokens. The mock content engine `mockText`
(`lib/server/llm/mock.ts:14-28`) ignores `deepResearch` and never emits research steps. FR-39 states
"in mock mode Deep Research **adds the existing research-step annotations** and may inflate input tokens."
**Mitigating fact (verified):** The frontend sources `researchSteps` from the **static i18n dictionary**
(`lib/i18n.ts:253` `RESEARCH_STEPS[lang]`) and renders them gated on `am.deepResearch`
(`lib/viewModel.ts:122,350`), NOT from the turn payload. Because the backend correctly persists
`turns.deep_research`, the UI's static research steps still display. So UI parity is preserved by accident
of the frontend's design, but the backend does **not itself** emit/persist any research-step content, and
nothing surfaces them over SSE or in `GET …/messages`.
**Recommendation:** Either (a) emit a `research.step` SSE event + persist the steps in the assistant
payload so the contract is self-contained and a non-prototype client can render them, or (b) tighten
FR-39's wording to "Deep Research sets a turn flag that the client renders against its static step list,
plus an input-token inflation."

### P1 — All-experts-fail path still runs and bills a fusion call over nothing (NFR-16, FR-9)
**Evidence:** In expert mode, if every expert errors, `surviving = experts.filter(e => e.ok)` is empty
(`lib/server/llm/fusion.ts:164`), `turnStatus = "partial"`, but execution falls straight through to the
fusion stage (lines 187-231): it streams `fusion-reason`/`fusion-answer`, bills a fusion `usage_records`
row with `fusionInput = 200 + 0`, and emits a normal `turn.done`. NFR-16 frames graceful degradation as
"the turn proceeds with **remaining** experts" — with zero remaining experts there is nothing to fuse, yet
the user is still charged a fusion call (cost + ¥0.05) for a synthesis with no inputs. There is no guard
for `surviving.length === 0`.
**Recommendation:** When `surviving.length === 0`, emit a typed `error` event (e.g. `ALL_EXPERTS_FAILED`),
set turn status `failed`, and do not bill a fusion call. Add a test for the all-fail case (current
us3 tests only exercise the happy path).

### P2 — Fast mode never emits `answer.delta`; the documented SSE contract is violated (FR-10, technical-design §6)
**Evidence:** `docs/technical-design.md:838,853-854` specify the Fast sequence as
`turn.start → route → call.start → call.delta* → answer.delta* → call.usage → turn.usage → turn.done`,
and explicitly define `answer.delta` as "fast: single answer; expert: consolidated fusion answer." The
implementation's Fast path emits **only** `call.delta` for the visible answer
(`lib/server/llm/fusion.ts:112`) and never emits `answer.delta`. The us2 test was written to the
implementation, not the spec — it asserts the answer arrives via `call.delta`
(`tests/us2-fast-chat.test.ts:65,73`), so the suite passes while the contract is unmet.
**Impact:** Low today because the delivered prototype frontend does not consume named SSE events (it still
uses its in-memory simulation; grep finds no `answer.delta`/`call.delta` consumer in `lib/store.ts` or
`lib/client/api.ts`). But any client coded against the published contract would break on Fast turns.
**Recommendation:** Either emit `answer.delta` (in addition to or instead of `call.delta`) on the Fast
single answer, or correct §6 of technical-design and FR-10 to state Fast uses `call.delta` only. Pick one
source of truth.

### P2 — `GET/PATCH /api/billing/payment-method` is implemented as PUT, not PATCH (FR-30)
**Evidence:** FR-30 specifies "`GET/PATCH /api/billing/payment-method`." The handler exports
`GET` and `PUT` (`app/api/billing/payment-method/route.ts:7,24`), with no `PATCH`. A client following the
PRD verb would 405.
**Recommendation:** Add a `PATCH` alias (or export the same handler under both verbs), or fix FR-30 to say
PUT. Trivial.

### P2 — FR-31 says Enterprise change is a "contact-sales no-op record"; implementation rejects with 409 (FR-31)
**Evidence:** FR-31: "`POST /api/billing/subscription` changes the plan … Enterprise routes to a
'contact sales' **no-op record**." The handler instead throws `409 PLAN_REQUIRES_SALES`
(`app/api/billing/subscription/route.ts:76-78`) and writes no record. The intent (don't actually switch to
Enterprise) is honored, but "no-op record" implies a logged contact-sales artifact, not an error.
**Recommendation:** Decide the desired UX: if a 409 is preferable, update FR-31 wording; if a record is
wanted, write a lightweight "sales contact" row and return 200. Currently spec and code disagree.

### P2 — `auth/signup` plan seed is hardcoded `pro`; FR-1's "Free or Pro plan (configurable seed)" is not configurable (FR-1)
**Evidence:** `app/api/auth/signup/route.ts:41` hardcodes `planId: "pro"` and `seedNewUser` defaults to
`pro` (`lib/server/db/seed.ts:35`). There is no env knob (e.g. `SIGNUP_DEFAULT_PLAN`) to choose Free vs
Pro as FR-1 promises ("configurable seed"). SSO does the same (`auth/sso/route.ts:40`).
**Recommendation:** Read the default plan from an env var (defaulting to `pro`) and pass it to
`seedNewUser({ planId })`, or strike "(configurable seed)" from FR-1.

### P2 — `turns.routeText` column is written `null` and never updated; routeText survives only via the message payload (FR-8, FR-35)
**Evidence:** On fast+auto, `routeText` is computed and emitted (`lib/server/llm/fusion.ts:99-100`) and
stored inside the assistant message payload (`payload.routeText`, line 128), but the `turns` row keeps
`routeText: null` (set at insert, `app/api/chat/route.ts:100`, never updated in `fusion.ts`). The
rehydration endpoint compensates by preferring the payload and only falling back to the column
(`app/api/conversations/[id]/messages/route.ts:67-68`), so history is correct. But the column is dead, and
any consumer reading `turns.routeText` directly (e.g. the ledger, future admin views) would always see
null.
**Recommendation:** Persist `routeText` onto the turn row after routing (one `update`), so the column is
not misleading dead data. Minor but it's a latent foot-gun.

### P2 — `FR-43/44` activity query/export use a different URL shape than the PRD (`/api/activity/export` vs `?export=`)
**Evidence:** FR-44: "`GET /api/activity?export=csv|json`." The implementation puts export on a separate
sub-route `GET /api/activity/export` (`app/api/activity/export/route.ts`) and reserves
`GET /api/activity` for the query (`app/api/activity/route.ts:36`). Functionally complete and arguably
cleaner, but the published contract URL differs.
**Recommendation:** Either accept `?export=` on `/api/activity` (delegating to the export handler) or align
FR-44 to the sub-route. Cosmetic.

---

## Genuine strengths (verified, not taken on faith)

- **Pervasive observability is real (NFR-13/13, FR-41/42).** Exactly one `activity_logs` row is written
  for **every** served request — success, 4xx, and 5xx — in the shared wrapper
  (`lib/server/http.ts:116-126`, `writeActivity` in `log/activity.ts:23`), including latency, route,
  method, status, and request id. Every model call writes one `usage_records` row from the single gateway
  call site (`fusion.ts:59-90` → `writeUsage`), carrying in/out/reasoning tokens, costMicro,
  platformFeeMicro, latency, role, and a `pricingFallback` meta marker. Logging cannot break a request
  (try/catch in `writeActivity`). Both DB sinks are mirrored to stdout JSON (`log/logger.ts`), satisfying
  FR-46. This is the standout part of the delivery.
- **Cost engine is integer micro-CNY end to end (NFR-6/FR-20).** `cost.ts:20-32` does
  `round(in*pin) + round((out+reason)*pout)`; aggregates re-sum the same integer columns
  (`usage/aggregate.ts:31-53`), so totals equal the per-call sum with no float drift. Fee is per call,
  `feeMicro = fee * callCount` (`fusion.ts:248`) — Fast = 1 fee, expert = experts+1 fees (NFR-7).
- **Registry-drift guard exists (R1).** A test asserts the server registry equals `lib/models.ts` for
  ids/prices/tiers (`tests/us5-models.test.ts:70`), the mitigation the PRD promised.
- **Routing is enablement-aware and a faithful port (FR-13, US4.UC5).** `llm/router.ts` reproduces the
  content.ts regex order and falls back to first-enabled-by-tier when the matched model is disabled,
  setting `fallback:true`. Disabled models are excluded from routing/trio/main across
  `chat/route.ts:69-90`, `preferences`, and `models/[id]` PATCH (409 guards on disabling main/trio member).
- **Partial-expert billing is correct for the realistic case (NFR-16).** Surviving experts are billed,
  failed ones are emitted as `call.error` with a zero-cost payload entry and turn status flips to
  `partial` (`fusion.ts:156-185`) — exactly what NFR-16 asks for (the only gap is the all-fail corner,
  flagged P1 above).
- **SSE hygiene (NFR-2/17).** 15s heartbeat comments, `AbortController` wired to stream `cancel()` so a
  client disconnect aborts in-flight model work, `x-accel-buffering: no`, and safe-enqueue guards
  (`lib/server/sse.ts`). Single-flight guard prevents concurrent streams in one conversation
  (`chat-helpers.ts:86`).
- **Regenerate replaces in place and rewrites usage (FR-12/US3.UC5).** Old assistant message (seq=1) and
  the turn's `usage_records` are deleted, the same `turnId` is reused, status reset to streaming
  (`regenerate/run.ts:62-72`) — fresh usage written on re-run.
- **i18n coverage (FR-38/NFR-19).** Route labels, plan features, mode/plan names all flow through
  `pick()` with the 4 langs and en→zh fallback (`billing/plans.ts`, `router.ts`, `models` DTO tags).

---

## Summary line
P0: 0 · P1: 3 · P2: 6 — Functionally near-complete and observability is genuinely pervasive; main gaps are an inert `deepAgents` flag, no backend research-step output, an unguarded all-experts-fail fusion bill, and several spec-vs-code contract drifts (Fast `answer.delta`, payment-method verb, Enterprise change, export URL shape).
