# Tasks: 09c-plan-view-design

## Scope note — frontend-only

09c makes **NO API/backend change**. There is no `findAllByUser`, no new route, no DTO/repo
change, and no `daysPerWeek` field added. All four summary tiles and the day-grid derive from
the `program` already in the existing detail DTO `{ id, status, program, specId }`. Rest days =
`max(0, 7 − weeklySessions.length)` (08 invariant `weeklySessions.length === daysPerWeek`).
All tasks below touch only `apps/web`.

## Review Workload Forecast

Estimated lines changed:
- `PlanWeekView.tsx` (new server component, incl. duration + rest-day helpers): ~95 lines
- `DayDetailPanel.tsx` (new client island): ~110 lines
- `plan-week-view.module.css` (new CSS module): ~120 lines
- `plan/page.tsx` (modify ready branch): ~10 lines net change
- `__tests__/PlanWeekView.test.tsx` (new): ~80 lines
- `__tests__/DayDetailPanel.test.tsx` (new): ~90 lines
- `__tests__/page.test.tsx` (extend existing): ~20 lines (assert PlanWeekView rendered)
- `en.json` + `es.json`: ~12 lines each (24 total)

**Total estimated: ~549 lines** (additions + deletions combined)

Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High (~549 lines estimated — exceeds the 400-line budget)

### Recommended slicing (2 chained PRs)

- **PR #1 — Components + CSS (~425 lines)**: T1–T3 (PlanWeekView with summary strip + helpers,
  DayDetailPanel, CSS module, i18n keys, component unit tests). Self-contained; the page still
  uses `PlanStatusView` for ready state until PR #2 is merged.
- **PR #2 — Page wire-up + integration tests (~124 lines)**: T4–T5 (update `page.tsx` to use
  `PlanWeekView`, extend `page.test.tsx`, verify all 09b states still pass).

## Tasks

- [x] T1: `PlanWeekView` server component + `LimitationWarningBanner`  _(PR #1)_
  - File: `apps/web/src/app/(app)/plan/PlanWeekView.tsx`
  - Pure server component (no `"use client"`); receives `program: WorkoutProgram` and
    `messages: Record<string, string>`
  - Co-located constant `EXECUTION_OVERHEAD_SECONDS = 30` (documented estimate)
  - Co-located helper `estimateSessionMinutes(exercises)`:
    `ceil( sum( e.sets × (e.restSeconds + EXECUTION_OVERHEAD_SECONDS) ) / 60 )`
  - Co-located helper `restDays(weeklySessions)`: `max(0, 7 − weeklySessions.length)`
  - Derives and renders all 4 summary tiles
  - Renders `<LimitationWarningBanner>` above grid when `limitationWarnings.length > 0`
  - Renders `<DayDetailPanel sessions={program.weeklySessions} messages={messages} />`
  - Test file: `apps/web/src/app/(app)/plan/__tests__/PlanWeekView.test.tsx`
    - SC-01 through SC-04, SC-16, SC-17, SC-06
  - Conventional commit: `feat(web): PlanWeekView server component + 4-tile summary strip`

- [x] T2: `DayDetailPanel` client island  _(PR #1)_
  - File: `apps/web/src/app/(app)/plan/DayDetailPanel.tsx`
  - `"use client"` directive; receives `sessions: WorkoutSession[]` and `messages`
  - Local state: `selectedDay: number | null`
  - Renders day-card grid + detail panel
  - Test file: `apps/web/src/app/(app)/plan/__tests__/DayDetailPanel.test.tsx`
    - SC-06 through SC-10, SC-12, SC-13, SC-23
  - Conventional commit: `feat(web): DayDetailPanel client island — day-grid + exercise detail`

- [x] T3: CSS module + i18n keys  _(PR #1)_
  - File: `apps/web/src/app/(app)/plan/plan-week-view.module.css`
  - Files: `apps/web/src/i18n/messages/en.json` and `es.json`
  - Keys: `plan_day_label`, `plan_exercises_count`, `plan_est_duration`,
    `plan_summary_sessions`, `plan_summary_sessions_sub`, `plan_summary_rest`,
    `plan_summary_rest_sub`, `plan_summary_duration`, `plan_summary_duration_sub`,
    `plan_summary_volume`, `plan_summary_volume_sub`, `plan_summary_volume_placeholder`,
    `plan_table_exercise`, `plan_table_sets`, `plan_table_reps`, `plan_table_rest`,
    `plan_limitation_title`, `plan_day_detail_close`
  - Conventional commit: `feat(web): plan-week-view CSS module + i18n keys`

- [x] T4: Wire `PlanWeekView` into `/plan/page.tsx`  _(PR #2)_
  - File: `apps/web/src/app/(app)/plan/page.tsx`
  - In `status === "ready"` branch, replace `<PlanStatusView status="ready" …/>` with
    `<PlanWeekView program={plan.program as WorkoutProgram} messages={messages} />`
  - All other branches unchanged
  - Conventional commit: `feat(web): /plan page — use PlanWeekView for ready state`

- [x] T5: Extend page tests + verify 09b states  _(PR #2)_
  - File: `apps/web/src/app/(app)/plan/__tests__/page.test.tsx` (extend existing)
  - Add test: ready plan renders `PlanWeekView`; does NOT render old "Your plan is ready" heading
  - Verify: all 09b states still pass
  - Conventional commit: `test(web): verify PlanWeekView wired into /plan ready state`

## Deferred to 09a (Execution)

- "Peso" column
- Completion check-marks / done state
- "Today" highlighting
- "Empezar sesión de hoy" CTA
- Week navigation prev/next buttons
- "Volumen objetivo" tile VALUE (tile renders with "—" placeholder in 09c)
- "Today" dot indicator on day-cards
