# Review — Use-case Correctness & Coverage (US1.UC1 … US10.UC5)

**Reviewer dimension:** Use-case correctness & coverage (adversarial).
**Method:** Read the contract (`docs/technical-design.md` §1–6, `docs/user-stories*.md`), then
verified each UC against its real route handler + the asserting test. Ran the suite:
**187/187 passing** (`npx vitest run`). Spot-checked ~15 handlers against contract status
codes, error codes (§5), and response shapes (§2).

**Verdict:** The backend is genuinely strong — all 50 UCs have a real endpoint and at least
one asserting test, money/cost accounting is exact and integer-clean, ownership scoping is
consistent, and the SSE/orchestration pipeline matches the contract for the happy paths. The
defects below are concentrated in (a) **regenerate fidelity**, (b) **alt-flow paths that are
structurally untestable in mock mode and therefore unverified**, and (c) a handful of
**contract-vs-implementation drifts** that the tests were written *around* rather than *against*.

---

## Severity summary

- **P0 (blocker):** 0
- **P1 (important):** 4
- **P2 (nice-to-have):** 8

---

## P1 — Important

### P1-1. Regenerate uses *current preferences* trio/compiler, not the *original turn's* — violates US3.UC4 / US8.UC5
**Evidence:** `app/api/chat/regenerate/run.ts:53` calls `resolveSettings(ctx.db, userId, {})`
with an empty body, so `trio` and `mainModel` come from the **current `preferences` row**
(`lib/server/contracts/chat-helpers.ts:64-72`), not the turn being regenerated. The `turns`
table persists only `mode, promptText, routeText, deepResearch, deepAgents`
(`lib/server/db/ddl.ts:62-78` / `schema.ts`) — **the trio and compiler used for the original
turn are never stored**, so they cannot be reproduced.

US3.UC4 main flow: "reloads the original turn's `promptText`, **same trio**, and **same
compiler**". US8.UC5: "re-runs the **same prompt, mode, model/trio** as the original turn." If
the user edits their trio/main between the original send and the regenerate, the regeneration
silently runs a **different** trio/compiler.

**Why it passes today:** `tests/us3-expert-fusion.test.ts:279-304` regenerates an expert turn
but only asserts `call.start` *count* (3) and `callCount` (4) — it never checks the re-run uses
the *same model ids* as the original `TRIO`. The original send used `TRIO =
["deepseek-pro","claude-opus","qwen"]` while seeded prefs are
`["deepseek-pro","gpt-55","claude-opus"]`, so the regeneration actually streams a different
trio, and the test is blind to it. `tests/us8-conversations.test.ts:343` regenerates a *fast/auto*
turn, where re-routing the same prompt coincidentally re-selects the same model — masking the bug.

**Recommendation:** Persist `trio_json` and `compiler`/`main_model` on the `turns` row at send
time; in `regenerateStream`, read them from the turn (not preferences). Add a test asserting the
regenerated expert turn's three `call.start` modelIds equal the *original* trio after the user
has changed their preference trio.

### P1-2. Degraded-expert alt-flow (US3.UC1/UC5) is unimplemented in observable form and untestable
**Evidence:** In mock mode `streamOne` **always** returns `status:"ok"`
(`lib/server/llm/gateway.ts:38-47`; there is no error-injection hook). The degraded branch in
`lib/server/llm/fusion.ts:156-165` is therefore **dead code in mock** and has **no test**. Worse,
even if reached, the contract requires the degraded count be "flagged in `details`"
(US3.UC1 alt-flow, §3.3) — but `fusion.ts` only sets `turnStatus="partial"` and emits **no**
`details`/degraded count on `turn.usage`, `turn.done`, or anywhere a client can read it.

US3.UC1 AC#3 and US3.UC5 AC#3 (degraded turn bills only the calls that ran) are thus
**unverified**.

**Recommendation:** Add a deterministic mock failure trigger (e.g. a magic prompt token or
`MOCK_FAIL_MODELS` env) so the degraded path is reproducible; surface the degraded/surviving
count in `turn.usage` and `turn.done`; add tests for the partial-billing fee count.

