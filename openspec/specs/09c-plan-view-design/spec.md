# Spec: 09c-plan-view-design

## Scenarios

### Summary strip

The summary strip renders all four tiles from the mockup. Every value is derived from the
`program` already present in the detail DTO `{ id, status, program, specId }` — no API change.

SC-01: When a ready plan has N sessions, the "Sesiones planificadas" tile shows "N"
(`weeklySessions.length`).

SC-02: The "Días de descanso" tile shows `max(0, 7 − weeklySessions.length)`, derived from the
08 contract invariant `weeklySessions.length === daysPerWeek` on a 7-day week. No `daysPerWeek`
DTO field or API change is required.

SC-03: The "Duración estimada" tile shows a derived value: the sum of per-session durations,
where each session's duration is
`ceil( sum_over_exercises( sets × (restSeconds + EXECUTION_OVERHEAD_SECONDS) ) / 60 )` minutes,
with `EXECUTION_OVERHEAD_SECONDS = 30` (a named constant, documented as an estimate). The total
is the sum across all sessions, displayed in minutes.

SC-04: The "Volumen objetivo" tile renders an inert "—" placeholder, labeled as deferred (needs
per-set weight; arrives in 09a). It keeps the 4-cell layout faithful to the mockup but carries
no real value.

SC-05: The summary strip uses the design-token surface styles (border, `--surface`, `--r-card`)
from `globals.css`; no inline design-system overrides.

### Day-card grid

SC-06: The grid renders exactly N cards — one per `weeklySessions` entry. Cards are ordered by
`session.day` (ascending, 1-based).

SC-07: Each card shows:
  - Label "Día {session.day}" (i18n key `plan_day_label`).
  - The session title (`session.title`).
  - Exercise count: "{N} ejercicios" (i18n key `plan_exercises_count`).
  - Estimated duration in minutes (same per-session derivation as SC-03).
  - No completion check circle (deferred to 09a).
  - No "today" indicator (deferred to 09a).

SC-08: Day-cards are keyboard-accessible (`role="button"`, `tabIndex={0}`, Enter/Space triggers
expand).

SC-09: Clicking a card that is not already open opens the detail panel for that session and
collapses any other open panel.

SC-10: Clicking the currently-open card's close button (or the card itself as a toggle) collapses
the detail panel.

SC-11: The day-grid renders as a responsive CSS Grid; no fixed 7-column layout (deferred to 09a
when weekday mapping is available). On wide viewports ≥1100px: up to 4 columns; ≥768px: 3
columns; below: 2 columns.

### Detail panel

SC-12: The detail panel shows for the selected session:
  - Eyebrow: "Día {N}" label + session title.
  - Subtitle: "{N} ejercicios · {M} min" metadata.
  - Exercise table with columns: Ejercicio · Series · Reps · Descanso.
  - The "Peso" column is absent (deferred).
  - "Empezar sesión" CTA is present when the plan status is `ready`; it carries `(planId, day)` context and routes to the inline workout tracker. (Previously deferred to 09a; delivered in change 93.)

SC-13: Each exercise row shows:
  - `exercise.name` in the first column (full width, font-weight 500).
  - `exercise.sets` in the Series column (right-aligned, `--font-display`).
  - `exercise.reps` in the Reps column (right-aligned, `--font-display`).
  - `exercise.restSeconds` as a rest chip in the Descanso column (clock icon + "{N} s").
  - If `exercise.notes` is non-empty, it appears as a muted sub-line below the exercise name.
  - If `exercise.substitutionNote` is non-empty, it appears as a muted italic sub-line.

SC-14: The detail panel close button collapses the panel and deselects the card.

SC-15: `DayDetailPanel` is a `"use client"` component. It receives the full sessions array as
props. It manages `selectedDay: number | null` in local state. It never calls `fetch` or any
server action.

### Limitation warnings

SC-16: When `program.limitationWarnings` has one or more entries, a warning banner is rendered
above the day-grid. The banner uses `--warning` color and lists each warning as a separate
item.

SC-17: When `program.limitationWarnings` is empty, the warning banner is absent.

### Preserved states from 09b

SC-18: generating → redirect to `/plan/[id]` (unchanged).

SC-19: failed → `PlanStatusView` failed state + link to `/plan/[id]` (unchanged).

SC-20: empty / error → empty state card + `/create-plan` CTA, no selector (unchanged).

SC-21: Multi-plan selector (`PlanSelector`) renders when `summaries.length > 1` (unchanged).

### No browser → API

SC-22: No component in 09c (server or client) calls `API_BASE_URL` directly from the browser.
`DayDetailPanel` contains only local state and prop-derived rendering. 09c makes NO API/backend
change — the detail DTO `{ id, status, program, specId }` already carries everything needed.

### Deferred elements are explicitly absent

SC-23: The rendered HTML must NOT contain:
  - A "Peso" column or any weight value.
  - Check-mark icons for completion state.
  - A "today" CSS class or accent indicator tied to the current date.
  - Week navigation prev/next buttons tied to calendar dates.
  - A real "Volumen objetivo" value (the tile renders only an inert "—" placeholder).
  Note: the "Empezar sesión" CTA is NO LONGER absent — it is present for ready plans (see SC-12). (Previously SC-23 listed the start CTA as absent/deferred; removed in change 93.)

## Invariants

- The `PlanWeekView` component is a server component (no `"use client"` directive); it receives
  `program: WorkoutProgram` and `messages: Record<string, string>` as props and produces static
  HTML.
- The `DayDetailPanel` is a client island; it receives `sessions: WorkoutSession[]` and
  `messages` as props; it never fetches data.
- Design tokens are consumed from `globals.css` CSS custom properties (already applied to the
  document root). The new `plan-week-view.module.css` uses `var(--surface)`, `var(--accent)`,
  etc. without redefining them.
- Day labels use session numbers ("Día 1", "Día 2", …), not calendar weekday names.
- Rest-day cards are not rendered; only the N training session cards appear. (The rest-day
  COUNT is shown as a summary tile, but no synthetic rest-day cards are added to the grid.)
- Rest-day count is derived as `max(0, 7 − weeklySessions.length)` from the 08 contract
  invariant `weeklySessions.length === daysPerWeek`; no API change, no `daysPerWeek` DTO field.
- Estimated duration is a best-effort derivation:
  `ceil( sum_over_exercises( sets × (restSeconds + EXECUTION_OVERHEAD_SECONDS) ) / 60 )` per
  session, with `EXECUTION_OVERHEAD_SECONDS = 30` (named constant). The label carries no
  precision claim — it is presented as an estimate.
- The "Volumen objetivo" tile renders an inert "—" placeholder (deferred to 09a); the
  4-cell layout stays faithful to the mockup without inventing a value.
- 09c is FRONTEND-ONLY: no API route, repo method, or DTO change. All four summary tiles and
  the day-grid derive from the existing detail DTO `{ id, status, program, specId }`.
- `limitationWarnings` are always surfaced as a warning banner (never silently dropped).
- The 09b `PlanSelector` component is not modified.
- All new user-facing strings have i18n keys in `en.json` and `es.json`.
