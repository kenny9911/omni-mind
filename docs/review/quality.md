# Review — Code Quality, Consistency & Doc Accuracy

Dimension: foundation + handlers reviewed for envelope/error-code/money/id/time consistency,
duplication, dead code, type-safety, and DOC↔CODE drift. Verified by reading the actual code,
not comments.

**Summary: 0 P0 · 7 P1 · 11 P2 — 18 findings.** The implementation is genuinely clean and
internally consistent (single envelope, one ApiError path, integer micro-CNY everywhere, near-zero
`any`-casts). The defects are almost entirely **documentation drift**: the frozen contract docs
describe values/behaviors the code does not implement. The code is usually the better of the two,
so most fixes are doc edits — but two items (reasoning-token billing formula, configurable
platform-fee) are real cross-file inconsistencies inside the code.

---

## P1 — Important

### P1-1 · DOC↔CODE: cost formula omits reasoning tokens, but code bills them
`technical-design.md` §0 (line 25) and §3.5 (line 707) define the canonical formula as
`costMicro = round(inputTokens × pin) + round(outputTokens × pout)` — reasoning tokens are **not**
a term. The actual cost engine bills reasoning at the output price:
`lib/server/llm/cost.ts:28-30` → `Math.round(inputTokens * price.in) + Math.round((outputTokens + reasoningTokens) * price.out)`.
The only place this is documented is the cost.ts code comment (line 6), which contradicts the frozen
formula. Because the fusion call is the sole carrier of reasoning tokens (`fusion.ts:213-221`), every
expert turn's fusion cost is higher than the documented formula yields. This directly undermines the
"cost exactness / zero drift" claim (SM2, NFR-6, doc §7 line 872).
**Recommendation:** decide the intended behavior and make doc + code agree. If reasoning *is*
billable, update §0 line 25 and §3.5 line 707 to
`round(inputTokens × pin) + round((outputTokens + reasoningTokens) × pout)`. If not, drop
`reasoningTokens` from the cost.ts sum.

### P1-2 · `platformFeePerCallMicro` is hardcoded 50000 in 3 read paths — diverges from the configurable billed fee
The billed fee is env-configurable: `lib/server/llm/cost.ts:15-18` derives `PLATFORM_FEE_MICRO()`
from `PLATFORM_FEE_CNY` and `fusion.ts:49` bills with it. But the value **reported to clients** is a
hardcoded literal in three places:
- `app/api/usage/summary/route.ts:7` `const PLATFORM_FEE_PER_CALL_MICRO = 50000;`
- `app/api/usage/route.ts:7` (same literal)
- `lib/server/contracts/preferences.ts:45` `export const PLATFORM_FEE_PER_CALL_MICRO = 50_000;` (used by GET/PATCH /preferences)

If `PLATFORM_FEE_CNY` is ever set to anything other than 0.05, the UI's "fee per call" (prefs +
usage summary) silently disagrees with what `usage_records.platform_fee_micro` actually billed.
**Recommendation:** have all three read `PLATFORM_FEE_MICRO()` from `cost.ts` (the auth contract
already does this correctly at `contracts/auth.ts:82`). Delete the duplicate literals.

### P1-3 · DOC↔CODE: user-stories.md prose uses wrong error codes and plan everywhere
`user-stories.md` (the frozen behavioral contract, US1–US5) specifies codes and a plan the handlers
do **not** emit. Confirmed handler values: `plan:"pro"` (`auth/signup/route.ts:42,65`,
`auth/login/route.ts:30`), `AUTH_EMAIL_TAKEN` (`signup:27`), `AUTH_INVALID` (`login:19`),
`AUTH_REQUIRED` (`http.ts:91`). The doc prose says otherwise:
- `user-stories.md:77,84` → `plan: "free"` (should be `"pro"`)
- `user-stories.md:80,85` → `409 EMAIL_TAKEN` (should be `AUTH_EMAIL_TAKEN`)
- `user-stories.md:101,106` → `401 INVALID_CREDENTIALS` (should be `AUTH_INVALID`)
- `user-stories.md:25,120,125,514` and `user-stories-part2.md:25,134,346` → `401 UNAUTHENTICATED`
  (handlers emit `AUTH_REQUIRED`; technical-design.md §5 line 784 lists `UNAUTHENTICATED` only as an
  "a.k.a." alias, and no code emits that literal).

`PRD.md:221,224,227,231` already uses the correct codes, so the contract is self-contradictory.
**Recommendation:** global-replace in `user-stories.md` / `user-stories-part2.md`:
`"free"→"pro"`, `EMAIL_TAKEN→AUTH_EMAIL_TAKEN`, `INVALID_CREDENTIALS→AUTH_INVALID`,
`UNAUTHENTICATED→AUTH_REQUIRED`. (This is the exact drift the test team flagged; verified end-to-end.)