### P1-3. Admin-metrics happy path (US10.UC5) is entirely unverified — only the 403/401 guards are tested
**Evidence:** `tests/us10-observability.test.ts:275-296` covers only non-admin `403` and
unauth `401`. Signup always creates `role="user"` (`lib/server/db/seed.ts`, `users.role` default
`'user'`), and **nothing in the tests or seed ever creates an admin**
(`grep role=admin` → only a comment). US10.UC5 AC#1 ("p95/errorRate/totalCostMicro computed")
and AC#3 ("`requestsByAction` has 3 entries, `callsByModel` has 4") require an admin caller and
are **never executed**. The metric math in `app/api/admin/metrics/route.ts` (percentile,
`errorRate`, `callsByModel` grouping) is completely untested.

**Recommendation:** Provide a test-only admin promotion (direct `users.role` update via the
test DB handle is already used elsewhere) and assert the metrics payload shape + a known
`requestsByAction`/`callsByModel` count and `errorRate` over seeded 4xx/5xx rows.

### P1-4. `STREAM_IN_PROGRESS` (US2.UC1, US3.UC4, US8.UC5) has zero test coverage and is unverifiable in the harness
**Evidence:** The guard exists (`app/api/chat/route.ts:64-66`,
`app/api/chat/regenerate/run.ts:45-47` via `hasStreamingTurn`), but **no test exercises it**
(`grep STREAM_IN_PROGRESS tests/` → none). It is also structurally hard to hit: `readSse()`
drains each stream to completion (flipping `turns.status` to `done` in `fusion.ts:264`) before
the next request, so a second send never sees a `streaming` turn. US2.UC1 AC#2, US3.UC4 AC#3,
and US8.UC5 alt-flow all mandate this 409 and none are proven.

**Recommendation:** Insert a `turns` row with `status='streaming'` directly via the test DB
handle (as the auth test does for expired sessions), then assert a `POST /api/chat` to that
conversation returns `409 STREAM_IN_PROGRESS`.

---

## P2 — Nice-to-have / contract drift

### P2-1. Copy beacon logs `action="activity.ping"`, not `chat.copy`/`result.copy` (US2.UC4)
US2.UC4 AC: "an `activity_logs` row `action="chat.copy"` exists". `app/api/activity/route.ts:18-31`
hardcodes the row action to `"activity.ping"` and stows the real action under `meta.action`.
Contract §2.2 lists the log action as `<action>` (the client value). The test
(`tests/us2-fast-chat.test.ts:188-217`) only checks `logged:true`, so it doesn't catch the
mismatch. *Fix:* set the activity action from the validated body, or accept the doc as the
source of truth and update §2.2.

### P2-2. CSV/JSON usage export is missing contract columns (US6.UC5)
§US6.UC5 specifies columns `ts, turnId, mode, modelId, modelName, role, …` plus a human-readable
formatted `¥` column. `app/api/usage/export/route.ts:8-23` emits neither `mode`, `modelName`,
nor a formatted `¥` column, and names the cost column `costMicro` (contract: `modelCostMicro`).
The test (`tests/us6-usage.test.ts:270-286`) was written to the implementation, so it passes.
*Fix:* add the missing columns or amend the contract.

### P2-3. Plan change does not reset the billing period (US7.UC3)
US7.UC3 main flow: "`periodStart=now`, `periodEnd=now+1mo`"; AC#1: "`renewsOn` ≈ +1 month".
`app/api/billing/subscription/route.ts:88-91` updates only `planId, includedCreditMicro,
updatedAt` for an existing sub — the original seeded period is retained, so `renewsOn` does not
advance on upgrade/downgrade. The test (`tests/us7-billing.test.ts:150-168`) never asserts
`renewsOn`/period, so it's uncaught. *Fix:* set `periodStart=now`, `periodEnd=now+1mo` on change.

### P2-4. `402 PAYMENT_FAILED` is unreachable dead code (US7.UC5)
`app/api/billing/topup/route.ts:18-21` hardcodes `const charged = true`, so the stub-PSP-failure
alt-flow can never fire and is untested. *Fix:* gate it on a deterministic trigger (magic amount
/ env flag) so the documented 402 path is reproducible.

### P2-5. `activity_logs.latencyMs` for chat/regenerate is ~0 (measures setup, not the turn)
The `http.ts` wrapper writes the activity row immediately after the handler returns the SSE
`Response` (`lib/server/http.ts:107-127`); the `ReadableStream` body (the whole turn) runs
*after* that. Confirmed in run logs: `action:"chat.send" … latencyMs:0`. So request-level
latency for the most important operations is misleading (per-call latency *is* captured
correctly in `usage_records` via `performance.now()` deltas in `fusion.ts`). US10.UC1 AC only
requires `latencyMs ≥ 0`, so it passes, but observability is degraded. *Fix:* record latency
inside the stream `finally` for streaming routes, or document the limitation.

