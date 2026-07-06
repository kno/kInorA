# Spec: 09b-plan-view

## Scenarios

### API — list endpoint (GET /workout-plans)

SC-01: GET /workout-plans — unauthenticated → 401
SC-02: GET /workout-plans — authenticated, no plans exist for user → 200 [] (empty array, not 404)
SC-03: GET /workout-plans — authenticated, plans exist → 200 array of summaries `{ id, status, createdAt }`, ordered newest-first (createdAt DESC)
SC-04: GET /workout-plans — user+tenant scoped: response contains only the requesting user's plans within the requesting tenant
SC-05: GET /workout-plans — cross-tenant / cross-user isolation: another user's or another tenant's plans never appear in the array

### API — detail endpoint (existing GET /workout-plans/:id, reused)

SC-06: GET /workout-plans/:id — unauthenticated → 401
SC-07: GET /workout-plans/:id — authenticated, owned plan with status "ready" → 200 { id, status: "ready", program: {...}, specId }
SC-08: GET /workout-plans/:id — authenticated, owned plan with status "generating" → 200 { id, status: "generating", program: undefined, specId }
SC-09: GET /workout-plans/:id — authenticated, owned plan with status "failed" → 200 { id, status: "failed", program: undefined, specId }
SC-10: GET /workout-plans/:id — cross-tenant / unowned plan id → 404 (existing tenant-scoped behavior)

### Web — /plan page (selector + default-latest)

SC-11: /plan page — unauthenticated → handled by AppShell auth guard (redirect to /login; no change needed)
SC-12: /plan page — user has no plans → renders empty state, no selector; CTA links to /create-plan
SC-13: /plan page — no `?planId` query param → defaults to the latest plan (first element of the newest-first list)
SC-14: /plan page — `?planId=<id>` present and owned → renders that specific plan on the same /plan route
SC-15: /plan page — `?planId=<id>` not owned / not found → detail fetch 404 → falls back to the latest plan (or empty state when the user has none); user never sees another user's plan
SC-16: /plan page — multiple plans exist → selector lists all of them, newest first, with the current selection marked
SC-17: /plan page — single plan exists → selector may be hidden (or show the one plan); the plan still renders
SC-18: /plan page — selected plan status "ready" → renders PlanStatusView (sessions + exercises visible)
SC-19: /plan page — selected plan status "generating" → redirect to /plan/[id] for the live WebSocket status view (no static snapshot rendered on /plan)
SC-20: /plan page — selected plan status "failed" → renders PlanStatusView failed state + a link to /plan/[id] (where Regenerate + live status live). No direct Regenerate button on /plan (keeps it a read-only server component)
SC-21: /plan page — list action fails (server action error) → renders empty state with CTA (fail-open; non-fatal for the nav tab)

### Web — selector behavior

SC-22: Selector — changing the selection navigates to `/plan?planId=<chosen-id>` (query-param navigation via router.push); the server component re-renders the selected plan on the same route
SC-23: Selector — labels each option by created date + status (workout_plans has no user-facing name); the selected option reflects the current `?planId` (or the latest when absent)
SC-24: Web data flow — browser never calls API_BASE_URL directly: list via listPlansAction, detail via getPlanStatusAction, both server-side reading the kinora_session cookie

## Invariants

- `findAllByUser` is always tenant + user scoped: WHERE tenant_id = $1 AND user_id = $2, ORDER BY created_at DESC
- A user cannot retrieve or list another tenant's or another user's plan through these endpoints
- The default selection is the latest plan = the first element of the newest-first list (no separate /workout-plans/latest route)
- The `/plan` page never issues a direct browser fetch to the API; data flows: server component → server action → internal API_BASE_URL
- Selection changes are SSR-friendly query-param navigation (`/plan?planId=<id>`), not client→API fetches
- `PlanStatusView` is reused as-is for ready/failed; generating selections redirect to /plan/[id]
- DTO field names returned by the detail endpoint match the existing contract: `{ id, status, program?, specId? }`
- The empty state (SC-12, SC-21) is a non-error UX outcome: page returns 200, no redirect; the selector is absent when the user has zero plans
