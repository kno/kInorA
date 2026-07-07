# Tasks: Plan Navigation and Start (Issue #93)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~800–1100 total (Slice 1 ~250, Slice 2 ~300, Slice 3 ~300) |
| 400-line budget risk | High (each slice is near or under 400; total well exceeds it) |
| Chained PRs recommended | Yes |
| Suggested split | Slice 1 (`feat/93-data-model`) → Slice 2 (`feat/93-plan-name`) → Slice 3 (`feat/93-start-cta`) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before applying: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Per-Slice Review Workload

| Slice | Est. lines | Budget risk | Note |
|-------|-----------|-------------|------|
| 1 — Data model | ~200–250 | Low | Schema + contracts + domain helper + repo logic; mostly additive |
| 2 — Plan name UX | ~280–330 | Medium | API adapters + web wizard + PlanSelector + i18n; 3-4 route files |
| 3 — Start CTA | ~260–310 | Medium | New PlanTrackerClient + DayDetailPanel CTA + action result + conflict banner + e2e |

Each slice fits within the 400-line budget on its own. No further splitting required.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | DB schema + contracts + repo core | PR 1 → main | Unblocking foundation; suite must stay green |
| 2 | Plan name end-to-end + i18n | PR 2 → main | Depends on PR 1 merged |
| 3 | Start CTA + scoped session + conflict | PR 3 → main | Depends on PR 1+2 merged |

---

## Slice 1 — Data Model (`feat/93-data-model`)

> Goal: DB columns + contracts DTOs + domain helper + repo 3-branch logic + all callers green. No UI.

### Phase 1.1: Schema & Migration

- [x] 1.1.1 [RED] Write a Drizzle schema test asserting `workoutPlans.name` and `workoutSessions.day` columns exist on the table definitions.
- [x] 1.1.2 [GREEN] Modify `apps/api/src/db/schema.ts`: add `name: varchar("name", { length: 120 })` to `workoutPlans`; add `day: smallint("day")` to `workoutSessions`.
- [x] 1.1.3 Run `pnpm drizzle-kit generate` from `apps/api/` — confirm a new additive migration file is created in `apps/api/drizzle/`.
- [x] 1.1.4 Verify migration file contains only `ALTER TABLE … ADD COLUMN` statements (no DROP, no data backfill).

### Phase 1.2: Contracts Package

- [x] 1.2.1 [RED] Write unit tests in `packages/contracts/` asserting `WorkoutSessionRecord.day` is optional `number`, `StartSessionOutcome` discriminated union exists, `WorkoutPlanSummary.name` and `WorkoutPlanDetail.name` are optional strings.
- [x] 1.2.2 [GREEN] Modify `packages/contracts/src/index.ts`: add `day?: number` to `WorkoutSessionRecord`; add `StartSessionOutcome` union type (`started | resumed | conflict`); add `name?: string` to `WorkoutPlanSummary`; add/extend `WorkoutPlanDetail` with `name?: string`.

### Phase 1.3: Domain Helper

- [x] 1.3.1 [RED] Write unit tests for `defaultPlanName` in `packages/domain/src/plan/` covering: null input → non-empty string; empty string → non-empty string; non-blank string → passthrough.
- [x] 1.3.2 [GREEN] Create `packages/domain/src/plan/default-plan-name.ts` implementing `defaultPlanName(name: string | null | undefined, createdAt: Date | string): string` (date-based fallback).
- [x] 1.3.3 Re-export `defaultPlanName` from `packages/domain/src/index.ts` (and the `plan/` subpath barrel).

### Phase 1.4: Repo — Session 3-Branch Logic (breaking change — contained in this slice)

- [x] 1.4.1 [RED] Write/extend `apps/api/src/db/repositories/__tests__/workout-session.test.ts`:
  - Branch A: active session matches `(planId, day)` → returns `{ kind: "resumed", session }`.
  - Branch B: active session mismatches `(planId, day)` → returns `{ kind: "conflict", activePlanId, activeDay }`.
  - Branch B (null-day legacy): active session has `day = null` → conflict, never resume.
  - Branch C: no active session → returns `{ kind: "started", session }` with `day` persisted.
  - Multi-week: no active row (prior completed) for same `(planId, day)` → new row created.
- [x] 1.4.2 [GREEN] Modify `apps/api/src/db/repositories/workout-session.ts`:
  - `startSession` signature unchanged externally (`tenantId, userId, planId, day`), return type → `StartSessionOutcome`.
  - Implement 3-branch logic (fetch active row, compare `planId` + `day`, branch accordingly).
  - `mapWorkoutSessionRecord` includes `day` field.
  - `findById` return type includes `day` (via `select()` all-columns + `WorkoutSessionRow.day`).
