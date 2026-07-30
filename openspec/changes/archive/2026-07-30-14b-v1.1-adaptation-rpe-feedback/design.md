# Design: RPE-Driven Plan Adaptation (14b)

## Technical Approach

Add RPE as a second adaptation signal reusing 14a's `computeAdherenceAdaptation` → `getDashboardSummary` fold → `POST /plan-specs/:id/adapt` machinery. A new pure policy `computeRpeAdaptation` reads recent per-set RPE and, when the trend leaves the 6–8 productive zone, emits a LOAD `SuggestedChange`. Confirming it mutates a NEW server-authoritative `PlanSpec.intensityBias` field, then regenerates — mirroring how frequency mutates `daysPerWeek`. Both signals compete for the single `DashboardSummaryDTO.adaptation` slot; adherence-low always wins.

## Architecture Decisions

### Decision: LOAD adaptation mutates `PlanSpec.intensityBias`, not the program
**Choice**: Add optional `intensityBias?: "reduce" | "maintain" | "increase"` to `PlanSpec`; the prompt (`buildPlanPrompt`) consumes it; a new repo method `updateSpecIntensityBias` writes it; `/adapt` regenerates.
**Alternatives**: (a) directly edit per-exercise weights in `WorkoutProgram`; (b) new per-program load column.
**Rationale**: `WorkoutExercise` has NO weight field — weight is user-recorded per set, so there is nothing to edit at program level. Any direct program edit is also erased on the next regeneration. `intensityBias` on the spec is the only lever that survives regeneration and keeps the server authoritative, exactly mirroring `updateSpecDaysPerWeek` + regenerate. The generator already turns spec fields into rep/set/rest/exercise choices via the prompt, so a bias line steers intensity deterministically. Absent = `maintain` (backward compatible; legacy specs untouched, jsonb column needs no migration).

### Decision: RPE trend policy — session-count window, hysteresis band
**Choice**: Pure `computeRpeAdaptation(input, now)` over the last `WINDOW_SESSIONS = 3` completed sessions; count only completed working sets with a recorded `rpe`; aggregate = mean of those set RPEs. Constants:
`RPE_HIGH_THRESHOLD = 8.5` (mean ≥ → too hard → `direction: "decrease"`), `RPE_LOW_THRESHOLD = 5.5` (mean ≤ → too easy → `direction: "increase"`), in-zone no-op band `(5.5, 8.5)`, `MIN_SESSIONS_WITH_RPE = 2`, `MIN_SETS_WITH_RPE = 4`. Below either minimum → `insufficient_data`, no suggestion.
**Alternatives**: time window like adherence's 4 weeks; strict 6/8 zone edges.
**Rationale**: RPE is sparse and optional (especially mobile), so a session-count window with sample-size floors handles gaps better than a calendar window that could read one logged set as a trend. The `(5.5, 8.5)` hysteresis brackets the 6–8 target with buffer so a normal hard-but-productive 8 does not fire, and only a genuinely too-hard (≥8.5) or too-easy (≤5.5) trend triggers. Pure + deterministic, injectable `now`, mirroring `computeAdherenceAdaptation`.

### Decision: adherence-wins precedence, single slot preserved
**Choice**: In `getDashboardSummary`, compute adherence first. If `adherence.level === "low"` with a `suggestedChange`, use it. Otherwise compute RPE; surface an RPE `low` recommendation only when no adherence-low signal is present. Single `adaptation` slot, no array.
**Rationale**: Frequency is more foundational than load; suppressing RPE under adherence-low avoids contradictory advice. Keeps the contract shape and both banners structurally unchanged.

## Contract / Interface Deltas (`packages/contracts/src/index.ts`)

