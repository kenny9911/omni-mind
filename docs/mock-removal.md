# Production Hardening — Mock & Hardcode Removal

Driven by [Prompt 10](prompts.md): *"remove hardcode and mock code, mock data, we are production
live now."* The production app now contains **no mock engine, no simulated streaming, and no seeded
fake data** — every account is real, every chat hits a real provider, and the UI shows only real
per-user data.

## What was removed

| Area | Before | After |
|---|---|---|
| **Chat engine** | `lib/server/llm/mock.ts` deterministic engine, used by demo + `LLM_MODE=mock` | Deleted. `streamOne` always calls a real provider (dedicated → OpenRouter → gateway). All `useMock` plumbing gone. |
| **Demo account** | `demo/demo123` ran the mock engine + seeded history | A **real account** on live models. `isDemo` now only marks it read-only (shared password can't change) and undeletable. |
| **Signup seed** | every account got 3 fake "¥199 paid" invoices, a "visa 4242" card, and 10 fake conversations/usage rows | Only preferences + model-state + a subscription row. **Every new account starts genuinely clean.** |
| **Non-live store sim** | `lib/store.ts` prototype typewriter simulation (`seedInitial`, `tick`/`startStream`/`finish`, `seedLedger`) — dead since `app/page.tsx` is `live:true` | Removed. `lib/content.ts` moved to `tests/helpers/`; `seedLedger` + sample arrays deleted from `lib/accounting.ts`. |
| **Frontend hardcode** | placeholder "recent chats", `"Zoe Chen"` name, static 4 suggestion cards, hardcoded ¥199 invoices, `current:true` pinned to Pro | Recents/name removed (empty until real data); suggestions come only from `/api/suggestions`; invoices from `/api/billing/invoices`; current plan from the real subscription. |
| **SSO** | `POST /api/auth/sso` minted a fake account (`google.demo@…`, no OAuth) — a real security hole found in review | Returns `503 SSO_NOT_CONFIGURED` and **never creates an account**; real OAuth must be wired first. |

A real provider is now **required** for every chat — with none configured the caller gets a clear
`503 GATEWAY_NOT_CONFIGURED` (the demo no longer bypasses this).

## Tests

The production code has no mock, so tests stub the one network seam: `tests/setup.ts` `vi.mock`s
`streamOne` with `tests/helpers/llm-stub.ts` (deterministic content via the relocated `content.ts`,
plus `MOCK_FAIL_MODELS` fault injection) and sets a gateway key so `llmConfigured()` is true. The
503 path is still exercised by deleting the key. `tsc` clean · **240 tests pass**.

## Verified live

- Fresh signup → `/api/billing/invoices` empty, payment method `null`, 0 recents.
- `demo`/`demo123` → chats on **real models** (`call.usage` + `turn.done`), 0 raw error lines.
- Browser → no `Zoe Chen`, no placeholder recents, 0 console errors.

## Known follow-ups (flagged, not done here)

1. **Existing data:** accounts created *before* this change still hold their old seeded invoices/usage
   rows. A one-time cleanup (delete seeded `invoices`/`payment_methods`/`usage_records` for pre-existing
   users, or reset the DB) is needed to fully clean production.
2. **Usage page numbers:** the Usage view and the Billing credit/used/remaining figures still derive
   from the **session-scoped client ledger** (real, but only this session) + a display-only ¥150 limit,
   rather than the all-time `/api/usage` + subscription data. Wiring those to the backend is a worthwhile
   next step.
3. **Default plan:** new signups still default to **Pro** (a product default in `seedNewUser`, not fake
   data). Switch to **Free** if new users shouldn't start on a paid tier.
