# Tasks: 09b-plan-view

## Review Workload Forecast

Estimated lines changed:
- `workout-plan.ts` (repo): +25 lines (`findAllByUser` + `WorkoutPlanSummary` type)
- `workout-plan.test.ts` (repo tests): +45 lines
- `plan.ts` (route): +30 lines (`GET /workout-plans` list handler + planRepo option extension)
- `plan.test.ts` (route tests): +55 lines (200 array/empty, 401, scoping)
- `plan-draft-client.ts`: +35 lines (`fetchUserPlans` + types)
- `plan/actions.ts` (new): +20 lines (`listPlansAction`)
- `plan/PlanSelector.tsx` (new client component): +45 lines
- `plan/__tests__/PlanSelector.test.tsx` (new): +50 lines
- `plan/page.tsx` (replace): ~70 lines net change (searchParams + selector + selected-state resolution)
- `plan/__tests__/page.test.tsx` (new): +95 lines (default-latest, ?planId, unowned fallback, states, empty)
- `en.json` / `es.json`: +10 lines each (empty-state + selector keys)

**Total estimated: ~490 lines** (additions + deletions combined)

Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High (~490 lines estimated — exceeds the 400-line budget)

### Recommended slicing (2 chained PRs)

- **PR #1 — API list (backend slice, ~155 lines)**: T1 + T2 (repo `findAllByUser`, route
  `GET /workout-plans`, both test suites). Self-contained, independently mergeable and verifiable;
  no UI dependency. Clear rollback (revert one route + one method).
- **PR #2 — Web selector + page (frontend slice, ~335 lines)**: T3–T7 (client fetch helper, server
  action, `PlanSelector`, `/plan` page rewrite, i18n, web tests). Targets PR #1's branch; depends on
  the list endpoint shipped in PR #1.

If the orchestrator's delivery strategy resolves to `single-pr` or an explicit `size:exception`,
the work MAY ship as one PR; otherwise apply the chained slices above.

## Tasks

- [x] T1: `WorkoutPlanRepository.findAllByUser` — add method + unit tests  _(PR #1)_
  - File: `apps/api/src/db/repositories/workout-plan.ts`
  - Tests: `apps/api/src/db/repositories/__tests__/workout-plan.test.ts`
  - Add `WorkoutPlanSummary { id, status, createdAt }`; return `WorkoutPlanSummary[]`
  - Query: SELECT id, status, created_at FROM workout_plans WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC
  - Test cases: newest-first ordering; only tenant+user rows; empty array for unknown user; cross-tenant excluded; cross-user (same tenant) excluded
  - Conventional commit: `feat(api): add WorkoutPlanRepository.findAllByUser`

- [x] T2: `GET /workout-plans` list route + integration tests  _(PR #1)_
  - File: `apps/api/src/routes/plan.ts`
  - Tests: `apps/api/src/routes/__tests__/plan.test.ts` (extend existing file)
  - Extend `PlanRoutesOptions.planRepo` Pick to include `findAllByUser`
  - Auth: `requireAuth()` preHandler; tenant + userId from `authContext`
  - Returns: 200 `Array<{ id, status, createdAt }>` newest-first; `[]` when none
  - Test cases: 200 array (DTO shape + ordering); 200 [] when no plans; 401 unauthenticated; scoping (only own plans returned)
  - Conventional commit: `feat(api): GET /workout-plans list route`

- [x] T3: `fetchUserPlans` in plan-draft-client + `listPlansAction` server action  _(PR #2)_
  - File: `apps/web/src/app/(app)/create-plan/plan-draft-client.ts` — add `fetchUserPlans(token, options?)` + `PlanSummary`/`FetchUserPlansResult` types
  - File: `apps/web/src/app/(app)/plan/actions.ts` — create `"use server"` module with `listPlansAction()`
  - Detail fetch reuses existing `getPlanStatusAction(planId)` from `plan/[id]/actions.ts` — do NOT duplicate
  - Mirror `fetchPlanStatus` / `getPlanStatusAction` pattern exactly
  - Conventional commit: `feat(web): listPlansAction server action`

- [x] T4: `PlanSelector` client component + tests  _(PR #2)_
  - File: `apps/web/src/app/(app)/plan/PlanSelector.tsx` — `"use client"`; `<select>` of summaries (newest first)
  - On change: `router.push("/plan?planId=" + id)` (next/navigation `useRouter`)
  - Mark the current selection (from a `selectedId` prop) as the selected option
  - Label options by created date + status using `plan_selector_*` i18n
  - Tests: `apps/web/src/app/(app)/plan/__tests__/PlanSelector.test.tsx` — renders options newest-first; onChange pushes `/plan?planId=<id>`; current selection marked
  - Conventional commit: `feat(web): PlanSelector plan picker`

- [x] T5: Replace `/plan` placeholder page (searchParams + selector + selected plan)  _(PR #2)_
  - File: `apps/web/src/app/(app)/plan/page.tsx` — rewrite to async server component
  - Read `searchParams.planId` (Next 15: `searchParams` is a Promise — `await` it)
  - Call `listPlansAction()`; if list empty/error → empty state CTA (no selector)
  - Resolve `selectedId = searchParams.planId ?? summaries[0].id`; call `getPlanStatusAction(selectedId)`
  - If detail 404 (unowned/stale id) → fall back to `summaries[0]` (or empty when none)
  - Render `PlanSelector` (when >1 plan; optional when exactly 1) + selected-plan state:
    - `ready` → `<PlanStatusView status="ready" program={...} planId={plan.id} specId={plan.specId} messages={messages} />`
    - `generating` → `redirect("/plan/" + plan.id)` (live WS view)
    - `failed` → `<PlanStatusView status="failed" planId={plan.id} specId={plan.specId} messages={messages} />` + link to `/plan/[id]`
    - zero plans → empty state card with `plan_nav_empty_*` copy + `<a href="/create-plan">` CTA
  - Note: no `onRegenerate` on `/plan`; failed links out to `/plan/[id]`
  - Conventional commit: `feat(web): /plan tab plan selector + selected plan view`

- [x] T6: Web page tests  _(PR #2)_
  - File: `apps/web/src/app/(app)/plan/__tests__/page.test.tsx` — create
  - Mock `listPlansAction` + `getPlanStatusAction` via `vi.mock`; mock `next/navigation` redirect
  - Test cases: default-latest when no param; `?planId=X` selects that plan; unowned id falls back; ready renders sessions; failed renders link-out; generating triggers redirect; empty state with `/create-plan` link (no selector); selector present when multiple plans
  - Conventional commit: included in T5 or `test(web): /plan page selector + states`

- [x] T7: i18n keys  _(PR #2)_
  - File: `apps/web/src/i18n/messages/en.json` — add:
    - `"plan_nav_empty_title"`: `"No plan yet"`
    - `"plan_nav_empty_desc"`: `"Create your personalized workout plan to get started."`
    - `"plan_nav_empty_cta"`: `"Create your plan"`
    - `"plan_selector_label"`: `"Select a plan"`
    - `"plan_selector_option"`: option label format combining created date + status
  - File: `apps/web/src/i18n/messages/es.json` — add same keys in Spanish (neutral)
  - Conventional commit: `feat(i18n): plan tab empty-state + selector keys (en + es)`