### P2-6. Disabled-main via preferences returns `409 MODEL_DISABLED`, but US4.UC2 wording says `400 MODEL_NOT_AVAILABLE`
`PATCH /api/preferences {mainModel:<disabled>}` yields `409 MODEL_DISABLED`
(`tests/us4-orchestration.test.ts:148-157`), which matches §5/§2.7 but **contradicts US4.UC2
AC** ("a disabled model id → `400 MODEL_NOT_AVAILABLE`"). Internally inconsistent contract;
the `PATCH /api/models/:id {setMain}` path *does* return `400 MODEL_NOT_AVAILABLE`. *Fix:* align
the two surfaces (or the doc).

### P2-7. Signup returns HTTP 200; US1.UC1 says `status=201`
US1.UC1 logging/AC references `status=201`; the handler returns `200` and the test asserts `200`
(`tests/us1-auth.test.ts:36`). §2.1 doesn't mandate 201, so this is a story-vs-impl wording
drift. *Fix:* return 201 from signup, or correct the story.

### P2-8. `call.usage` SSE for experts/fusion omits `callId`; gateway slugs/registry framing drift
(a) §6 shows `call.usage` carrying `callId`; `fusion.ts:174-184,222-231` emit expert/fusion
`call.usage` **without** `callId` (fast path includes it). Harmless for the client (keyed by
`modelId`) but diverges from the documented event shape. (b) The "server-authoritative registry
that a sync test guards against drift" (§3.1) is actually a **re-export** of `lib/models.ts`
(`lib/server/llm/registry.ts:1-8`) — single source of truth (good), but the drift-test framing
is moot. (c) `GATEWAY_SLUGS` use older model versions (`deepseek-v3`, `gpt-5`,
`claude-opus-4.1`) than §3.1's examples — gateway-mode only.

---

## Genuine strengths (verified, not taken on faith)

- **Exact, integer-clean cost accounting.** `lib/server/llm/cost.ts:28-31` = `round(in×pin) +
  round((out+reason)×pout)`; reasoning billed at output price per §3.5. Verified end-to-end:
  `tests/us2-fast-chat.test.ts:250-266` proves `gpt-55` cost == `in×20 + out×80`; expert turns
  bill exactly N+1 fees (`us3:206-229`); summary/ledger/messages all reconcile to the raw
  `usage_records` with zero drift (`us6:74-87`, `us8:315-323`).
- **`usage_records` retained on conversation delete** (US8.UC4) — `app/api/conversations/[id]/
  route.ts:59-66` deletes messages+turns+conversation but not usage; proven by a before/after
  summary equality test (`us8:218-259`). Correct and well-tested.
- **Ownership scoping is consistent and proven** across conversations, invoices, ledger,
  messages, and activity (cross-user → `404`/`403`, never leaks; `us6:253-266`, `us8`, `us10:162-185`).
- **Intent router is a faithful, enablement-aware port** with the documented fallback
  (`router.ts`; `us2:108-138`, `us4:51-94`) and localized labels (`us5:105-129`).
- **Auth contract is solid:** scrypt + `timingSafeEqual`, identical `AUTH_INVALID` for
  unknown-email/bad-password, lazy expired-session GC, multi-device sessions, idempotent logout —
  all asserted (`us1` throughout).
- **Every served request writes exactly one `activity_logs` row incl. 4xx/5xx, with
  `x-request-id`** (`http.ts`; `us10:66-126`), and unauth `401` rows are correctly scoped out of
  a user's own view.

---

## Per-UC coverage matrix (endpoint exists / asserting test / handler matches contract)

Legend: ✅ ok · ⚠️ passes but weak/contract-drift · ❌ unverified or mis-implemented

