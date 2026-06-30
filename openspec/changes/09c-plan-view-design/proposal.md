# Proposal: 09c-plan-view-design

## Problem

The current `/plan` page (09b) renders a plan in `PlanStatusView` — a minimal list-style layout
that ignores the kInorA OpenDesign specification entirely. The `web-plan.html` mockup defines a
rich "Mi plan" screen: a summary strip, a day-card grid, and a per-day exercise detail panel.
Users land on a functional but visually hollow page that does not match the product design.

**Design source**: `docs/open-design/kinora/screens/web-plan.html` — local mirror of the
OpenDesign daemon output (re-sync from the live daemon if a newer version is available; daemon
is currently down as of 2026-06-30).

## Solution

Rewrite the plan "ready" view so it faithfully matches the `web-plan.html` mockup:

1. **Topbar** — page heading "Mi plan" (already provided by AppShell; add the page title inside
   the existing server component).
2. **Summary strip** — 4-cell horizontal bar matching the mockup: planned sessions (count),
   rest days (derived: `7 − weeklySessions.length`), estimated duration (derived from
   exercises), target volume (inert "—" placeholder, deferred to 09a — needs weight). All four
   cells render, keeping the layout faithful to the mockup.
3. **Day-card grid** — one card per training session (Día 1 … Día N), not a 7-cell weekday
   grid. Cards show: session label, exercise count, estimated duration, click-to-expand
   interaction. Completion circles and "today" highlight are deferred to 09a (execution).
4. **Detail panel** — expands below the grid on card click; shows a 4-column exercise table
   (Ejercicio · Series · Reps · Descanso). Peso column and "Empezar sesión" CTA are deferred
   to 09a. Expand/collapse is a client island that reads props only (no API fetch).
5. **limitationWarnings** — rendered as a warning banner above the day-grid; NOT deferred.
6. **Reuse kinora design tokens** from `globals.css` (already loaded by the app shell); add a
   scoped CSS module `plan-week-view.module.css` for the new layout shapes.

The 09b plan selector (`PlanSelector`) and the generating → redirect / failed → link / empty →
CTA states are preserved unchanged.

## Scope

1. **Replace PlanStatusView "ready" rendering** — add `PlanWeekView` server component
   (pure presentational, no `"use client"`) that receives `WorkoutProgram` and renders the
   summary strip + day-grid layout.
2. **Add DayDetailPanel client island** — `"use client"` component; receives session data as
   props; manages the selected-day state (which panel is open). Zero API calls.
3. **CSS module** — `plan-week-view.module.css` for the new layout primitives (summary strip,
   day-card, detail panel) using the existing `--bg`/`--surface`/`--accent`/etc. tokens.
4. **Wire into `/plan/page.tsx`** — replace the `<PlanStatusView status="ready" …/>` branch
   with `<PlanWeekView program={…} messages={…} />`. All other branches (failed, generating,
   empty) are untouched.
5. **i18n** — new keys for summary strip labels, day-card metadata labels, exercise table
   headers, and limitation warning header.
6. **Tests** — unit tests for `PlanWeekView` (summary counts, day-card count, limitation banner)
   and `DayDetailPanel` (expand/collapse toggling, exercise table rendering).

## Out of Scope (deferred to 09a)

- "Peso" column in the exercise table (no weight data in `WorkoutExercise`).
- Completion check-marks / done state.
- "Today" highlighting tied to real calendar dates.
- "Empezar sesión de hoy" CTA.
- Week-by-date navigation (prev/next week buttons).
- Target volume in the summary strip (requires weight × reps per set).
- Rest-day cards (requires `daysPerWeek` or a weekday mapping).

## Constraints

- Browser never calls the API directly (server components / server actions enforced by
  `ui-api-guard.mjs`). `DayDetailPanel` is a client island that receives all data as props
  and performs no fetching.
- CSS tokens reuse `globals.css`; no inline copy of the design system.
- i18n: en + es for all new copy.
- NodeNext `.js` extensions on API side; web imports extensionless.
- TDD: tests written before or alongside implementation; native Vitest + React Testing Library.
