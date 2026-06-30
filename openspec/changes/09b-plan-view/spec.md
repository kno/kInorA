# Spec: 09b-plan-view

## Scenarios

SC-01: GET /workout-plans/latest — unauthenticated → 401
SC-02: GET /workout-plans/latest — authenticated, no plan exists for user → 404 { error: "not_found" }
SC-03: GET /workout-plans/latest — authenticated, plan exists with status "ready" → 200 { id, status: "ready", program: {...}, specId }
SC-04: GET /workout-plans/latest — authenticated, plan exists with status "generating" → 200 { id, status: "generating", program: undefined, specId }
SC-05: GET /workout-plans/latest — authenticated, plan exists with status "failed" → 200 { id, status: "failed", program: undefined, specId }
SC-06: GET /workout-plans/latest — cross-tenant: user A cannot see user B's plan → 404
SC-07: GET /workout-plans/latest — multiple plans exist for the user (regenerated); returns only the newest (highest createdAt)
SC-08: /plan page — unauthenticated → handled by AppShell auth guard (redirect to /login; no change needed)
SC-09: /plan page — user has a ready plan → renders PlanStatusView with status="ready" and program; sessions and exercises visible
SC-10: /plan page — user has a generating plan → redirect to /plan/[id] for the live WebSocket status view (no static snapshot rendered on /plan)
SC-11: /plan page — user has a failed plan → renders PlanStatusView with status="failed"; error message and a link to /plan/[id] (where Regenerate + live status live). No direct Regenerate button on /plan (keeps it a read-only server component)
SC-12: /plan page — user has no plan → renders empty state; CTA links to /create-plan
SC-13: /plan page — API call fails (server action returns error) → renders empty state with CTA (fail-open; error is non-fatal for the nav tab)
SC-14: Web server action — browser never calls API_BASE_URL directly; action reads kinora_session cookie and calls internal API

## Invariants

- `findLatestByUser` is always tenant + user scoped: WHERE tenant_id = $1 AND user_id = $2
- A user cannot retrieve another tenant's or another user's plan through this endpoint
- The `/plan` page never issues a direct browser fetch to the API; data flows: server component → server action → internal API_BASE_URL
- `PlanStatusView` is reused as-is; no new plan renderer is built
- DTO field names returned by `GET /workout-plans/latest` match the existing contract: `{ id, status, program?, specId? }`
- Empty state (SC-12 + SC-13) is a non-error UX outcome: page returns 200, no redirect
