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

> Note: although 09c is now frontend-only, the line count is unchanged from the prior estimate
> (the dropped work was hypothetical API tasks that were never in the task list — all tasks were
> already web-only). The CSS module + two new components + their test suites still exceed 400
> lines, so chaining is still recommended. The chaining is purely a reviewer-load split within
> the web app; both slices are frontend.

### Recommended slicing (2 chained PRs)

- **PR #1 — Components + CSS (~425 lines)**: T1–T3 (PlanWeekView with summary strip + helpers,
  DayDetailPanel, CSS module, i18n keys, component unit tests). Self-contained; the page still
  uses `PlanStatusView` for ready state until PR #2 is merged. Components reviewed in isolation.
- **PR #2 — Page wire-up + integration tests (~124 lines)**: T4–T5 (update `page.tsx` to use
  `PlanWeekView`, extend `page.test.tsx`, verify all 09b states still pass). Targets PR #1.

If the delivery strategy resolves to `single-pr` or an explicit `size:exception`, the work
may ship as one PR; otherwise apply the chained slices above.

## Tasks

- [x] T1: `PlanWeekView` server component + `LimitationWarningBanner`  _(PR #1)_
  - File: `apps/web/src/app/(app)/plan/PlanWeekView.tsx`
  - Pure server component (no `"use client"`); receives `program: WorkoutProgram` and
    `messages: Record<string, string>`
  - Co-located constant `EXECUTION_OVERHEAD_SECONDS = 30` (documented estimate)
  - Co-located helper `estimateSessionMinutes(exercises)`:
    `ceil( sum( e.sets × (e.restSeconds + EXECUTION_OVERHEAD_SECONDS) ) / 60 )`
  - Co-located helper `restDays(weeklySessions)`: `max(0, 7 − weeklySessions.length)`
  - Derives and renders all 4 summary tiles:
    - **Sesiones** = `weeklySessions.length`
    - **Días de descanso** = `restDays(weeklySessions)` (derived, no API change)
    - **Duración estimada** = sum of `estimateSessionMinutes` across sessions (in minutes)
    - **Volumen objetivo** = inert "—" placeholder (deferred to 09a; labeled as such)
  - Renders `<LimitationWarningBanner>` above grid when `limitationWarnings.length > 0`
  - Renders `<DayDetailPanel sessions={program.weeklySessions} messages={messages} />`
  - Test file: `apps/web/src/app/(app)/plan/__tests__/PlanWeekView.test.tsx`
    - SC-01: session count tile shows correct number
    - SC-02: rest-days tile shows `7 − N` (e.g. 5 sessions → "2")
    - SC-03: estimated duration tile shows the formula's value (incl. 30s/set overhead)
    - SC-04: volume tile renders "—" placeholder (no real value, no weight)
    - SC-16: limitation banner renders when `limitationWarnings` has entries
    - SC-17: limitation banner is absent when `limitationWarnings` is empty
    - SC-06: DayDetailPanel receives `sessions` with correct length
  - Conventional commit: `feat(web): PlanWeekView server component + 4-tile summary strip`

- [x] T2: `DayDetailPanel` client island  _(PR #1)_
  - File: `apps/web/src/app/(app)/plan/DayDetailPanel.tsx`
  - `"use client"` directive; receives `sessions: WorkoutSession[]` and `messages`
  - Local state: `selectedDay: number | null` (null = no panel open)
  - Renders day-card grid: one card per session labeled "Día {session.day}" (i18n:
    `plan_day_label`), shows `session.title`, exercise count (`plan_exercises_count`),
    estimated duration (`plan_est_duration`); cards have `role="button"`, `tabIndex={0}`,
    `aria-expanded`, keyboard handler for Enter/Space
  - Clicking an open card closes it (toggle); clicking another card closes the first and
    opens the new one (mutual exclusion)
  - Renders detail panel below the grid for `selectedDay`:
    - Header: "Día {N}" eyebrow + `session.title` h2 + "{N} ejercicios · {M} min" metadata
    - Exercise table: 4 columns (Ejercicio · Series · Reps · Descanso); NO Peso column;
      NO "Empezar sesión" CTA; rest shown as chip with clock icon + "{N} s"
    - Notes and substitutionNote as muted sub-lines under exercise name
    - Close button that sets `selectedDay = null`
  - Test file: `apps/web/src/app/(app)/plan/__tests__/DayDetailPanel.test.tsx`
    - SC-06: correct number of day-cards rendered
    - SC-07: each card shows day label, title, exercise count, est. duration
    - SC-08: cards have `role="button"` and `tabIndex={0}`
    - SC-09: clicking a card opens its detail panel
    - SC-10: clicking the close button collapses the panel; clicking the open card again collapses it
    - SC-12: detail panel shows 4-column table (no Peso); no "Empezar" CTA
    - SC-13: rest chip renders `{restSeconds} s`; notes and substitutionNote visible when present
    - SC-23: Peso column heading is not in the DOM
  - Conventional commit: `feat(web): DayDetailPanel client island — day-grid + exercise detail`

- [x] T3: CSS module + i18n keys  _(PR #1)_
  - File: `apps/web/src/app/(app)/plan/plan-week-view.module.css`
  - Summary strip: flex row, border, `--r-card`, dividers between tiles, responsive wrap
  - Day-card: CSS Grid (auto-fill, responsive columns: `repeat(auto-fill, minmax(180px, 1fr))`),
    card shape using `--surface`/`--border`/`--r-card`, hover using `--surface-2`,
    active-day border uses `--accent`
  - Detail panel: `--surface` background, `--border`, `--r-card`, display none / display block
    toggled via a `.open` CSS class (controlled by the client island)
  - Rest chip: `--surface-2` background, `--border`, `--r-pill` radius, `--muted` text
  - Limitation banner: `--warning` border-left, `--surface` background
  - Files: `apps/web/src/i18n/messages/en.json` and `es.json` — add keys:
    - `plan_day_label`: "Day {n}" / "Día {n}"  (component interpolates the number)
    - `plan_exercises_count`: "exercises" / "ejercicios"  (component prepends the count)
    - `plan_est_duration`: "est. {n} min" / "est. {n} min"
    - `plan_summary_sessions`: "Planned sessions" / "Sesiones planificadas"
    - `plan_summary_sessions_sub`: "training days" / "días de entrenamiento"
    - `plan_summary_rest`: "Rest days" / "Días de descanso"
    - `plan_summary_rest_sub`: "per week" / "por semana"
    - `plan_summary_duration`: "Estimated duration" / "Duración estimada"
    - `plan_summary_duration_sub`: "per week (est.)" / "por semana (est.)"
    - `plan_summary_volume`: "Target volume" / "Volumen objetivo"
    - `plan_summary_volume_sub`: "coming soon" / "próximamente"
    - `plan_summary_volume_placeholder`: "—" / "—"
    - `plan_table_exercise`: "Exercise" / "Ejercicio"
    - `plan_table_sets`: "Sets" / "Series"
    - `plan_table_reps`: "Reps" / "Reps"
    - `plan_table_rest`: "Rest" / "Descanso"
    - `plan_limitation_title`: "Important note" / "Nota importante"
    - `plan_day_detail_close`: "Close" / "Cerrar"
  - Conventional commit: `feat(web): plan-week-view CSS module + i18n keys`

- [x] T4: Wire `PlanWeekView` into `/plan/page.tsx`  _(PR #2)_
  - File: `apps/web/src/app/(app)/plan/page.tsx`
  - In the `status === "ready"` branch, replace:
    ```tsx
    <PlanStatusView status="ready" program={…} planId={…} specId={…} messages={…} />
    ```
    with:
    ```tsx
    <PlanWeekView program={plan.program as WorkoutProgram} messages={messages} />
    ```
  - `PlanSelector` and all other branches (failed, generating, empty) remain unchanged
  - Remove the `PlanStatusView` import if it is no longer referenced (check: it may still be
    used for the failed branch — if so, keep the import)
  - Conventional commit: `feat(web): /plan page — use PlanWeekView for ready state`

- [x] T5: Extend page tests + verify 09b states  _(PR #2)_
  - File: `apps/web/src/app/(app)/plan/__tests__/page.test.tsx` (extend existing)
  - Add test: ready plan renders `PlanWeekView` (assert by querying a summary-strip element
    or a day-card element); does NOT render the old "Your plan is ready" heading
  - Verify: generating → redirect (unchanged); failed → link to `/plan/[id]` (unchanged);
    empty → `/create-plan` CTA (unchanged); selector present with >1 plan (unchanged)
  - Conventional commit: `test(web): verify PlanWeekView wired into /plan ready state`

## Deferred to 09a (Execution)

The following elements from the `web-plan.html` mockup are NOT built in 09c. The `DayDetailPanel`
layout is intentionally designed with placeholder column slots so 09a can add them without
restructuring the component:

- **"Peso" column** — `WorkoutExercise` has no weight field. The table has 4 columns in 09c
  (Ejercicio · Series · Reps · Descanso). 09a adds a 5th column between Reps and Descanso
  when weight data is available.
- **Completion check-marks / done state** — day-cards have no check circle in 09c.
  09a adds `status: "done" | "pending"` per session from execution tracking.
- **"Today" highlighting** — no calendar anchor in 09c. 09a receives the current training
  day from execution context and applies the `active-day` CSS class.
- **"Empezar sesión de hoy" CTA** — workout start button is absent in 09c. 09a adds it
  to the detail panel for the current/upcoming session.
- **Week navigation (prev/next week buttons)** — absent in 09c; requires a date-anchored
  week model from 09a execution tracking.
- **"Volumen objetivo" tile VALUE** — the tile is rendered in 09c (keeps the 4-cell layout)
  but shows an inert "—" placeholder. The real value requires weight × reps per set and is
  computed in 09a. Only the value is deferred, not the tile.
- **"Today" dot indicator on day-cards** — `.dc-today-indicator` dot from the mockup;
  deferred to 09a calendar integration.
