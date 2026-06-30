# Tasks: 09c-plan-view-design

## Review Workload Forecast

Estimated lines changed:
- `PlanWeekView.tsx` (new server component): ~80 lines
- `DayDetailPanel.tsx` (new client island): ~110 lines
- `plan-week-view.module.css` (new CSS module): ~120 lines
- `plan/page.tsx` (modify ready branch): ~10 lines net change
- `__tests__/PlanWeekView.test.tsx` (new): ~70 lines
- `__tests__/DayDetailPanel.test.tsx` (new): ~90 lines
- `__tests__/page.test.tsx` (extend existing): ~20 lines (assert PlanWeekView rendered)
- `en.json` + `es.json`: ~12 lines each (24 total)

**Total estimated: ~524 lines** (additions + deletions combined)

Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High (~524 lines estimated — exceeds the 400-line budget)

### Recommended slicing (2 chained PRs)

- **PR #1 — Components + CSS (~400 lines)**: T1–T3 (PlanWeekView, DayDetailPanel, CSS module,
  i18n keys, component unit tests). Self-contained; the page still uses `PlanStatusView` for
  ready state until PR #2 is merged. Components can be reviewed in isolation.
- **PR #2 — Page wire-up + integration tests (~124 lines)**: T4–T5 (update `page.tsx` to use
  `PlanWeekView`, extend `page.test.tsx`, verify all 09b states still pass). Targets PR #1.

If the delivery strategy resolves to `single-pr` or an explicit `size:exception`, the work
may ship as one PR; otherwise apply the chained slices above.

## Tasks

- [ ] T1: `PlanWeekView` server component + `LimitationWarningBanner`  _(PR #1)_
  - File: `apps/web/src/app/(app)/plan/PlanWeekView.tsx`
  - Pure server component (no `"use client"`); receives `program: WorkoutProgram` and
    `messages: Record<string, string>`
  - Derives summary tiles: session count, estimated duration (using `estimateSessionMinutes`
    co-located helper: `sum(exercise.sets × exercise.restSeconds)` per session → `ceil(totalRest / 60)`)
  - Renders summary strip (only sessions + duration tiles; omits rest-days and volume)
  - Renders `<LimitationWarningBanner>` above grid when `limitationWarnings.length > 0`
  - Renders `<DayDetailPanel sessions={program.weeklySessions} messages={messages} />`
  - Test file: `apps/web/src/app/(app)/plan/__tests__/PlanWeekView.test.tsx`
    - SC-01: session count tile shows correct number
    - SC-02: estimated duration tile is present when exercises have restSeconds > 0
    - SC-03: rest-days and volume tiles are absent from the DOM
    - SC-15: limitation banner renders when `limitationWarnings` has entries
    - SC-16: limitation banner is absent when `limitationWarnings` is empty
    - SC-05: DayDetailPanel receives `sessions` with correct length
  - Conventional commit: `feat(web): PlanWeekView server component + summary strip`

- [ ] T2: `DayDetailPanel` client island  _(PR #1)_
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
    - SC-05: correct number of day-cards rendered
    - SC-06: each card shows day label, title, exercise count
    - SC-07: cards have `role="button"` and `tabIndex={0}`
    - SC-08: clicking a card opens its detail panel
    - SC-09: clicking the close button collapses the panel; clicking the open card again collapses it
    - SC-11: detail panel shows 4-column table (no Peso); no "Empezar" CTA
    - SC-12: rest chip renders `{restSeconds} s`; notes and substitutionNote visible when present
    - SC-22: Peso column heading is not in the DOM
  - Conventional commit: `feat(web): DayDetailPanel client island — day-grid + exercise detail`

- [ ] T3: CSS module + i18n keys  _(PR #1)_
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
    - `plan_summary_duration`: "Estimated duration" / "Duración estimada"
    - `plan_summary_duration_sub`: "per week" / "por semana"
    - `plan_table_exercise`: "Exercise" / "Ejercicio"
    - `plan_table_sets`: "Sets" / "Series"
    - `plan_table_reps`: "Reps" / "Reps"
    - `plan_table_rest`: "Rest" / "Descanso"
    - `plan_limitation_title`: "Important note" / "Nota importante"
    - `plan_day_detail_close`: "Close" / "Cerrar"
  - Conventional commit: `feat(web): plan-week-view CSS module + i18n keys`

- [ ] T4: Wire `PlanWeekView` into `/plan/page.tsx`  _(PR #2)_
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

- [ ] T5: Extend page tests + verify 09b states  _(PR #2)_
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
- **"Volumen objetivo" summary tile** — requires weight × reps per set; deferred to 09a.
- **"Días de descanso" summary tile** — requires `daysPerWeek` or weekday mapping from
  `PlanSpec`; deferred until execution context is available.
- **"Today" dot indicator on day-cards** — `.dc-today-indicator` dot from the mockup;
  deferred to 09a calendar integration.
