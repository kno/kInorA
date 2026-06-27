# Exploration: 07-v1-plan-wizard

## Scope source

The capability is pre-specified in `openspec/specs/07-v1-plan-wizard/spec.md`: a card-based
create-plan wizard with sequential steps (goal, frequency, duration, equipment, limitations),
back-navigation that preserves state, Open Design card alignment, a typed `PlanSpec` output
(including limitations with `isWarning: true` and preference scores), and partial-exit resume.

## Current state

- **Create-plan surface** (`apps/web/src/app/(app)/create-plan/page.tsx`): pure 17-line scaffold
  (`kin-page` wrapper + `kin-card` placeholder). All other `(app)` pages (`plan`, `profile`,
  `stats`, `exercises`) follow the same scaffold pattern. The `(app)` layout wraps authenticated
  pages in `AppShell` (client component, switches `SidebarNav`/`MobileNav` at 768px).
- **PlanSpec exists but is incomplete** (`packages/contracts/src/index.ts:19-27`): has
  `goal`, `daysPerWeek`, `sessionDurationMinutes`, `location`, `equipment`,
  `limitations: string[]`, `confirmed`. Missing the spec's `isWarning` limitation structure and
  `preferenceScores`. `packages/domain/src/plan/plan-draft.ts` defines `PlanDraft extends PlanSpec`.
  `apps/api/src/plan/boundary.ts` has `assertPlanSpecShape()` validating the current flat shape.
- **No `plans`/`plan_drafts` table** in `apps/api/src/db/schema.ts` (only tenants, users,
  memberships, credentials, oauth_accounts, sessions). Two migrations exist (0000, 0001).
- **API route pattern**: `authPlugin` provides `requireAuth()` preHandler and
  `extractTenantQueryContext()`. No production protected-resource route exists yet — the plan
  route will establish this pattern for all future resource routes (09, 10, ...).
- **Web → API**: server actions call a pure orchestrator (e.g. `submitLogin.ts`) using `fetch`
  with `Authorization: Bearer <token>` against `API_BASE_URL`; the token is read server-side from
  the `kinora_session` httpOnly cookie.
- **Open Design**: `docs/open-design/kinora/screens/web-create-plan.html` shows two desktop modes
  (conversational "Asistente" and an all-visible stacked "Formulario" with sticky summary — NOT a
  stepper). `docs/open-design/kinora/screens/mobile-create-plan.html` is a genuine step-by-step
  stepper (one question per screen, progress bar/dots, Continue/Back bar).
- **Orbit foundation (06c)**: `OrbitCard`, `OrbitCtaSurface`, `OrbitSectionHeader`,
  `OrbitEmptyState`, `OrbitNavAffordance`, `OrbitMetricBlock` plus CSS tokens are available. The
  selectable option cards (`.option-card`, `.obj-card`) are NOT yet in the Orbit library — a new
  `OrbitSelectableCard` primitive is needed.
- **08 dependency** (`openspec/specs/08-v1-ai-plan-generation/spec.md`): consumes `PlanSpec`
  fields (`goal`, `equipment`, `limitations` as warning context). Changing `limitations` from
  `string[]` to an object array is a compile-time breaking change 08 must accommodate.
- **Testing**: Vitest across workspaces (Strict TDD; coverage 80%, web functions 90%). Full-stack
  authenticated E2E harness exists (`scripts/e2e-with-stack.mjs`).

## Key decisions for the proposal

### PlanSpec contract extension — recommend break-in-place (Approach A)
Change `limitations: string[]` → `{ text: string; isWarning: boolean }[]` and add
`preferenceScores`. The monorepo makes this a bounded, compile-time-safe change (`tsc` catches all
consumers, including 08's `boundary.ts`). Must be applied atomically. Alternatives (additive
optional field; separate WizardSpec converted at submission) leave permanent cruft or lose
`isWarning` at the API boundary.

### Wizard state / partial-exit resume — recommend server-persisted draft (Approach B)
The spec requires resuming at the exact step after exit, which demands durable persistence.
Proposed `plan_drafts` table: `(id UUID PK, tenant_id, user_id, step int, spec_json jsonb,
updated_at)` with one active draft per user per tenant. On "Finish", promote into a `plans` table
with `confirmed = true`. Client-only/sessionStorage/cookie approaches fail the cross-session resume
requirement.

### Desktop layout — recommend true stepper on all viewports
The spec ("sequential wizard steps", back-nav, partial-exit resume) takes precedence over the OD
desktop "Formulario" all-visible form. The mobile OD stepper screens are the authoritative
reference.

## Affected areas

| File/Path | Why |
|---|---|
| `packages/contracts/src/index.ts` (+ contract test) | Extend PlanSpec: limitations type + preferenceScores |
| `packages/domain/src/plan/plan-draft.ts` (+ tests) | Inherits PlanSpec; fixtures |
| `apps/api/src/plan/boundary.ts` | Update `assertPlanSpecShape` |
| `apps/api/src/db/schema.ts` (+ new migration) | Add `plan_drafts`, `plans` tables |
| `apps/api/src/db/repositories/` (+ tests) | New `PlanDraftRepository`, `PlanRepository` |
| `apps/api/src/routes/plan.ts` (new, + tests) | `POST /plans/drafts`, `GET /plans/drafts/current`, `POST /plans` |
| `apps/api/src/app.ts` | Register `planRoutes` |
| `apps/web/src/app/(app)/create-plan/page.tsx` (+ tests) | Replace scaffold with wizard shell |
| `apps/web/src/components/orbit/OrbitSelectableCard.tsx` (new, + tests) | Selectable option card primitive |
| `apps/web/src/components/wizard/` (new) | GoalStep, FrequencyStep, DurationStep, EquipmentStep, LimitationsStep |

## Open questions for the proposal

1. **`preferenceScores` shape** (highest risk): keys + value ranges; derived from answers or
   user-entered? Design stalls until this is defined.
2. **`isWarning` default**: default `true` for all user-entered limitations (never diagnoses) vs
   collected explicitly?
3. **Desktop UX**: confirm true stepper on all viewports vs dual layout (drives component count).
4. **Drafts**: one active draft per user per tenant (recommended) vs multiple.
5. **Draft TTL/cleanup**: purge policy (may defer to a later change).
6. **`OrbitSelectableCard` placement**: Orbit-level reusable (recommended; 08 may reuse) vs
   wizard-local.

## Suggested delivery (chained PRs to stay under ~400 lines)

- **PR 1 — Contract + Domain**: extend PlanSpec, update fixtures, update `assertPlanSpecShape`.
- **PR 2 — API**: `plan_drafts`/`plans` tables + migration, repositories, `planRoutes`
  (auth-protected, tenant-scoped), route + repo tests.
- **PR 3 — Web wizard**: stepper, `OrbitSelectableCard`, 5 step components, draft server actions,
  Vitest coverage.

## Risks

- PlanSpec change is a monorepo-bounded compile-time break — coordinate atomically with 08's
  `boundary.ts`.
- Undefined `preferenceScores` is the single highest-risk open question.
- The plan routes establish the first protected resource-route pattern (auth + tenant scoping +
  repository) reused by 09/10 — must be correct.
- PR size risk is HIGH; chained PRs strongly recommended.
- OD desktop reference (all-visible form) conflicts with the spec's sequential-stepper requirement;
  the proposal must record that the spec wins.
