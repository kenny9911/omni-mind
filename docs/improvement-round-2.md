# Improvement Round 2 — UI/feature completion (2026-06-26)

Driven by [Prompt 6](prompts.md#prompt-6--uifeature-completion-round-2026-06-26). Six asks, each
delivered against the real backend (demo = mock+seeded, all other accounts = live AI Gateway) and
verified with `tsc`, the Vitest suite (**212 green**), and headless-browser checks on the demo flow.

| # | Ask | Status |
|---|-----|--------|
| 1 | Editable expert trio | ✅ |
| 2 | Disabled models excluded from the trio | ✅ |
| 3 | Restore a historical conversation (history + results) | ✅ |
| 4 | Fix terminal/browser console errors | ✅ |
| 5 | Multi-model expert calls run in parallel | ✅ |
| 6 | Continue completing remaining/unfinished features | ✅ (rename/delete + G24) |

---

## 1 & 2 — Editable trio + disabled-model exclusion

**UI.** Expert mode's top-bar trio chips became a picker (`components/chat/ChatView.tsx` ModeBar):
a dropdown listing **only enabled models**, each toggling membership in a pending draft. Selecting a
fourth drops the oldest (replace-oldest), so the draft is always a valid three; **Apply** commits.

**Store / persistence.** `lib/store.ts` adds `trioDraft` plus `toggleTrioMenu` / `toggleTrioDraft` /
`applyTrio`; apply persists via `PATCH /api/preferences {trio}`. The server already validates a trio
as **3 distinct enabled** ids (`assertTrio` → `400 INVALID_TRIO`), which the picker can never violate.

**Disable ⇒ deselect.** Previously disabling a model that sat in the trio returned `409 MODEL_IN_TRIO`,
forcing manual edits. Now `PATCH /api/models/:id {enabled:false}` **drops it from the trio and
backfills** the first still-enabled model, returning the new `trio` in the response
(`app/api/models/[id]/route.ts`). The client mirrors this optimistically and reconciles with the
server's authoritative trio (`toggleEnabled`). The main/compiler model is still protected
(`409 CANNOT_DISABLE_MAIN`).

**Verified (live):** change trio → persisted; duplicate/unknown → `INVALID_TRIO`; disable trio member
→ `200` + backfilled trio without it; re-selecting a disabled model → `INVALID_TRIO`. Browser: picker
lists enabled models, applying swaps the chips, **0 console errors**.

## 3 — Restore a historical conversation

Sidebar recents are now clickable. `store.openConversation(id)` fetches
`GET /api/conversations/:id/messages` and rehydrates the chat with **completed** turns — user prompts,
single answers, the three expert panels, and the fusion reasoning+answer (including any inline
compiler error) — all marked `done` so nothing re-animates. The opened conversation is pinned as
`activeConversationId`, so new turns **thread into it** (the chat body now sends `conversationId`), and
the sidebar highlights the active row.

**Verified (live):** clicking a seeded expert conversation restored the prompt + 3 expert badges +
fusion answer (4 Copy buttons = 3 experts + 1 fusion, ~3.1k chars), **0 console errors**.

## 4 — Console errors

The free-tier AI Gateway key restricts `claude-opus` (403) and rate-limits `gpt-5` (429). The AI SDK
routes stream failures to `onError` rather than throwing, so they were surfacing as raw stack traces
and empty "ok" answers. `lib/server/llm/gateway.ts` now captures `onError`, treats empty/errored
output as `status:"error"` with a clean `gateway.call_failed` **warn** line, and the failure surfaces
**inline on the fusion card** (`answer.error` → `FusionState.answerError`) instead of a phantom blank
answer or a wedged spinner. Verified: **0 raw stack traces** in the terminal and **0 browser console
errors** on the demo flow.

## 5 — Parallel expert calls

Confirmed the three experts already fan out concurrently via `Promise.all` in
`lib/server/llm/fusion.ts` (the fusion compiler then runs once, after they settle). No change needed
beyond verification.

## 6 — Continued completion

- **Conversation rename / delete (new UI).** The `PATCH`/`DELETE /api/conversations/:id` endpoints
  existed but had no UI. Added per-recent hover affordances (`components/Sidebar.tsx`): inline rename
  (Enter commits, Esc cancels) and a two-step inline delete-confirm, wired through
  `beginRenameRecent` / `commitRenameRecent` / `beginDeleteRecent` / `confirmDeleteRecent`. Deleting
  the open conversation clears the chat view. **Verified (live):** rename → persisted; delete → row
  removed and gone from the backend; **0 console errors**.
- **G24 — SSE error-leak hardening.** `lib/server/sse.ts` previously forwarded any throw's raw
  `Error.message` to the client. It now forwards a message only for `ApiError` or an allow-listed safe
  code (`PROVIDER_ERROR`, `ALL_EXPERTS_FAILED`); every other throw collapses to a generic
  `INTERNAL` / "Internal error" frame and is logged server-side. Covered by `tests/sse-sanitize.test.ts`.

---

## Test status

`tsc --noEmit` clean · **212 Vitest tests pass** (16 files), incl. the updated models-disable test
(now asserting backfill) and the new SSE sanitization suite. Headless-browser smoke of the demo flow
(`scripts/verify-ui.py`) confirms the trio picker and conversation restore with a clean console.
