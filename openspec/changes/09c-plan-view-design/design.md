# Design: 09c-plan-view-design

## Technical Approach

Replace the `status === "ready"` branch in `/plan/page.tsx` with a new `PlanWeekView` server
component that renders the summary strip + day-card grid. Day-card expand/collapse is handled
by a `DayDetailPanel` client island that receives all session data as props (no fetches). A
scoped CSS module consumes the existing `globals.css` design tokens. All other page states
(generating, failed, empty) and the `PlanSelector` are untouched.

## Architecture Decisions

### Decision: New component vs. extending PlanStatusView

| Option | Tradeoff | Decision |
|--------|----------|----------|
| New `PlanWeekView` + `DayDetailPanel` components | Clean separation of the new layout; `PlanStatusView` keeps its current contract for generating/failed states at `/plan/[id]` | **Chosen** |
| Extend `PlanStatusView` with a "ready-grid" branch | Would bloat a component that intentionally covers generating/failed across two routes; its "ready" branch is already diverging from the new design | Rejected |

**Rationale**: `PlanStatusView` serves `/plan/[id]` (with WS context) and the failed/generating
states on `/plan`. Adding a third rich layout inside it creates conflated responsibilities.
A dedicated `PlanWeekView` is single-responsibility and independently testable.

### Decision: Day labels — session numbers vs. weekday names

| Option | Tradeoff | Decision |
|--------|----------|----------|
| "Día 1, Día 2, …" (session.day, 1-based) | Accurate to our data model; no invented weekday mapping | **Chosen** |
| Map session.day to Mon/Tue/… | Requires a `startDayOfWeek` anchor we don't have; would be fabricated | Rejected |

**Rationale**: The design mockup uses weekday labels because it was authored with full execution
context. Our `WorkoutSession.day` is a 1-based training-day index with no calendar anchor.
Fabricating weekday names would be misleading. "Día N" is honest and keeps the layout faithful
to the grid structure without inventing data.

### Decision: Summary strip tiles — which to include

| Tile | Data Available | 09c Decision |
|------|----------------|--------------|
| Sesiones planificadas | `weeklySessions.length` | Rendered |
| Duración estimada | Derived: `ceil(sum(sets×restSeconds)/60)` per session, total | Rendered (as an estimate) |
| Días de descanso | None (no daysPerWeek or weekday anchor) | Omitted |
| Volumen objetivo | None (`WorkoutExercise` has no weight field) | Omitted |

**Rationale**: Show only what we can honestly derive. The "estimated duration" is a rough proxy
(rest time only, not actual rep/set execution time); the label will note it is an estimate.
Omitting rather than inventing keeps the summary honest. The layout collapses to 2 tiles; the
CSS module handles this via `flex-wrap` or reduced flex children without empty slots.

### Decision: Expand/collapse interaction — client island vs. CSS details/summary

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Client island `DayDetailPanel` (`"use client"`) | Full control over aria-expanded, keyboard events, smooth scroll-into-view, toggle semantics; exactly mirrors the mockup JS logic | **Chosen** |
| Native HTML `<details>`/`<summary>` | Zero JS, accessible by default, but no aria-expanded on the card, no cross-card mutual exclusion (one-open-at-a-time), styling limitations | Rejected |

**Rationale**: The mockup's interaction model (click card → open panel below grid, close others;
toggle if already open) is trivially stateful and requires mutual exclusion across cards. A
client island with `selectedDay: number | null` state is the minimal correct implementation.
`<details>` can't close siblings. The island imports zero external state and fetches nothing —
it is pure local React state.

### Decision: Duration estimation formula

**Choice**: Per session: `Math.ceil((totalSets × avgRestSeconds) / 60)` where
`totalSets = sum(exercise.sets)` and `avgRestSeconds = mean(exercise.restSeconds)`.
For the summary tile: sum of per-session estimates.

**Alternatives considered**: Using a fixed per-set multiplier (e.g. 3 min/set including
execution time). Rejected — too opaque; at least the rest-based derivation uses real data.

**Rationale**: The rest time is the only timing data we have. The label reads "est. {N} min"
to communicate approximation to the user. This is intentionally surfaced as a rough estimate.

### Decision: limitationWarnings placement

**Choice**: Warning banner rendered by `PlanWeekView` above the day-card grid, using
`var(--warning)` border/text color. Not a modal, not a tooltip.

**Rationale**: Safety/limitation warnings must be immediately visible, not hidden behind
interaction. Above the grid is the most prominent persistent location. This matches the
pattern used by `PlanStatusView` for the existing warnings section.

### Decision: CSS approach — scoped module using global tokens

**Choice**: `plan-week-view.module.css` — CSS Modules file that references the existing
`globals.css` custom properties (`var(--surface)`, `var(--accent)`, `var(--border)`, etc.)
using standard CSS custom property inheritance.

**Alternatives considered**: Tailwind utility classes (not used in this repo's app shell or
plan area; the project uses CSS Modules and global utility classes), inline styles (fragile
and hard to maintain). Rejected both.