### P1-4 · DOC↔CODE: documented env vars `SESSION_TTL_MS` and `SEED_PLAN` are never read
`technical-design.md` §0 (lines 43, 46) document `SESSION_TTL_MS` (default 30d, "7d when
remember=false") and `SEED_PLAN` (default `pro`) as configuration knobs. Neither is read anywhere:
- `lib/server/auth/session.ts:7-8` hardcodes `DEFAULT_TTL_MS = 7d` and `REMEMBER_TTL_MS = 30d`.
  A grep for `SESSION_TTL_MS` across `lib/` and `app/` returns nothing.
- `lib/server/db/seed.ts:35` hardcodes `planId = opts.planId ?? "pro"`; `SEED_PLAN` is never consulted.

Operators who set these env vars get no effect — silent misconfiguration.
**Recommendation:** either read the env vars (`session.ts` should honor `SESSION_TTL_MS` for the
remember branch; `seed.ts` should default from `SEED_PLAN`) or delete both rows from the §0 env table.

### P1-5 · DOC↔CODE: claimed registry-sync drift-guard test does not exist
`technical-design.md` §3.1 (line 608) and §7 (line 879) assert: "A `vitest` sync test asserts
`registry === lib/models.ts` (ids, prices, tiers) to prevent drift (R1)." No such test exists —
grep of `tests/` for any registry-vs-models assertion finds only a comment reference in
`tests/us5-models.test.ts:15`. The registry is in fact a thin re-export (`registry.ts:8`
`export { MODELS, MODEL_MAP, PRICE_MAP, OPENROUTER_MODELS }`), so today there is nothing to drift —
but the documented safety net (R1) is absent, and a future divergence (e.g. someone forking the
list) would go uncaught.
**Recommendation:** either add the trivial sync test the doc promises, or update §3.1/§7 to state the
registry is a direct re-export and no sync test is needed.

### P1-6 · DOC↔CODE: `POST /api/activity` logs a different action than documented
`technical-design.md` §2.2 (line 457) and the §2.9 matrix specify the `activity_logs.action` for
the copy-ping as `<action>` — i.e. the row should be keyed by the client-supplied action
(`chat.copy` / `result.copy`). The handler instead hardcodes the action to `"activity.ping"` and
buries the real action in `meta` (`app/api/activity/route.ts:19,24`). Activity queries filtering by
`action=chat.copy` (US10.UC3, a documented filter) will therefore never match copy events.
**Recommendation:** either pass the body action through as the activity action (matches the doc and
makes US10 filtering work), or update §2.2/§2.9 to say the action is the constant `activity.ping`
with the real action in `meta.action`.

### P1-7 · DOC↔CODE: gateway mode never sets `meta.usageEstimated` on token fallback
`technical-design.md` §3.5 (lines 719-720) states: "if the provider returns no `usage`, fall back to
`estTok` and set `meta.usageEstimated=true` (US10.UC2 alt-flow)." The gateway path does fall back to
`tok(text)` when SDK usage is missing (`lib/server/llm/gateway.ts:62-68`) but **drops the flag** —
it returns only `{ text, outputTokens, status }` (line 69) with no `usageEstimated` signal, and
`fusion.ts:84` only ever writes `meta.pricingFallback`. So an estimated gateway call is
indistinguishable from a measured one in `usage_records.meta_json`, defeating the US10.UC2 audit
trail.
**Recommendation:** thread an `usageEstimated` boolean from `streamViaGateway` through `streamOne`
into `persistUsage`/`writeUsage` meta, or remove the claim from §3.5.

---

## P2 — Nice-to-have

### P2-1 · DOC↔CODE: `MOCK_STREAM_CPS` default mismatch + undocumented `MOCK_STREAM_DELAY_MS`
§0 (line 44) and §3.4 (line 689) say `MOCK_STREAM_CPS` defaults to `360` ("mirrors store RATE").
Code defaults to `900`: `lib/server/llm/mock.ts:33` `Number(process.env.MOCK_STREAM_CPS ?? "900")`.
Separately, the pacing knob the tests actually use, `MOCK_STREAM_DELAY_MS` (`mock.ts:34`,
`tests/setup.ts:3`), is undocumented in §0. **Recommendation:** correct the §0 default to 900 and add
a `MOCK_STREAM_DELAY_MS` row.

### P2-2 · DOC↔CODE: mock provider is not a `MockLanguageModelV2`
§3.4 (lines 681-682) describes the mock as "a Vercel AI SDK `MockLanguageModelV2` over
`simulateReadableStream`." The real implementation (`lib/server/llm/mock.ts:40-47`) is a plain async
generator pacing chunks with `setTimeout` — it never imports the AI SDK in mock mode. The behavior is
fine and keyless as promised, but the described mechanism is fictional. **Recommendation:** rewrite
§3.4 to describe the actual generator, or drop the SDK-class reference.

### P2-3 · DOC↔CODE: gateway model slugs differ from the documented map
§3.1 (lines 612-615) documents `GATEWAY_ID` with next-gen slugs: `deepseek/deepseek-v4`,
`anthropic/claude-opus-4.8`, `openai/gpt-5.5`, `google/gemini-3.1-pro`. The code map `GATEWAY_SLUGS`
(`lib/server/llm/registry.ts:25-38`) ships shipped-today slugs: `deepseek-v3`, `claude-opus-4.1`,
`gpt-5`, `gemini-2.5-pro`. Also the symbol is named `GATEWAY_SLUGS`/`gatewaySlug()`, not
`GATEWAY_ID`/`priceOf` as the doc snippet implies. **Recommendation:** align the doc snippet to the
real slugs and symbol names (or vice-versa if the v4/4.8 ids are the intended targets).

### P2-4 · DOC↔CODE: DDL indexes drop the documented `DESC` ordering
§1.2 declares several descending indexes (e.g. `ix_conv_user_updated (user_id, updated_at DESC)`
line 265; `ix_turns_user ... DESC` 281; `ix_usage_user_time ... DESC` 317; `ix_act_user_time ... DESC`
335; `ix_inv_user_date ... DESC` 364). The applied DDL creates them all **ascending**
(`lib/server/db/ddl.ts:59,74,108,125,152`) and `schema.ts` likewise omits `.desc()`
(`schema.ts:72,89,129,151,182`). SQLite can still scan an ASC index backwards, so this is a perf
nuance, not a correctness bug — but it is a literal doc↔DDL mismatch. **Recommendation:** add `.desc()`
to match the doc, or drop `DESC` from the §1.2 snippets.

### P2-5 · DOC↔CODE: two schema sources of truth (`ddl.ts` raw SQL vs `schema.ts` Drizzle)
§1.2 (line 199) says the DDL is "authored via Drizzle `sqliteTable`" and §0/§1.2 reference
`lib/server/db/migrate.ts` as the self-applier. In reality the schema is applied from a **hand-written
SQL string** `lib/server/db/ddl.ts` via `ensureSchema()` (`db/client.ts:41-43`), duplicating the
Drizzle definitions in `schema.ts`. The two are currently in sync but must be hand-maintained
together — a classic drift trap. `migrate.ts` exists but is a thin wrapper, not the self-apply path
the doc implies (that is `getDb()` → `init()` → `ensureSchema`). **Recommendation:** generate the DDL
from the Drizzle schema (drizzle-kit) or, at minimum, add a test asserting the two agree; update §1.2
wording to describe the actual ddl.ts-string mechanism.

### P2-6 · DOC↔CODE: `users.password_hash` / `salt` DDL defaults
§1.2 DDL (lines 211-212) declares `password_hash TEXT NOT NULL` / `salt TEXT NOT NULL` with no
default. Code adds `DEFAULT ''` (`ddl.ts:10-11`, `schema.ts:15-16`) — which is actually *required* for
SSO-only users (`auth/sso/route.ts:38-39` inserts `passwordHash:""`). Here the code is correct and
the doc DDL is stale. **Recommendation:** add `DEFAULT ''` to the §1.2 DDL snippet for these two
columns.

### P2-7 · DOC↔CODE: signup side-effects list omits the seeded payment method
§2.1 (lines 443-446) enumerates signup side effects as users + preferences + 12 model_state +
subscriptions + 3 invoices. The seed also inserts a demo payment method
(`lib/server/db/seed.ts:86-93`, visa •4242). Minor omission. **Recommendation:** add "+ a demo
payment method" to the §2.1 list.

### P2-8 · DOC↔CODE: demo usage history is opt-in (`SEED_DEMO=1`) but doc implies seed pre-populates
§2.1 and §7 (line 878, "the seed make the full unit/integration suite pass") read as though the seed
populates usage/recents. In fact `seedNewUser` only seeds demo conversations/usage when
`SEED_DEMO=1` (`seed.ts:95-100`); a fresh account starts with an empty ledger. This is a reasonable
product choice but undocumented. **Recommendation:** document the `SEED_DEMO` flag in §0 and note the
default-empty-ledger behavior in §2.1.

### P2-9 · Dead column: `turns.route_text` is always written `null`
The schema/DDL define `turns.route_text` ("localized routeText (fast+auto only)", §1.2 line 274), but
every writer persists `null`: `app/api/chat/route.ts:100`, `chat/regenerate/run.ts` (reuses the row),
`seed.ts:146`. The real `routeText` lives in the assistant message payload
(`fusion.ts:128`) and the SSE `route` event. The reader even has a fallback to the column
(`conversations/[id]/messages/route.ts:67-68`) that can never fire. Harmless but dead.
**Recommendation:** either populate `turns.route_text` when `runTurn` computes the route (so the
column and the doc are meaningful), or drop the column + its dead fallback read.

### P2-10 · Duplication: `ActivityPingBody` declared twice; `fmtMoney` re-implemented
`ActivityPingBody` is defined identically in `lib/server/contracts/chat.ts:38-42` and
`lib/server/contracts/activity.ts:12-16` (the latter's comment even acknowledges the redeclaration).
The activity handler imports the activity.ts copy; the chat.ts copy is unused. Separately,
`formatMicro` (`lib/server/llm/cost.ts:61-66`) is a byte-for-byte re-implementation of `fmtMoney`
(`lib/accounting.ts:19-22`) rather than importing it. **Recommendation:** delete the unused
`ActivityPingBody` from chat.ts; have `formatMicro` call `fmtMoney(microToCny(micro))`.

### P2-11 · Minor type-safety: unchecked `as PlanId` / `as Lang` widening from DB text
DB `text` columns are narrowed via bare casts without runtime validation, e.g.
`user.planId as PlanId` (`billing/subscription/route.ts:16,43`, `billing/topup/route.ts:36`,
`billing/plans/route.ts:21`) and `pref.lang as Lang` (`chat-helpers.ts:51,54,82`,
`models/route.ts:45`, `models/[id]/route.ts:30`). A corrupt/legacy row with an out-of-enum value would
flow through unchecked (e.g. `includedCreditFor` returns 0 for an unknown plan, `pick()` falls back
for an unknown lang — so impact is contained, but it is unvalidated trust of stored text).
**Recommendation:** centralize a `coercePlan`/`coerceLang` helper that validates against the enum and
falls back to a safe default, replacing the scattered `as` casts.

---

## Genuine strengths (verified, not assumed)

- **One envelope, one error path.** `json()` and `errorResponse()` (`http.ts:40-55`) are the only
  response builders; `ApiError`→envelope mapping and `x-request-id` injection are centralized in
  `route()` (`http.ts:76-128`). Every handler returns plain data or throws `ApiError` — consistent
  across all 30 routes.
- **Money is integer micro-CNY end to end.** No floats persisted; `cost.ts` uses `Math.round` on
  integer products; `aggregate.ts` sums integers so totals exactly equal the per-call rows
  (the SM2 invariant holds in code, modulo P1-1's formula question).
- **Near-zero `any`.** A full grep for `as any` / `: any` / `@ts-ignore` over `lib/server` + `app/api`
  finds only a comment false-positive (`router.ts:24`). `parseBody`/`parseQuery` validate every input
  with zod and flatten errors into `details` exactly as §0/§5 require.
- **Ownership leak-proofing is consistent.** `assertOwner` collapses missing-or-not-owned to
  `404 NOT_FOUND` (`guard.ts:17-23`) and is used uniformly (conversations, messages); chat checks
  conversation ownership inline (`chat/route.ts:58`). Non-admin activity queries are force-scoped with
  an injected WHERE, not a client filter (`activity/route.ts:43-52`) — matches §2.8.
- **Login is enumeration-safe** (`login/route.ts:18` single combined check; `password.ts` uses
  `timingSafeEqual`), and the SSE producer cancels in-flight work + closes safely on disconnect
  (`sse.ts:46-49`), honoring NFR-17.
- **Usage/billing derivation is single-sourced**: per-turn rollups and ledger are computed from
  `usage_records` at read time (`conversations/[id]/messages/route.ts:44-55`, `aggregate.ts`), never
  stored redundantly — exactly as §1.4 promises.

---

**One-line summary:** 0 P0, 7 P1, 11 P2 — code is clean and internally consistent (single envelope,
integer micro-CNY, ~zero `any`); nearly all defects are frozen-doc drift (auth codes/plan, cost
formula vs reasoning-token billing, hardcoded vs configurable platform fee, phantom env vars &
registry-sync test, mock/gateway/DDL doc mismatches).