- [x] 1.4.3 Modify `apps/api/src/routes/workout-session.ts`: map `StartSessionOutcome.conflict` → HTTP 409 `{ error: "active_session_conflict", activePlanName, activeDay }`; keep `started`/`resumed` → 200.
- [x] 1.4.4 `apps/api/src/app.ts` (composition root): `WorkoutSessionRepository` is passed directly as the route repo; its `startSession` now returns `StartSessionOutcome | undefined` matching the port exactly — no adapter change and no throw on conflict. Verified via `tsc --noEmit` clean.
- [x] 1.4.5 Only caller of the repo's `startSession` was the route (1.4.3). Web `/plan/[id]` consumes the HTTP shape, not the repo TS type — untouched, `apps/web` `tsc` clean.
- [x] 1.4.6 api suite green (`npx vitest run` → 544 passed); apps/api + apps/web `tsc --noEmit` clean.

---

## Slice 2 — Plan Name UX (`feat/93-plan-name`)

> Goal: Plan name flows wizard → DB → API list/detail → PlanSelector + header. i18n EN+ES. Targets `main` after Slice 1 merges.

### Phase 2.1: API — Plan Repo + Adapters

- [ ] 2.1.1 [RED] Write/extend `apps/api/src/db/repositories/__tests__/workout-plan.test.ts`: `findAllByUser` projection includes `name`; null `name` row returns non-null `name` after adapter.
- [ ] 2.1.2 [GREEN] Modify `apps/api/src/db/repositories/workout-plan.ts`: add `name: workoutPlans.name` to `findAllByUser` `.select({…})` projection; `WorkoutPlanSummary` (repo) gains `name?: string | null`.
- [ ] 2.1.3 Modify `apps/api/src/app.ts`: in `findAllPlansByUser` adapter map `name: defaultPlanName(row.name, row.createdAt)`; in `findPlanById` adapter do the same (single default layer).
- [ ] 2.1.4 [RED] Write/extend `apps/api/src/routes/__tests__/plan.test.ts`: `GET /workout-plans` response items include `name`; `GET /workout-plans/:id` response includes `name`; `GET /plan-specs/:id/workout-plan` response includes `name`.
- [ ] 2.1.5 [GREEN] Modify `apps/api/src/routes/plan.ts`: inline `PlanRecord.name?` + `PlanSummary.name`; map `name` into all three route response shapes.

### Phase 2.2: Web — Types + Wizard

- [ ] 2.2.1 Modify `apps/web/src/app/(app)/create-plan/plan-draft-client.ts`: add `name?` to `PlanSummary` and `PlanStatusResponse`; `FetchPlanResult.plan` carries `name`.
- [ ] 2.2.2 [RED] Write wizard test asserting optional name field renders, blank submission advances without error, non-blank value is included in the submitted `PlanSpec`.
- [ ] 2.2.3 [GREEN] Modify wizard components under `apps/web/src/app/(app)/create-plan/` to add an optional name input step/field; pipe value into `PlanSpec`/draft output. Blank → `null` (server resolves via `defaultPlanName`).

### Phase 2.3: Web — UI Display

- [ ] 2.3.1 [RED] Write unit test for `PlanSelector`: two plans with distinct names render distinct labels; null-name plan renders auto-default (plan.name already resolved server-side).
- [ ] 2.3.2 [GREEN] Modify `apps/web/src/app/(app)/plan/PlanSelector.tsx`: use `plan.name` as primary option label.
- [ ] 2.3.3 [RED] Write unit test for plan header in `PlanWeekView` or `plan/page.tsx`: renders `plan.name`.
- [ ] 2.3.4 [GREEN] Modify `apps/web/src/app/(app)/plan/PlanWeekView.tsx` (or `plan/page.tsx`) to display plan name in header area.

### Phase 2.4: i18n

- [ ] 2.4.1 Add keys to `apps/web/src/i18n/en.json`: `plan_name_field_label`, `plan_name_placeholder`, `plan_name_default`.
- [ ] 2.4.2 Add same keys to `apps/web/src/i18n/es.json` with Spanish translations.
- [ ] 2.4.3 Replace any inline strings in wizard name field and plan selector label with i18n calls.
- [ ] 2.4.4 Run `pnpm test` — suite MUST be green.

---

## Slice 3 — Start CTA + Scoped Session (`feat/93-start-cta`)

