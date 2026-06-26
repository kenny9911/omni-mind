# Review — Product & Frontend Integration

**Dimension:** Does the backend truly *support all functionalities* of the UI, and what is required to make the product end-to-end real? Verdict on the integration gap + a concrete wiring plan.

**Headline verdict:** The backend is a faithful, well-shaped mirror of the UI's data needs — nearly every ViewModel field has a corresponding DTO field, and the SSE contract was clearly designed against the store's streaming state machine. **But the React app is 0% wired to it.** Not a single component, the store, the context provider, or the auth page imports `lib/client/api.ts`. The product as it stands is two correct halves that have never been connected: a client-simulated prototype and a tested-but-unconsumed backend. The integration is the single largest remaining piece of work and is currently **un-started**, despite a typed client existing.

---

## P0 — Blockers

### P0-1. The entire React app is disconnected from the backend
`lib/client/api.ts` is imported by **nothing** outside its own file and the tests. Grepping the whole `app/`, `components/`, and `lib/` trees (excluding `lib/client/api.ts` itself) for `client/api`, `streamChat`, `api.auth`, etc. returns zero hits.

Evidence:
- `lib/OmniContext.tsx:27-31` — the provider's only side-effect is `store.seedInitial()`, which generates **fake** client-side ledger data (`lib/store.ts:86-89` → `seedLedger()` in `lib/accounting.ts:63`). No `auth.session()`, no `preferences.get()`, no `models.list()`, no `conversations.list()` is ever called.
- `lib/store.ts:132-190` (`send`) and `:192-258` (`tick`) — chat output is **fabricated locally** via `buildAnswer/buildReason/buildFusion` and animated by a `setInterval` typewriter at 360 chars/sec. The real `streamChat` SSE generator (`lib/client/api.ts:78`) is never invoked.
- `lib/viewModel.ts:449-453` — sidebar `recents` are **hardcoded i18n strings**, not from `conversations.list()`.
- `lib/viewModel.ts:594-598` — `invoices` are **hardcoded** ("Jun 1, 2026 … ¥199.00"), not from `billing.invoices()`.
- `lib/viewModel.ts:570-575` — plan definitions/prices are **hardcoded** client-side, duplicating `billing.plans()`.

**Impact:** The product does not function. Every number shown (usage, cost, billing, trend) is randomly seeded; every answer is a canned template; nothing persists across reload. This is a prototype, not a working product.

**Recommendation:** Build an integration layer (see Wiring Plan §A–G). This is multi-day work, not a polish pass.

### P0-2. The auth page is a pure simulation — login/signup/SSO never hit the API
`components/AuthScreen.tsx` is the gateway to the product and is entirely fake:
- `AuthScreen.tsx:140-150` (`onSubmit`) — validates email/password client-side then `setTimeout(1300ms)` → `setDone(true)`. It **never calls `api.auth.login` or `api.auth.signup`**.
- `AuthScreen.tsx:159-166` (`onSso`) — `setTimeout(1100ms)` → success. Never calls `api.auth.sso`.
- On "success" it shows a checkmark and a "Back" button (`reset()`, line 152) — it does **not navigate** to `/`. There is no router push, no cookie, no session.
- The real backend is ready and waiting: `app/api/auth/login/route.ts:21-30` issues a `set-cookie` session, `signup` and `sso` likewise. None of it is reachable from the UI.

**Impact:** There is no way to actually authenticate. A user can "log in" with `a@b.com` / any 8 chars and never get a session; conversely the protected API routes all `requireUser` and would 401 the moment the app tried to call them. The auth screen and the protected app are not connected by anything.

**Recommendation:** Wire `onSubmit`→`api.auth.login`/`signup`, `onSso`→`api.auth.sso`, surface server errors (e.g. `AUTH_INVALID`), and on success `router.push("/")`. Add an auth guard on `/` (see §A).

### P0-3. No auth guard / session bootstrap on the main app
`app/page.tsx:3-5` renders `<OmniApp />` unconditionally. There is no check that a session exists, no redirect to `/login`, and no loading state while a session is fetched. Because the store never calls `auth.session()`, the app would render its simulated state to an unauthenticated visitor, and the first real API call would 401.

**Recommendation:** Add a session bootstrap (server component reading the cookie, or a client `auth.session()` on mount that redirects to `/login` on 401). Gate `OmniApp` behind it. Hydrate `user`, `plan`, and `preferences` from the `session()` response (the backend already returns all three in one call — `app/api/auth/session/route.ts`).

