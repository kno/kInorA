# Spec: 09c-plan-view-design

## Scenarios

### Summary strip

SC-01: When a ready plan has N sessions, the summary strip shows "N" in the "Sesiones
planificadas" tile.

SC-02: The estimated duration tile shows a derived value (sum of `sets × restSeconds` per
session, converted to minutes and rounded). If the result is 0 or the program has no sessions,
the tile is absent.

SC-03: The "Días de descanso" tile is absent (no weekday mapping available in 09c). The
"Volumen objetivo" tile is absent (no weight field). The summary strip renders only the tiles
for which data exists.

SC-04: The summary strip uses the design-token surface styles (border, `--surface`, `--r-card`)
from `globals.css`; no inline design-system overrides.

### Day-card grid

SC-05: The grid renders exactly N cards — one per `weeklySessions` entry. Cards are ordered by
`session.day` (ascending, 1-based).

SC-06: Each card shows:
  - Label "Día {session.day}" (i18n key `plan_day_label`).
  - The session title (`session.title`).
  - Exercise count: "{N} ejercicios" (i18n key `plan_exercises_count`).
  - Estimated duration in minutes (same derivation as SC-02, per session).
  - No completion check circle (deferred to 09a).
  - No "today" indicator (deferred to 09a).

SC-07: Day-cards are keyboard-accessible (`role="button"`, `tabIndex={0}`, Enter/Space triggers
expand).

SC-08: Clicking a card that is not already open opens the detail panel for that session and
collapses any other open panel.

SC-09: Clicking the currently-open card's close button (or the card itself as a toggle) collapses
the detail panel.

SC-10: The day-grid renders as a responsive CSS Grid; no fixed 7-column layout (deferred to 09a
when weekday mapping is available). On wide viewports ≥1100px: up to 4 columns; ≥768px: 3
columns; below: 2 columns.

### Detail panel

SC-11: The detail panel shows for the selected session:
  - Eyebrow: "Día {N}" label + session title.
  - Subtitle: "{N} ejercicios · {M} min" metadata.
  - Exercise table with columns: Ejercicio · Series · Reps · Descanso.
  - The "Peso" column is absent (deferred to 09a).
  - "Empezar sesión de hoy" CTA is absent (deferred to 09a).

SC-12: Each exercise row shows:
  - `exercise.name` in the first column (full width, font-weight 500).
  - `exercise.sets` in the Series column (right-aligned, `--font-display`).
  - `exercise.reps` in the Reps column (right-aligned, `--font-display`).
  - `exercise.restSeconds` as a rest chip in the Descanso column (clock icon + "{N} s").
  - If `exercise.notes` is non-empty, it appears as a muted sub-line below the exercise name.
  - If `exercise.substitutionNote` is non-empty, it appears as a muted italic sub-line.

SC-13: The detail panel close button collapses the panel and deselects the card.

SC-14: `DayDetailPanel` is a `"use client"` component. It receives the full sessions array as
props. It manages `selectedDay: number | null` in local state. It never calls `fetch` or any
server action.

### Limitation warnings

SC-15: When `program.limitationWarnings` has one or more entries, a warning banner is rendered
above the day-grid. The banner uses `--warning` color and lists each warning as a separate
item.

SC-16: When `program.limitationWarnings` is empty, the warning banner is absent.

### Preserved states from 09b

SC-17: generating → redirect to `/plan/[id]` (unchanged).

SC-18: failed → `PlanStatusView` failed state + link to `/plan/[id]` (unchanged).

SC-19: empty / error → empty state card + `/create-plan` CTA, no selector (unchanged).

SC-20: Multi-plan selector (`PlanSelector`) renders when `summaries.length > 1` (unchanged).

### No browser → API

SC-21: No component in 09c (server or client) calls `API_BASE_URL` directly from the browser.
`DayDetailPanel` contains only local state and prop-derived rendering.

### Deferred elements are explicitly absent

SC-22: The rendered HTML must NOT contain:
  - A "Peso" column or any weight value.
  - Check-mark icons for completion state.
  - A "today" CSS class or accent indicator tied to the current date.
  - An "Empezar sesión de hoy" button or any functional workout-start CTA.
  - Week navigation prev/next buttons tied to calendar dates.
  - A "Volumen objetivo" summary tile.
  - A "Días de descanso" summary tile.

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
- Rest-day cards are not rendered; only the N training session cards appear.
- Estimated duration is a best-effort derivation: `ceil(totalRestSeconds / 60)` rounded up,
  per session. The label carries no precision claim.
- `limitationWarnings` are always surfaced as a warning banner (never silently dropped).
- The 09b `PlanSelector` component is not modified.
- All new user-facing strings have i18n keys in `en.json` and `es.json`.
