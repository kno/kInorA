# Tasks: 09b-plan-view

## Review Workload Forecast

Estimated lines changed:
- `workout-plan.ts` (repo): +25 lines (method + test)
- `plan.ts` (route): +30 lines (route handler + planRepo option extension)
- `plan.test.ts` (route tests): +60 lines
- `workout-plan.test.ts` (repo tests): +40 lines
- `plan-draft-client.ts`: +30 lines (fetchLatestPlan)
- `plan/actions.ts` (new): +20 lines
- `plan/page.tsx` (replace): ~40 lines net change
- `plan/__tests__/page.test.tsx` (new): +70 lines
- `en.json` / `es.json`: +6 lines each

**Total estimated: ~325 lines** (additions + deletions combined)

Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Low (~325 lines estimated — comfortably under budget)

## Tasks

- [ ] T1: `WorkoutPlanRepository.findLatestByUser` — add method + unit tests
  - File: `apps/api/src/db/repositories/workout-plan.ts`
  - Tests: `apps/api/src/db/repositories/__tests__/workout-plan.test.ts`
  - Query: SELECT … FROM workout_plans WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1
  - Test cases: returns newest row; undefined when no rows; undefined for cross-tenant; undefined for cross-user same tenant
  - Conventional commit: `feat(api): add WorkoutPlanRepository.findLatestByUser`

- [ ] T2: `GET /workout-plans/latest` route + integration tests
  - File: `apps/api/src/routes/plan.ts`
  - Tests: `apps/api/src/routes/__tests__/plan.test.ts` (extend existing file)
  - Register route BEFORE `/workout-plans/:id` to avoid param collision
  - Extend `PlanRoutesOptions.planRepo` pick to include `findLatestByUser`
  - Auth: `requireAuth()` preHandler; tenant + userId from `authContext`
  - Returns: 200 DTO `{ id, status, program?, specId? }` or 404 `{ error: "not_found" }`
  - Test cases: 200 ready plan (DTO shape); 200 generating plan; 404 no plan; 401 unauthenticated; cross-user returns 404
  - Conventional commit: `feat(api): GET /workout-plans/latest route`

- [ ] T3: `fetchLatestPlan` in plan-draft-client + server action `getLatestPlanAction`
  - File: `apps/web/src/app/(app)/create-plan/plan-draft-client.ts` — add `fetchLatestPlan(token, options?)`
  - File: `apps/web/src/app/(app)/plan/actions.ts` — create `"use server"` module with `getLatestPlanAction()`
  - Mirror `fetchPlanStatus` / `getPlanStatusAction` pattern exactly
  - `FetchLatestPlanResult` type: same union shape as `FetchPlanResult`
  - Conventional commit: `feat(web): getLatestPlanAction server action`

- [ ] T4: Replace `/plan` placeholder page
  - File: `apps/web/src/app/(app)/plan/page.tsx` — rewrite to async server component
  - Calls `getLatestPlanAction()` at render time (no `await params` needed — no dynamic segment)
  - Reads locale + messages (mirrors `/plan/[id]/page.tsx` pattern)
  - Renders four states:
    - `ready` → `<PlanStatusView status="ready" program={...} planId={plan.id} specId={plan.specId} messages={messages} />`
    - `generating` → `<PlanStatusView status="generating" planId={plan.id} messages={messages} />` + link to `/plan/[id]`
    - `failed` → `<PlanStatusView status="failed" planId={plan.id} specId={plan.specId} messages={messages} />` wrapped with link to `/plan/[id]` for regeneration
    - no plan (error or 404) → empty state card with `plan_nav_empty_*` i18n copy + `<a href="/create-plan">` CTA
  - Note: `PlanStatusView` receives no `onRegenerate` here; the failed state links to `/plan/[id]` for that action
  - Conventional commit: `feat(web): /plan tab shows user latest workout plan`

- [ ] T5: Web page tests
  - File: `apps/web/src/app/(app)/plan/__tests__/page.test.tsx` — create
  - Mock `getLatestPlanAction` via `vi.mock`
  - Test cases: renders session list for ready plan; renders generating spinner; renders failed message; renders empty state with `/create-plan` link; CTA href is `/create-plan`
  - Conventional commit: included in T4 commit or `test(web): /plan page state coverage`

- [ ] T6: i18n keys
  - File: `apps/web/src/i18n/messages/en.json` — add:
    - `"plan_nav_empty_title"`: `"No plan yet"`
    - `"plan_nav_empty_desc"`: `"Create your personalized workout plan to get started."`
    - `"plan_nav_empty_cta"`: `"Create your plan"`
  - File: `apps/web/src/i18n/messages/es.json` — add same keys in Spanish (neutral)
  - Conventional commit: `feat(i18n): plan tab empty-state keys (en + es)`