**Rationale**: The design system lives entirely in `globals.css` tokens. CSS Modules scopes
the structural layout shapes (grid, card geometry, table layout) while the token layer provides
color/type/spacing — no duplication, consistent theming.

## Data Flow

```
Browser ─GET /plan[?planId=X]─→ Next.js server component (plan/page.tsx)
    │
    ├─ listPlansAction()  [unchanged from 09b]
    ├─ getPlanStatusAction(selectedId)  [unchanged from 09b]
    │
    └─ plan.status === "ready"
         └─ <PlanWeekView program={plan.program} messages={messages} />
                │
                ├─ derives summaryTiles (sessions count, est. duration)
                ├─ renders <LimitationWarningBanner warnings={…} />  [server]
                ├─ renders summary strip  [server]
                └─ renders <DayDetailPanel sessions={program.weeklySessions} messages={…} />
                              │   ["use client" island — no API calls]
                              ├─ state: selectedDay: number | null
                              ├─ renders day-card grid
                              └─ renders detail panel for selectedDay

PlanSelector (unchanged) ─onChange─→ router.push("/plan?planId=<id>") → server re-render
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/web/src/app/(app)/plan/PlanWeekView.tsx` | Create | Server component; summary strip + limitation banner + `DayDetailPanel` wrapper |
| `apps/web/src/app/(app)/plan/DayDetailPanel.tsx` | Create | Client island; day-card grid + detail panel; local `selectedDay` state |
| `apps/web/src/app/(app)/plan/plan-week-view.module.css` | Create | Scoped CSS for summary strip, day-card grid, detail panel; references global tokens |
| `apps/web/src/app/(app)/plan/page.tsx` | Modify | Replace `<PlanStatusView status="ready" …>` branch with `<PlanWeekView program={…} messages={…} />` |
| `apps/web/src/app/(app)/plan/__tests__/PlanWeekView.test.tsx` | Create | Tests: session count tile, duration tile, limitation banner presence/absence, day-card count |
| `apps/web/src/app/(app)/plan/__tests__/DayDetailPanel.test.tsx` | Create | Tests: expand/collapse, exercise table columns, no Peso column, notes rendering |
| `apps/web/src/i18n/messages/en.json` | Modify | Add keys: `plan_day_label`, `plan_exercises_count`, `plan_est_duration`, `plan_summary_sessions`, `plan_summary_duration`, `plan_table_exercise`, `plan_table_sets`, `plan_table_reps`, `plan_table_rest`, `plan_limitation_title`, `plan_day_detail_close` |
| `apps/web/src/i18n/messages/es.json` | Modify | Same keys in Spanish |

## Interfaces / Contracts

```ts
// PlanWeekView.tsx — server component, no "use client"
interface PlanWeekViewProps {
  program: WorkoutProgram;
  messages: Record<string, string>;
}

// DayDetailPanel.tsx — "use client" island
interface DayDetailPanelProps {
  sessions: WorkoutSession[];  // from WorkoutProgram.weeklySessions
  messages: Record<string, string>;
}

// WorkoutSession (from @kinora/contracts — unchanged)
interface WorkoutSession {
  day: number;          // 1-based session number
  title: string;
  exercises: WorkoutExercise[];
}

// WorkoutExercise (from @kinora/contracts — unchanged, no weight field in 09c)
interface WorkoutExercise {
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes?: string;
  substitutionNote?: string;
}
```

Duration derivation (co-located utility, not exported):
```ts
function estimateSessionMinutes(exercises: WorkoutExercise[]): number {
  const totalRest = exercises.reduce((s, e) => s + e.sets * e.restSeconds, 0);
  return Math.ceil(totalRest / 60);
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — PlanWeekView | Summary tile session count; est. duration tile presence; limitation banner present/absent; correct day-card count passed to island | Vitest + RTL (render as RSC-compatible) |
| Unit — DayDetailPanel | Default: no panel open; click day 1 opens panel 1; click again closes; click day 2 switches; exercise table has 4 columns (no Peso); notes and substitutionNote visible; close button works | Vitest + RTL |
| Unit — page.tsx | ready branch renders PlanWeekView (not PlanStatusView); all 09b states still render correctly | Vitest + RTL, extend existing page.test.tsx |
| i18n | No new key is missing from en.json or es.json | Static JSON key presence check (extend existing i18n test if present) |

## Migration / Rollout

No migration required. No schema changes. `PlanStatusView` is not removed — it continues
to serve the generating/failed states and `/plan/[id]`. The "ready" branch in `/plan/page.tsx`
is swapped to `PlanWeekView`. Rollback is a one-line revert of that branch.

## Open Questions

- [ ] Estimated duration formula: using `sets × restSeconds` only — confirm with product that
      this is an acceptable proxy, or whether a fixed per-set execution overhead should be added.
- [ ] Summary strip with 2 tiles only: confirm the visual is acceptable without the rest-day
      and volume tiles, versus showing them as "—" placeholders.