| UC | Status | Note |
|----|--------|------|
| US1.UC1 signup | ⚠️ | works; 200 vs story's 201 (P2-7) |
| US1.UC2 login | ✅ | enumeration-safe, verified |
| US1.UC3 session | ✅ | lazy GC verified |
| US1.UC4 logout | ✅ | idempotent + multi-device verified |
| US1.UC5 sso | ✅ | stub upsert verified |
| US2.UC1 fast send | ⚠️ | happy path ✅; `STREAM_IN_PROGRESS` untested (P1-4) |
| US2.UC2 auto-route | ✅ | route event + routed-model billing verified |
| US2.UC3 manual model | ✅ | no route event, `MODEL_NOT_AVAILABLE` verified |
| US2.UC4 copy | ⚠️ | no-usage verified; log action drift (P2-1) |
| US2.UC5 per-turn cost | ✅ | exact cost verified |
| US3.UC1 expert trio | ⚠️ | 3+fusion ✅; degraded alt-flow dead/untested (P1-2) |
| US3.UC2 reasoning trace | ✅ | ordering + reasoningTokens verified; COMPILER_UNAVAILABLE ✅ |
| US3.UC3 fusion answer | ✅ | distinct consolidated answer verified |
| US3.UC4 regenerate | ❌ | re-runs *current* trio, not original (P1-1) |
| US3.UC5 per-call ledger | ⚠️ | 4-row ledger ✅; degraded fee count untested (P1-2) |
| US4.UC1 route preview | ✅ | code/planning/fallback verified, no usage |
| US4.UC2 set main | ⚠️ | works; 409 MODEL_DISABLED vs story's 400 (P2-6) |
| US4.UC3 set trio | ✅ | dup/disabled/length verified |
| US4.UC4 mode switch | ✅ | fast/expert/invalid verified |
| US4.UC5 auto toggle | ✅ | route event presence + orchestration alias verified |
| US5.UC1 list models | ✅ | 12 + one main + registry parity verified |
| US5.UC2 enable/disable | ✅ | CANNOT_DISABLE_MAIN / MODEL_IN_TRIO / 404 verified |
| US5.UC3 set main | ✅ | exactly-one-main + disabled→400 verified |
| US5.UC4 tiers/pricing | ✅ | gpt-55 flagship 20/80/400K + ja/zh-TW tags verified |
| US5.UC5 openrouter | ⚠️ | mock catalog ✅; OpenRouter-as-chat-model + 503 gateway untested |
| US6.UC1 summary | ✅ | totals == raw ledger, zero drift verified |
| US6.UC2 trend | ✅ | N zero-filled buckets verified |
| US6.UC3 by-model | ✅ | sort/share/limit verified |
| US6.UC4 ledger | ✅ | newest-first, dedup, cursor, ownership verified |
| US6.UC5 export | ⚠️ | csv/json ✅; missing mode/modelName/¥ columns (P2-2) |
| US7.UC1 subscription | ✅ | remaining/usedPct invariants verified |
| US7.UC2 plans | ✅ | 4 plans, ent null, localized features verified |
| US7.UC3 change plan | ⚠️ | plan/credit ✅; period not reset (P2-3) |
| US7.UC4 invoices | ✅ | seeded 3×¥199, owner-scoped detail verified |
| US7.UC5 topup/pm | ⚠️ | topup+pm ✅; 402 dead code (P2-4) |
| US8.UC1 create conv | ✅ | placeholder title, uuid, color verified |
| US8.UC2 list convs | ✅ | turnCount/lastPrompt/cursor/ownership verified |
| US8.UC3 rename | ✅ | owner-scoped, trim, 400 empty verified |
| US8.UC4 delete | ✅ | retains usage_records (billing unchanged) verified |
| US8.UC5 history/regen | ⚠️ | rehydrate ✅; regen fidelity (P1-1), STREAM_IN_PROGRESS (P1-4) |
| US9.UC1 get prefs | ✅ | defaults + full DTO verified |
| US9.UC2 theme | ✅ | persist + invalid verified |
| US9.UC3 lang | ✅ | 4 locales + ja chat verified |
| US9.UC4 deep toggles | ✅ | per-turn inheritance verified |
| US9.UC5 defaults/fee | ✅ | display-only fee never bills — verified rigorously |
| US10.UC1 auto-log | ✅ | one row/request incl. 4xx, x-request-id verified |
| US10.UC2 usage log | ✅ | per-call rows verified; req-level latency weak (P2-5) |
| US10.UC3 activity query | ✅ | self-scope, 403 cross-user, cursor verified |
| US10.UC4 export | ✅ | csv/json, owner-scoped verified |
| US10.UC5 admin metrics | ❌ | only 403/401 tested; metric math unverified (P1-3) |