```ts
export type IntensityBias = "reduce" | "maintain" | "increase";
export type SuggestedChange =
  | { kind: "reduce_frequency"; fromDays: number; toDays: number }
  | { kind: "adjust_load"; direction: "increase" | "decrease"; from: IntensityBias; to: IntensityBias };
export interface RpeSnapshot { meanRpe: number; windowSessions: number; sessionsWithRpe: number; setsWithRpe: number; }
// AdaptationRecommendation gains: rpe?: RpeSnapshot;   PlanSpec gains: intensityBias?: IntensityBias;
```
`to` steps one rung from current bias on the ladder reduce<maintain<increase; no suggestion at the floor/ceiling (mirrors `MIN_DAYS_PER_WEEK`).

## Confirm-Route Flow (`plan.ts`) — HARD INVARIANT preserved

Generalize `isConfirmable` per kind: `reduce_frequency` (unchanged) OR `adjust_load` (with `planSpecId === id`). The #244-class discipline is unchanged and MUST apply to the LOAD branch identically:
1. `assertGeneratable` → 404 before any consume/write.
2. Re-derive recommendation from `getDashboardSummary`; mismatch → 409 `no_adaptation`.
3. **consume-before-write**: `checkAndConsume("plan_regeneration", …:${randomUUID()})` — FRESH key per request; 403 leaves spec untouched.
4. Write `updateSpecIntensityBias(id, change.to)` AFTER a successful consume.
5. `startGeneration`; on synchronous throw, **rollback** via `updateSpecIntensityBias(id, change.from)`, then rethrow (best-effort, no quota refund — same as frequency).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | Modify | `IntensityBias`, LOAD `SuggestedChange` union, `RpeSnapshot`, `PlanSpec.intensityBias` |
| `packages/domain/src/progress/rpe-adaptation.ts` | Create | pure `computeRpeAdaptation` + constants |
| `apps/api/src/db/repositories/workout-session.ts:725-747` | Modify | RPE fold + adherence-wins precedence (reuse fetched set RPE) |
| `apps/api/src/db/repositories/plan-spec.ts` | Modify | `updateSpecIntensityBias` (jsonb_set, tenant/user scoped) |
| `apps/api/src/routes/plan.ts:750-815` | Modify | per-kind `isConfirmable` + LOAD write/rollback branch |
| `apps/api/src/ai/prompt.ts` | Modify | emit intensity-bias line in `buildPlanPrompt` |
| `apps/api/src/plan/boundary.ts` | Modify | validate optional `intensityBias` enum |
| `apps/web/.../DashboardCoachCard.tsx`, `apps/mobile/.../AdherenceBanner.tsx` | Modify | copy branch by `suggestedChange.kind` |
| `apps/mobile/src/screens/tracker/ExerciseCard.tsx` + `WorkoutTrackerScreen.tsx:661` | Modify | RPE stepper (0–10) + wire `rpe` on set-record submit |
| i18n catalogs (en, es) | Modify | `adaptation.rpe.reduceLoad`/`increaseLoad` + banner branch copy |

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (domain) | `computeRpeAdaptation` threshold/window/sample-floor/ladder edges | fixture windows, injected `now`, pure |
| Unit (domain) | precedence fold helper | adherence-low+RPE → adherence; RPE-only → RPE |
| Route | `/adapt` LOAD confirm: 409 stale, 403 quota (fresh key), consume-before-write, rollback on sync throw | supertest + FakeLedger, assert no half-applied bias |
| Contract | union + `RpeSnapshot` + `intensityBias` shape/boundary | zod/boundary tests |
| UI | banner copy branch per kind; mobile RPE stepper submits `rpe` | web RTL + mobile render/submit |

## Threat Matrix
N/A — no routing/shell/subprocess/VCS/PR-automation/executable-classification boundary; reuses an existing authenticated route.

## Migration / Rollout
No DB migration: `intensityBias` rides in the existing `plan_specs.spec_json` jsonb; absent = `maintain`. Additive and revertible per the proposal's rollback order.

## Open Questions
None blocking. (Follow-up: whether `intensityBias` should also nudge rest periods vs. rep ranges is left to the generator prompt, not the contract.)