> Goal: Per-day CTA in DayDetailPanel; PlanTrackerClient state-swap on /plan; startWorkoutSessionAction returns result; conflict banner; e2e. Targets `main` after Slices 1+2 merge.

### Phase 3.1: Server Action — Stop Throwing on Conflict

- [ ] 3.1.1 [RED] Write/extend test for `apps/web/src/app/(app)/plan/[id]/actions.ts`: `startWorkoutSessionAction` with a 409 response returns a result object (not throws); 200 returns session; 404 returns error result.
- [ ] 3.1.2 [GREEN] Modify `apps/web/src/app/(app)/plan/[id]/actions.ts`: `startWorkoutSessionAction` catches 409 from `tracker-client.ts` and returns `{ kind: "conflict", activePlanName, activeDay }` instead of throwing.
- [ ] 3.1.3 Modify `apps/web/src/app/(app)/plan/[id]/tracker-client.ts`: surface 409 payload fields (`activePlanName`, `activeDay`) in the error shape returned to the server action.

### Phase 3.2: PlanTrackerClient (new component)

- [ ] 3.2.1 [RED] Write unit test for `PlanTrackerClient`: initial state renders `DayDetailPanel` normally; after `startWorkoutSessionAction` returns `{ kind: "started" | "resumed" }` it renders `TrackerPanel`; after conflict result it renders conflict banner inside `DayDetailPanel`.
- [ ] 3.2.2 [GREEN] Create `apps/web/src/app/(app)/plan/PlanTrackerClient.tsx` as a `"use client"` wrapper:
  - Props: `program`, `planId`, `messages`, `planName`.
  - State: `activeSession | null`, `conflict | null`.
  - Renders `DayDetailPanel` with `onStartWorkout(day)` and `conflict` props; swaps to `TrackerPanel` when `activeSession` is set.
  - Calls `startWorkoutSessionAction(planId, day)` and dispatches to state.

### Phase 3.3: DayDetailPanel — CTA + Conflict Banner

- [ ] 3.3.1 [RED] Extend `DayDetailPanel` tests: CTA button rendered when `onStartWorkout` prop present + plan is `ready`; conflict banner rendered with localized text when `conflict` prop is set; CTA absent when plan not `ready`.
- [ ] 3.3.2 [GREEN] Modify `apps/web/src/app/(app)/plan/_components/DayDetailPanel.tsx`:
  - Add `onStartWorkout?: (day: number) => void` prop.
  - Add `conflict?: { activePlanName?: string; activeDay: number | null }` prop.
  - Render "Empezar sesión" button (calls `onStartWorkout(day)`) when `onStartWorkout` is provided and plan is `ready`.
  - Render conflict banner ("Tienes una sesión activa para {plan} · Día {n}") when `conflict` is set.
  - Remove deferred start-CTA marker (`:174`).

### Phase 3.4: Wire PlanWeekView + plan/page.tsx

- [ ] 3.4.1 Modify `apps/web/src/app/(app)/plan/PlanWeekView.tsx`: wrap inner content in `PlanTrackerClient`, passing `program`, `planId`, `messages`, `planName`.
- [ ] 3.4.2 Modify `apps/web/src/app/(app)/plan/page.tsx`: thread `planId` (from search params / active plan) and `plan.name` through to `PlanWeekView`/`PlanTrackerClient`.

### Phase 3.5: i18n

- [ ] 3.5.1 Add keys to `apps/web/src/i18n/en.json`: `plan_day_start_cta` ("Start session"), `plan_start_conflict` ("You have an active session for {plan} · Day {n}").
- [ ] 3.5.2 Add same keys to `apps/web/src/i18n/es.json`: `plan_day_start_cta` ("Empezar sesión"), `plan_start_conflict` ("Tienes una sesión activa para {plan} · Día {n}").
- [ ] 3.5.3 Replace any inline strings in `DayDetailPanel` CTA and conflict banner with i18n calls.

### Phase 3.6: Verification

- [ ] 3.6.1 Write e2e test (Playwright or Vitest integration): multi-plan user navigates Plan tab → selects day N of plan A → clicks "Empezar sesión" → tracker opens for `(planA, dayN)` without misroute.
- [ ] 3.6.2 Write e2e / integration test: user has active session for `(planA, day1)`, triggers start for `(planA, day2)` → conflict banner appears, no second active session in DB.
- [ ] 3.6.3 Run `pnpm architecture` — verify no `routes/**→db/**` direct imports.
- [ ] 3.6.4 Run `pnpm test` — full suite green.
