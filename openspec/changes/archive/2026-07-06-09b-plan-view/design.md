# Design: 09b-plan-view

## Technical Approach

Add a `findAllByUser` repo method + `GET /workout-plans` list route on the API. Replace the
`/plan` placeholder with an async server component that reads `searchParams.planId`, lists the
user's plans (newest first) for a selector, defaults to the latest (first list item), and fetches
the selected plan's detail via the existing `GET /workout-plans/:id`. A small client selector
navigates to `/plan?planId=<id>` so the server re-renders the chosen plan on the same route.
No new DB schema; no new plan renderer (reuse `PlanStatusView`).

## Architecture Decisions

### Decision: Default-latest source — list-first vs a dedicated /workout-plans/latest route

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Derive default from list's first item | The list is already ORDER BY created_at DESC, so `list[0]` IS the latest. One endpoint, one ordering invariant. | **Chosen** |
| Keep a separate `GET /workout-plans/latest` route | Redundant: a second route returning a value the list already exposes; two places that must agree on "newest" ordering, risking drift | Rejected |

**Rationale**: The selector needs the full list anyway. Adding `/latest` would duplicate the
newest-first contract the list already guarantees and create a second route to keep consistent.
Deriving the default from `list[0]` is DRY and removes a route.

### Decision: Selector via query-param navigation (no client→API fetch)

**Choice**: The selector is a small client component (`<select>`). On change it calls
`router.push("/plan?planId=" + id)`. The `/plan` server component reads `searchParams.planId`,
resolves the selected plan server-side, and re-renders.

**Rationale**: Query-param navigation keeps ALL data-fetching server-side, makes the selection
shareable/bookmarkable, satisfies "shows on the same page" (same `/plan` route re-rendered with the
new param), and needs only a tiny client component for the `<select>` + `router.push`.

### Decision: Server component (no client-side data fetch) for /plan page

**Choice**: `/plan/page.tsx` is an async server component that calls `listPlansAction()` and
`getPlanStatusAction(selectedId)` at render time — same pattern as `/plan/[id]/page.tsx`.

### Decision: Per-selection states; redirect in-flight plans to /plan/[id]

- `generating` → **`redirect("/plan/${id}")`** so the user lands on the live WebSocket status view.
- `failed` → render `PlanStatusView` failed state with a **link** to `/plan/[id]`. No Regenerate button on `/plan`.
- `ready` → render `PlanStatusView`.
- `empty` state applies only when the user has NO plans at all (no selector shown).

### Decision: Fail-open on action error / unowned planId

When `listPlansAction()` errors → render empty state with CTA. When `?planId` is not
owned/found (detail 404) → fall back to the latest plan (or empty when none).

## Data Flow

```
Browser ──GET /plan[?planId=X]──→ Next.js (server component: plan/page.tsx)
        │
        ├─ listPlansAction()  [server action]
        │        └─ fetch(API_BASE_URL/workout-plans)
        │                 └─ WorkoutPlanRepository.findAllByUser(tenantId, userId)
        │                          └─ workout_plans  WHERE tenant_id=$1 AND user_id=$2
        │                                            ORDER BY created_at DESC
        │        → summaries[]  (selectedId = searchParams.planId ?? summaries[0].id)
        │
        └─ getPlanStatusAction(selectedId)  [existing server action]
                 └─ fetch(API_BASE_URL/workout-plans/:id)
                          └─ WorkoutPlanRepository.findById(tenantId, id)

plan/page.tsx renders ──→ PlanSelector (client, summaries) + PlanStatusView (ready|failed)
                          generating → redirect("/plan/${selectedId}")
                          zero plans → empty state CTA (no selector)

PlanSelector onChange ──→ router.push("/plan?planId=<id>") ──→ server re-render
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/repositories/workout-plan.ts` | Modify | Add `findAllByUser(tenantId, userId)` → summaries, newest first |
| `apps/api/src/routes/plan.ts` | Modify | Register `GET /workout-plans` (list); extend `planRepo` option Pick to include `findAllByUser` |
| `apps/web/src/app/(app)/create-plan/plan-draft-client.ts` | Modify | Add `fetchUserPlans(token, options)` (list) alongside `fetchPlanStatus` |
| `apps/web/src/app/(app)/plan/actions.ts` | Create | `listPlansAction()` — `"use server"`, reads cookie, calls `fetchUserPlans` |
| `apps/web/src/app/(app)/plan/PlanSelector.tsx` | Create | Client component: `<select>` of summaries; `router.push("/plan?planId=<id>")` on change |
| `apps/web/src/app/(app)/plan/page.tsx` | Modify | Replace placeholder with async server component |
| `apps/web/src/i18n/messages/en.json` | Modify | Add keys: `plan_nav_empty_*` + `plan_selector_label`, `plan_selector_option` |
| `apps/web/src/i18n/messages/es.json` | Modify | Same keys in Spanish |
| `apps/api/src/db/repositories/__tests__/workout-plan.test.ts` | Modify | Add tests for `findAllByUser` |
| `apps/api/src/routes/__tests__/plan.test.ts` | Modify | Add tests for `GET /workout-plans` |
| `apps/web/src/app/(app)/plan/__tests__/page.test.tsx` | Create | Tests: selector + ready/failed/empty + default-latest + `?planId` selection |
| `apps/web/src/app/(app)/plan/__tests__/PlanSelector.test.tsx` | Create | Tests: renders options newest-first; onChange pushes `/plan?planId=<id>` |

## Interfaces / Contracts

```ts
// New repo method
export interface WorkoutPlanSummary {
  id: string;
  status: "generating" | "ready" | "failed";
  createdAt: Date;
}
async findAllByUser(tenantId: string, userId: string): Promise<WorkoutPlanSummary[]>

// New client function
export async function fetchUserPlans(
  token: string | undefined,
  options?: ClientOptions
): Promise<FetchUserPlansResult>

// New server action
export async function listPlansAction(): Promise<FetchUserPlansResult>
```

List route DTO:
```ts
// GET /workout-plans → 200
Array<{ id: string; status: string; createdAt: string }>   // newest first; [] when none
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — repo | `findAllByUser`: newest-first order; only tenant+user rows; empty array for unknown user; cross-tenant/cross-user excluded | Vitest + mock Drizzle db |
| Integration — route | `GET /workout-plans`: 200 array (DTO shape, ordering); 200 [] when none; 401 unauthenticated; scoping | Vitest + in-memory Fastify + mock planRepo |
| Unit — selector | renders options newest-first; onChange → `router.push("/plan?planId=<id>")` | Vitest + RTL + mocked next/navigation |
| Unit — web page | default-latest; `?planId` selection; unowned fallback; ready/failed/empty states | Vitest + RTL, mock actions |

## Migration / Rollout

No migration required. `findAllByUser` is a pure read query on the existing `workout_plans` table.
The new `GET /workout-plans` route is additive. The `/plan` page replacement is an atomic swap.
