# Proposal: 09b-plan-view

## Problem

The `/plan` nav tab is a placeholder. After a user generates a workout plan (change 08),
there is no screen reachable from the main navigation that displays it. The only existing
plan view (`/plan/[id]`) requires the user to already know a specific plan ID — it is
not discoverable from the nav.

## Solution

Replace the placeholder `/plan` page with a real server-rendered view that:
1. Lists the user's workout plans (newest first) via a new `GET /workout-plans` API route
   (tenant + user scoped) and offers a **selector** to choose which plan to view.
2. Defaults to the latest plan (first element of the list); reading `?planId=<id>` from the
   URL renders the chosen plan on the SAME page (selection changes via query-param navigation,
   not a client→API fetch).
3. Renders the appropriate state (ready / generating / failed / no plan) by reusing the
   existing `PlanStatusView` component — no new plan renderer.
4. Routes all data through Next.js server components / server actions (browser never
   calls the API directly — enforced by `ui-api-guard.mjs`).

## Scope

1. **API list** — `WorkoutPlanRepository.findAllByUser(tenantId, userId)` + route
   `GET /workout-plans` returning an array of summaries `{ id, status, createdAt }`, newest first.
2. **API detail** — reuse the existing `GET /workout-plans/:id` (DTO `{ id, status, program?, specId? }`)
   to fetch the selected plan's detail. No `/workout-plans/latest` route (default = list's first item).
3. **Web server action** — `listPlansAction()` (`"use server"`, reads cookie, calls list route);
   reuse `getPlanStatusAction(planId)` for detail.
4. **Web selector** — small client component (`<select>`); changing it navigates to
   `/plan?planId=<id>` so the server component re-renders the selected plan.
5. **Web `/plan` page** — server component replacing the placeholder; reads `searchParams.planId`,
   resolves the selected plan, renders the selector + four states: ready, generating
   (redirect to `/plan/[id]`), failed (link to `/plan/[id]`), no plans (empty state with `/create-plan` CTA).
6. **i18n** — new keys (`plan_nav_empty_*`, `plan_selector_*`) in `en.json` + `es.json`.
7. **Tests** — repo method, list API route (200/401, scoping), web page (selector + all states + empty CTA).

## Out of scope

- WebSocket / polling on the `/plan` tab (the tab is a snapshot; live tracking stays at `/plan/[id]`).
- Regenerate CTA on this tab (link to `/plan/[id]` where it already lives).
- Pagination or history of past plans.
- Any changes to nginx or deployment configuration.

## Constraints

- Browser never calls the API directly — server action only (same pattern as `getPlanStatusAction`).
- Reuse `PlanStatusView` for all three plan-state renderings.
- i18n for all new user-facing strings.
- NodeNext `.js` extension on API imports; web imports extensionless.
