# Design: 09b-plan-view

## Technical Approach

Add a `findLatestByUser` repo method + `GET /workout-plans/latest` route on the API,
then wire a `getLatestPlanAction` server action and replace the `/plan` placeholder
page with a server component that renders four states via the existing `PlanStatusView`.
No new DB schema changes; no new plan renderer.

## Architecture Decisions

### Decision: Route name — GET /workout-plans/latest vs GET /me/workout-plan

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `GET /workout-plans/latest` | Consistent with the existing `/workout-plans/:id` namespace; "latest" clearly signals recency | **Chosen** |
| `GET /me/workout-plan` | RESTy self-resource pattern, but `/me` namespace does not exist elsewhere in this API; introduces inconsistency | Rejected |

**Rationale**: The API currently uses resource-first routing (`/workout-plans/:id`,
`/plan-specs/:id/workout-plan`). Adding `/workout-plans/latest` stays in that namespace
and avoids bootstrapping a `/me` prefix for a single endpoint. Fastify route ordering
ensures `/workout-plans/latest` is registered before `/workout-plans/:id` so the literal
`latest` is not matched as an id.

### Decision: Server component (no client-side fetch) for /plan page

**Choice**: `/plan/page.tsx` is an async server component that calls `getLatestPlanAction()`
at render time — same pattern as `/plan/[id]/page.tsx` calling `fetchPlanStatus`.

**Alternatives considered**: Client component with a `useEffect` + server action call
(adds loading flicker, would require `"use client"` wrapper, breaks the existing server action pattern).

**Rationale**: Server components give us zero-JS data fetching, SSR HTML for first paint,
and trivially enforce the browser-never-calls-API constraint. The `/plan` tab shows a
snapshot; real-time tracking is the `/plan/[id]` concern.

### Decision: No WebSocket / polling on /plan tab

**Choice**: Static snapshot only; generating plans show a "generating" state with a link to `/plan/[id]`.

**Rationale**: The WS hook (`use-plan-ws.ts`) is a client-side construct requiring a
client component. Adding it to the nav tab would pull in client-component weight and
duplicate the logic already in `/plan/[id]`. Users with an in-flight plan can follow the
link to the live-tracking screen.

### Decision: Fail-open on action error

**Choice**: When `getLatestPlanAction()` returns an error (network, timeout), render
empty state with CTA instead of an error page.

**Rationale**: A missing plan is normal for new users. Treating a transient API error
identically to "no plan yet" gives a usable nav tab even under partial API failure,
avoiding a broken nav experience for a non-critical read path.

## Data Flow

```
Browser ──GET /plan──→ Next.js (server component: plan/page.tsx)
                              │
                              └─ getLatestPlanAction()  [server action]
                                        │
                                        └─ fetch(API_BASE_URL/workout-plans/latest)
                                                  │
                                                  └─ WorkoutPlanRepository.findLatestByUser(tenantId, userId)
                                                            │
                                                            └─ workout_plans table
                                                                 ORDER BY created_at DESC LIMIT 1
                                                                 WHERE tenant_id = $1 AND user_id = $2

plan/page.tsx receives result ──→ PlanStatusView (ready | generating | failed | empty)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/repositories/workout-plan.ts` | Modify | Add `findLatestByUser(tenantId, userId)` method |
| `apps/api/src/routes/plan.ts` | Modify | Register `GET /workout-plans/latest`; inject `findLatestByUser` via `planRepo` option |
| `apps/web/src/app/(app)/plan/actions.ts` | Create | `getLatestPlanAction()` — `"use server"`, reads cookie, calls `fetchLatestPlan` |
| `apps/web/src/app/(app)/create-plan/plan-draft-client.ts` | Modify | Add `fetchLatestPlan(token, options)` alongside `fetchPlanStatus` |
| `apps/web/src/app/(app)/plan/page.tsx` | Modify | Replace placeholder with async server component using `getLatestPlanAction` + `PlanStatusView` |
| `apps/web/src/i18n/messages/en.json` | Modify | Add empty-state i18n keys: `plan_nav_empty_title`, `plan_nav_empty_desc`, `plan_nav_empty_cta` |
| `apps/web/src/i18n/messages/es.json` | Modify | Same keys in Spanish |
| `apps/api/src/db/repositories/__tests__/workout-plan.test.ts` | Modify | Add tests for `findLatestByUser` |
| `apps/api/src/routes/__tests__/plan.test.ts` | Modify | Add tests for `GET /workout-plans/latest` (200/401/404/cross-user) |
| `apps/web/src/app/(app)/plan/__tests__/page.test.tsx` | Create | Tests for `/plan` page: ready/generating/failed/empty states |

## Interfaces / Contracts

```ts
// apps/api/src/db/repositories/workout-plan.ts — new method
async findLatestByUser(
  tenantId: string,
  userId: string
): Promise<WorkoutPlanRecord | undefined>

// apps/web/src/app/(app)/create-plan/plan-draft-client.ts — new function
export type FetchLatestPlanResult =
  | { kind: "ok"; plan: PlanStatusResponse }
  | { kind: "error"; message: string };

export async function fetchLatestPlan(
  token: string | undefined,
  options?: ClientOptions
): Promise<FetchLatestPlanResult>

// apps/web/src/app/(app)/plan/actions.ts — new server action
export async function getLatestPlanAction(): Promise<FetchLatestPlanResult>
```

Route DTO (unchanged contract, same as existing endpoints):
```ts
// GET /workout-plans/latest → 200
{ id: string; status: string; program?: WorkoutProgram; specId?: string }
// → 404
{ error: "not_found" }
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — repo | `findLatestByUser`: returns newest row for tenant+user; returns undefined for unknown user; returns undefined for cross-tenant user | Vitest with mock Drizzle db |
| Unit — web client | `fetchLatestPlan`: 200 maps to `kind:"ok"`; 404 maps to `kind:"error","not_found"`; 401 maps to error; no token → error | Vitest with `fetchImpl` mock |
| Integration — route | `GET /workout-plans/latest`: 200 ready plan with DTO shape; 404 no plan; 401 unauthenticated; cross-user returns 404 | Vitest + in-memory Fastify + mock planRepo |
| Unit — web page | renders ready plan; renders generating state; renders failed state; renders empty state with `/create-plan` CTA | Vitest + React Testing Library |

## Migration / Rollout

No migration required. `findLatestByUser` is a pure read query on the existing
`workout_plans` table; no schema change. The new API route is additive. The `/plan`
page replacement is a single atomic page swap with no backward-compatibility concern.
