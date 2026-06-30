# Proposal: 09b-plan-view

## Problem

The `/plan` nav tab is a placeholder. After a user generates a workout plan (change 08),
there is no screen reachable from the main navigation that displays it. The only existing
plan view (`/plan/[id]`) requires the user to already know a specific plan ID — it is
not discoverable from the nav.

## Solution

Replace the placeholder `/plan` page with a real server-rendered view that:
1. Fetches the user's latest workout plan via a new `GET /workout-plans/latest` API route
   (tenant + user scoped, no plan ID required).
2. Renders the appropriate state (ready / generating / failed / no plan) by reusing the
   existing `PlanStatusView` component — no new plan renderer.
3. Routes all data through Next.js server components / server actions (browser never
   calls the API directly — enforced by `ui-api-guard.mjs`).

## Scope

1. **API** — `WorkoutPlanRepository.findLatestByUser(tenantId, userId)` + route
   `GET /workout-plans/latest` returning `{ id, status, program?, specId? }` or 404.
2. **Web server action** — `getLatestPlanAction()` (`"use server"`, reads cookie, calls route).
3. **Web `/plan` page** — server component replacing the placeholder; renders four states:
   ready, generating, failed, no plan (empty state with `/create-plan` CTA).
4. **i18n** — new keys (`plan_nav_empty_*`) in `en.json` + `es.json`.
5. **Tests** — repo method, API route (200/401/404), web page (all four states + empty CTA).

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