---

## P1 — Important

### P1-1. Store streaming state machine must be replaced by an SSE consumer (largest single task)
The store's `send`/`tick`/`finish` (`lib/store.ts:132-276`) is a self-contained simulation. To go real, the SSE events (`docs/technical-design.md` §6) must drive the **same** `StreamCall`/`FusionState` fields the ViewModel already reads. The good news: the contract was designed for exactly this. The mapping is clean:

| SSE event | Store mutation (target field) |
|---|---|
| `turn.start` | create assistant message, set `streaming:true`, capture `turnId`/`conversationId` |
| `route` | `assistant.routeText` (`viewModel.ts:121`, `:343` reads it) |
| `call.start` (role expert/single) | init `StreamCall` |
| `call.delta` | append to `StreamCall.full`, set `shown = full.length` (no client typewriter) |
| `call.usage` | set `inTok`/`outTok` from authoritative `inputTokens`/`outputTokens`; mark `done` |
| `call.error` | mark that expert failed/degraded (US3.UC1) — **no store field exists for this today** |
| `reason.start/delta/done` | `FusionState.started/reason/reasonShown/reasonDone` (`viewModel.ts:374-405`) |
| `answer.delta` | `FusionState.full`+`shown` (expert) or `single.full`+`shown` (fast) |
| `turn.usage` | per-turn footer; today the VM **recomputes** this client-side (`viewModel.ts:408-425`) |
| `turn.done` | `streaming:false`, push real ledger record |
| `error` | fatal — surface to UI |

Two structural mismatches to resolve:
1. The store keeps a `shown` cursor for a **client-side typewriter** (`tick`, `lib/store.ts:205-249`). With real streaming, `shown` should just track received length (`shown = full.length`), and the `setInterval` machinery (`startStream`, `iv`) should be deleted. The ViewModel reads `r.full.slice(0, r.shown)` everywhere (`viewModel.ts:321-322,376-377`) so setting `shown=full.length` keeps it working unchanged — a clean seam.
2. `StreamCall.inTok` and the per-turn footer are currently **derived client-side** from `estTok` + `respCost` (`viewModel.ts:323-336,408-425`). The server now sends authoritative `inputTokens`/`outputTokens`/`costMicro`/`turnTotalMicro`. The client and server cost math agree (client `respCost`, `lib/accounting.ts:10-13`, vs server `modelCostMicro`, `lib/server/llm/cost.ts:20-31`, both use the shared `PRICE_MAP`), so either source is numerically safe — but the **authoritative** server values should win to avoid drift, especially for the platform fee and rounding.

**Recommendation:** Rewrite `send`/`regenerate` to `for await (const ev of streamChat(...))` and dispatch into a reducer that mutates the existing `StreamCall`/`FusionState` shapes. Delete the `setInterval` typewriter. Prefer server usage fields over client recomputation for the footer.

### P1-2. ViewModel↔DTO field/unit mismatch on usage aggregation (silent breakage risk)
The ViewModel consumes `store.aggregate()` which returns the **client** `Aggregate` shape (`lib/accounting.ts:92-101`): float-CNY fields `tin/tout/mc/fee/total/count` and `perArr:{id,calls,cost}`, `days:{key,label,val}`. The server returns a **different** shape with **micro-CNY integers** and different names:
- `usage/summary` → `{ totals: { inputTokens, outputTokens, modelCostMicro, platformFeeMicro, totalMicro, callCount, requestCount } }` (`lib/server/usage/aggregate.ts:13-23`)
- `usage/trend` → `{ days: [{ key, label, totalMicro }] }` (`:53-57`) — note `totalMicro`, not `val`
- `usage/by-model` → `{ models: [{ modelId, name, color, calls, modelCostMicro, sharePct }] }` (`:79-86`) — note `modelId`/`modelCostMicro`, not `id`/`cost`
- `usage/ledger` → `{ rows: [{ turnId, ts, prompt, mode, models:[{modelId,name,color}], inputTokens, outputTokens, modelCostMicro, platformFeeMicro, totalMicro }] }` (`:119-130`)

The VM reads `agg.tin`, `agg.mc`, `agg.perArr[].cost`, `agg.days[].val`, `r.calls[].inTok`, etc. (`viewModel.ts:478-526`). **None of those field names exist in the server DTOs**, and the server uses integer micro (×1e6) where the client uses float yuan. A naive "just call the API" wiring will produce `NaN`/`¥0.0000` everywhere.

