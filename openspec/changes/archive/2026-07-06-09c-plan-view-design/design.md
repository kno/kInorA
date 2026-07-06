# Design: 09c-plan-view-design

## Technical Approach

Replace the `status === "ready"` branch in `/plan/page.tsx` with a new `PlanWeekView` server
component that renders a 4-tile summary strip + day-card grid. Day-card expand/collapse is
handled by a `DayDetailPanel` client island that receives all session data as props (no
fetches). A scoped CSS module consumes the existing `globals.css` design tokens. All other page
states (generating, failed, empty) and the `PlanSelector` are untouched.

**09c is frontend-only.** No API route, repo method, or DTO change. All four summary tiles and
the day-grid derive entirely from the `program` already present in the existing detail DTO
`{ id, status, program, specId }`.

## Architecture Decisions

### Decision: New component vs. extending PlanStatusView

| Option | Tradeoff | Decision |
|--------|----------|----------|
| New `PlanWeekView` + `DayDetailPanel` components | Clean separation of the new layout; `PlanStatusView` keeps its current contract for generating/failed states at `/plan/[id]` | **Chosen** |
| Extend `PlanStatusView` with a "ready-grid" branch | Would bloat a component that intentionally covers generating/failed across two routes | Rejected |

### Decision: Day labels — session numbers vs. weekday names

**Choice**: "Día 1, Día 2, …" (session.day, 1-based). The design mockup uses weekday labels
because it was authored with full execution context. Our `WorkoutSession.day` is a 1-based
training-day index with no calendar anchor — fabricating weekday names would be misleading.

### Decision: Summary strip — all 4 mockup tiles, derived without an API change

| Tile | Source | 09c Decision |
|------|--------|--------------|
| Sesiones planificadas | `weeklySessions.length` | Rendered |
| Días de descanso | `max(0, 7 − weeklySessions.length)` (08 invariant) | Rendered (derived, no API change) |
| Duración estimada | Sum of per-session durations (formula below) | Rendered (as an estimate) |
| Volumen objetivo | None (`WorkoutExercise` has no weight field) | Inert "—" placeholder, deferred to 09a |

### Decision: Expand/collapse — client island vs. CSS details/summary

**Choice**: Client island `DayDetailPanel` (`"use client"`). The mockup's interaction (click card → open panel, close others; toggle if already open) requires mutual exclusion across cards. `<details>` can't close siblings. The island imports zero external state and fetches nothing.

### Decision: Duration estimation formula

Per session: `Math.ceil( sum_over_exercises( sets × (restSeconds + EXECUTION_OVERHEAD_SECONDS) ) / 60 )`
with `EXECUTION_OVERHEAD_SECONDS = 30` (named, documented constant). Summary tile = sum across all sessions. Label reads "est. {N} min".

### Decision: CSS approach — scoped module using global tokens

**Choice**: `plan-week-view.module.css` — CSS Modules file referencing `globals.css` custom properties (`var(--surface)`, `var(--accent)`, `var(--border)`, etc.). No Tailwind, no inline styles.

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
                ├─ derives 4 summary tiles:
                │     sessions = weeklySessions.length
                │     restDays = max(0, 7 − weeklySessions.length)
                │     duration = Σ estimateSessionMinutes(session)
                │     volume   = "—" (inert placeholder, deferred to 09a)
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
| `apps/web/src/app/(app)/plan/plan-week-view.module.css` | Create | Scoped CSS for summary strip, day-card grid, detail panel |
| `apps/web/src/app/(app)/plan/page.tsx` | Modify | Replace `<PlanStatusView status="ready" …>` branch with `<PlanWeekView program={…} messages={…} />` |
| `apps/web/src/app/(app)/plan/__tests__/PlanWeekView.test.tsx` | Create | Tests: session count tile, duration tile, limitation banner presence/absence, day-card count |
| `apps/web/src/app/(app)/plan/__tests__/DayDetailPanel.test.tsx` | Create | Tests: expand/collapse, exercise table columns, no Peso column, notes rendering |
| `apps/web/src/i18n/messages/en.json` | Modify | Add keys: `plan_day_label`, `plan_exercises_count`, `plan_est_duration`, `plan_summary_*`, `plan_table_*`, `plan_limitation_title`, `plan_day_detail_close` |
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
  sessions: WorkoutSession[];
  messages: Record<string, string>;
}

// Duration derivation (co-located utility, not exported):
const EXECUTION_OVERHEAD_SECONDS = 30;

function estimateSessionMinutes(exercises: WorkoutExercise[]): number {
  const totalSeconds = exercises.reduce(
    (sum, e) => sum + e.sets * (e.restSeconds + EXECUTION_OVERHEAD_SECONDS),
    0,
  );
  return Math.ceil(totalSeconds / 60);
}

function restDays(weeklySessions: WorkoutSession[]): number {
  return Math.max(0, 7 - weeklySessions.length);
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — PlanWeekView | All 4 tiles; limitation banner present/absent; correct day-card count | Vitest + RTL |
| Unit — DayDetailPanel | Expand/collapse; mutual exclusion; 4-column table; no Peso; notes/substitutionNote | Vitest + RTL |
| Unit — page.tsx | ready branch renders PlanWeekView; all 09b states still correct | Vitest + RTL, extend existing page.test.tsx |

## Migration / Rollout

No migration, no schema changes, no API change. `PlanStatusView` is not removed — it continues
to serve generating/failed states and `/plan/[id]`. Rollback = one-line revert of the `ready`
branch in `/plan/page.tsx`.
