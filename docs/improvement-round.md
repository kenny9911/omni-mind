# PO Improvement Round — Loop Log

The delivery loop the user asked for: **implement → test → PO review → fix the gaps → re-verify.**
This records round 1 (the only round needed to clear all P1s).

## Inputs

- **PO verdict:** [po-review.md](po-review.md) — **GO WITH FIXES, 82/100**, 0 P0, **12 P1**, 12 P2.
- Suite before: 187/187 green. Critic reports: [docs/review/](review/).

## P1 gaps and how each was resolved

| Gap | Area | Fix | Verified by |
|---|---|---|---|
| **G1** | LLM billing | Fast/single & fusion now branch on call `status`/abort; failed or truncated calls are **not** billed at `status:"ok"`+fee; a fatal fast error throws → SSE `error` + turn `failed`. `lib/server/llm/fusion.ts`, `gateway.ts` | `improvements.test.ts` G1 |
| **G2** | LLM | Client-disconnect/abort marks the turn **`partial`** (not `done`) and skips fusion billing. `fusion.ts` | logic + abort guard |
| **G3** | LLM | All-experts-fail emits a typed `ALL_EXPERTS_FAILED` error, bills **no** fusion, marks the turn `failed`. `fusion.ts` | `improvements.test.ts` G3 |
| **G4** | DB/LLM | `turns` now persists `main_model`/`trio_json`/`auto` at send time; **regenerate replays the original turn's** trio/compiler, not current prefs. `schema.ts`, `ddl.ts`, `chat/route.ts`, `regenerate/run.ts` | `improvements.test.ts` G4 |
| **G5** | LLM/PRD | `deepAgents` now has an observable, billed effect (input-token inflation, parallel to `deepResearch`). `fusion.ts` | `improvements.test.ts` G5 |
| **G6** | Tests | Added the admin-metrics happy-path test (promote a user to `admin`, assert the metrics shape + counts). | `improvements.test.ts` G6 |
| **G7** | Docs | Cost formula in technical-design §0/§3.5 updated to bill reasoning at output price, matching `cost.ts`. | docs workflow |
| **G8** | Docs | `user-stories*.md` auth codes/plan reconciled to the handlers (`AUTH_*`, `plan:"pro"`). | docs workflow |
| **G9** | Billing | `platformFeePerCallMicro` now single-sourced from `PLATFORM_FEE_MICRO()` in summary/usage/preferences (no literals). | tsc + tests |
| **G10/G11** | Frontend | Store wired to the real backend: session guard + bootstrap, **real SSE chat streaming**, preference/model persistence, account/logout, live recents; DTO→ledger adapter (`lib/client/live.ts`). | live Playwright e2e |
| **G12** | Security | Login runs a dummy scrypt on unknown-email so timing matches wrong-password (no enumeration). `auth/login/route.ts` | `improvements.test.ts` G12 |
| **G20** | Docs | Env vars documented to match the code (`MOCK_STREAM_*`, `SEED_DEMO`, `MOCK_FAIL_MODELS`, …); phantom vars annotated. | docs workflow |
| (P2) G18 | Security | Card validation hardened: `last4` digits-only, `brand` enum, bounded `expYear`. `contracts/billing.ts` | `improvements.test.ts` G18 |

## Re-verification (after fixes)

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **194 passing** (187 original + 7 new regression tests in `tests/improvements.test.ts`)
- `npm run build` → clean (30 API routes + 2 pages)
- **Live end-to-end (browser):** unauthenticated `/` → `/login`; signup → app bootstraps with the real
  user; a multi-expert prompt streams over real SSE (fusion answer + ¥0.2583 turn cost); the Usage view
  shows the same real figures (zero drift); reload keeps the session.

## Remaining (accept-now / fast-follow)

The remaining P2s (G13–G17, G19, G21–G24 — mostly minor doc drift, rate-limiting/CSRF hardening, and
SSE-frame polish) are documented in [po-review.md](po-review.md) §3 and are non-blocking for a
happy-path turn. They are the recommended next hardening pass before production.