**Recommendation:** Add an adapter layer (`lib/client/adapters.ts`) that maps each server DTO → the client `Aggregate`/`LedgerRecord`/etc. shapes the ViewModel already expects, dividing micro by 1e6. This is far cheaper than rewriting the ViewModel. Alternatively, change the ViewModel to consume DTOs directly — but that touches every analytics selector. Recommend the adapter.

### P1-3. AuthScreen supports only 2 languages; the app supports 4
`AuthScreen.tsx:14` types `Lang = "zh" | "en"` and `i18n` (`:20-113`) only has `zh`/`en` dictionaries, with a `zh ⇄ en` toggle (`:478`). The rest of the product is 4-lang (`lib/types.ts:3`: `zh | zh-TW | en | ja`) and the backend persists/returns all four (`PreferencesDTO.lang`). A user whose preference is `ja` or `zh-TW` lands on a login page that can't render their language, and the signup `lang` field the client offers (`api.auth.signup({lang})`) can never be `ja`/`zh-TW` from this screen.

**Recommendation:** Extend `AuthScreen` to the full 4-language set to match the platform and feed `signup({ lang })` correctly.

### P1-4. No account/session UI in the shell (logout, identity, plan)
The session/user is never displayed or actionable. `components/Sidebar.tsx` renders nav, recents, theme, and language — but grep finds **no** `logout`, `user.name`, `avatar`, or account affordance anywhere in `components/`. The backend has `auth.logout` (`app/api/auth/logout/route.ts`) and returns `user`/`plan` on session/login, but there is nowhere in the UI to show who is logged in or to sign out.

**Recommendation:** Add a user/account block (name/email/plan + sign-out → `api.auth.logout()` → redirect `/login`) to the Sidebar footer. Surface `plan` (drives Billing's "current plan" badge, which is currently hardcoded `current:true` on Pro at `viewModel.ts:572`).

### P1-5. Preferences are local-only; no persistence or hydration
Every settings mutation goes through `store.set(...)` into in-memory state and is lost on reload:
- theme/lang (`viewModel.ts:654,660`), mode (`:672-673`), `auto` (`:681`), main model (`:555,621`), `enabled` toggles (`:556`), trio, deepResearch/deepAgents (`:712-713`).
The backend has `PATCH /api/preferences` (`app/api/preferences/route.ts`) and per-model `PATCH /api/models/:id` (`setMain`/`enabled`) ready, plus a `PreferencesDTO` that the session call returns for hydration. None is called.

Note a shape gap: the store holds a flat `OmniState` (`lib/types.ts:92-114`) while the DTO is `PreferencesDTO` (`lib/client/api.ts:47-50`) with `platformFeePerCallMicro`/`platformFeeDisplayMicro`. Hydration needs a small mapping (DTO → the subset of `OmniState` fields), and writes need debouncing so a theme toggle doesn't spam `PATCH`.

**Recommendation:** Hydrate prefs from `session()` on boot; on each settings change, `preferences.patch(...)` (debounced); route model main/enable through `models.setMain`/`setEnabled`. Reconcile the flat-state ↔ DTO shapes in the adapter.

### P1-6. Models view is static; backend per-user model state unused
`viewModel.ts:533-561` builds model cards from the static `MODELS` catalog and `s.enabled` (a client map defaulting **all true**, `lib/store.ts:51-53`). The backend tracks per-user `modelState` and returns an `enabledMap` + `mainModel` from `GET /api/models` (`app/api/models/route.ts:60-79`). So enabling/disabling a model or setting the main model has no server effect and won't survive reload, and the "main model" highlight can disagree with what `/api/chat` will actually accept (chat validates against the server enabled set, `app/api/chat/route.ts:71-89`).

**Recommendation:** Load `models.list(lang)` to seed `enabled`/`mainModel`; route toggles through the model PATCH endpoints.

---

## P2 — Nice-to-have

### P2-1. `copyResult` / activity ping not sent to backend
`store.copyResult` (`lib/store.ts:278-289`) writes to the clipboard locally but never calls `chat.activityPing({action:"result.copy"})`, which the client exposes (`lib/client/api.ts:144`) and the backend logs. Minor analytics loss.

### P2-2. `deepAgents` is UI-only with no backend semantics surfaced
The composer toggles `deepAgents` (`viewModel.ts:713`) and it's plumbed into `ChatBody`/turn persistence, but there's no visible product behavior difference and no UI affordance explaining it. Confirm intended scope or hide it until real.

### P2-3. Regenerate uses a numeric client id, backend uses turn UUIDs
`store.regenerate(am.id)` keys off the numeric message id (`viewModel.ts:351`, `lib/store.ts:291`). The real flow needs the server `turnId` (string UUID) for `streamRegenerate({conversationId, turnId})` (`lib/client/api.ts:94`). When wiring, assistant messages must carry the server `turnId`, not just the `Date.now()`-based numeric id (`lib/store.ts:136`).

### P2-4. No error/empty/loading states for API-backed views
Usage/Billing/Models currently can't fail (data is local). Once real, each needs loading + error UI (the client already throws typed `ApiClientError`, `lib/client/api.ts:16`). None exists today.

---

## Genuine strengths

- **The backend was clearly designed against the ViewModel.** The SSE event set (`docs/technical-design.md` §6) maps almost 1:1 onto the store's `StreamCall`/`FusionState` fields, including the fusion `reason` trace and per-turn rollup — the "Client mapping" note in §6 is accurate. This is the hard part and it's right.
- **A complete, typed client already exists** (`lib/client/api.ts`) covering every endpoint with a clean SSE async-generator (`parseSse`, `:105-139`) and a typed error. The remaining work is consumption, not design.
- **Single source of truth for the model catalog.** The server registry re-exports the shared `lib/models.ts` (`lib/server/llm/registry.ts:1-8`), so model ids/colors/prices cannot drift between client and server.
- **Cost math agrees across the boundary.** Client `respCost` (float ¥) and server `modelCostMicro` (integer micro) both use the shared `PRICE_MAP` and the same ¥0.05 fee, so swapping in server-authoritative numbers won't visibly shift the UI.
- **Rehydration is feasible:** persisted assistant payloads include `reasonText`/`answerText` and per-call usage (`lib/server/llm/fusion.ts:233-245`), and `GET /conversations/:id/messages` already shapes per-turn rollups (`app/api/conversations/[id]/messages/route.ts:81-93`) close to `AssistantMsgVM`.

---

## Concrete wiring plan (ordered)

**A. Auth gate + session bootstrap (unblocks everything).**
Wire `AuthScreen.onSubmit/onSso` to `api.auth.login/signup/sso`; show server errors; on success `router.push("/")`. Add a boot guard: call `auth.session()`; on 401 redirect to `/login`; on success hydrate `user`/`plan`/`preferences` into the store. Add a sign-out + identity block in the Sidebar.

**B. Adapter layer (`lib/client/adapters.ts`).**
Map server DTOs → the client `Aggregate`/`LedgerRecord`/model-card/plan/invoice shapes the ViewModel already consumes (micro→¥ via `/1e6`, rename `modelId/modelCostMicro/totalMicro/val`). This avoids rewriting `viewModel.ts`.

**C. Real chat streaming.**
Replace `store.send/tick/finish` with a `streamChat` consumer that dispatches SSE events into the existing `StreamCall`/`FusionState` fields; delete the `setInterval` typewriter (set `shown = full.length`); add a `failed` flag for `call.error` (US3.UC1); take the per-turn footer from `turn.usage`; capture `turnId`/`conversationId`. Re-point `regenerate` to `streamRegenerate` keyed by server `turnId`.

**D. Preferences + models persistence.**
Hydrate from `session()`; debounce `preferences.patch` on settings changes; route main/enable through `models.setMain`/`setEnabled`; seed `enabled`/`mainModel` from `models.list`.

**E. Data-backed analytics & billing.**
Load `usage.summary/trend/by-model/ledger` and `billing.subscription/plans/invoices` (via adapter); drop the hardcoded `invoices`/`plans`/`recents`; wire export links (`usage.exportUrl`).

**F. Conversations.**
Load `conversations.list()` into the sidebar recents; on click, `conversations.messages(id)` → rehydrate the chat (map persisted `single/experts/fusion` + `perTurn` into `MessageVM`); new-chat creates/uses a `conversationId`.

**G. Polish.**
Loading/error/empty states per API view; 4-lang AuthScreen; `activityPing` on copy.

---

**One-line summary:** 3 P0, 6 P1, 4 P2 — the backend cleanly supports the UI's data model and SSE needs, but the React app, auth page, store streaming, and all data-backed views are entirely unwired (client-side simulation), so the product is not yet end-to-end functional; integration is the dominant remaining work.
