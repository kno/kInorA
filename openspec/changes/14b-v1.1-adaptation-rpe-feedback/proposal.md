# Proposal: RPE-Driven Plan Adaptation (14b)

## Intent

Roadmap item 14b extends the adaptation capability so a plan reacts to how hard training *feels*, not just how consistently it is done. 14a ships adherence-driven frequency suggestions; RPE is already captured per set but is dead weight for adaptation — no policy reads it. When a user's recent RPE trends too hard (or too easy), the plan should proactively suggest a load adjustment through the same trusted suggest-and-confirm banner, so intensity stays in a productive zone without manual replanning.

## Scope

### In Scope
- New pure domain policy `computeRpeAdaptation` (rolling RPE window → `level` + LOAD `suggestedChange`), analogous to `computeAdherenceAdaptation`.
- Extend `AdaptationRecommendation`/`SuggestedChange` with a LOAD change kind and `source: "rpe"` (already reserved) plus an RPE snapshot.
- Fold RPE signal into `getDashboardSummary` at the existing seam with the **adherence-wins** precedence rule (single-slot contract preserved).
- Generalize `POST /plan-specs/:id/adapt` (`isConfirmable` + a new server-authoritative LOAD mutation) preserving 14a's exact discipline.
- Mobile RPE capture parity: RPE input in mobile `ExerciseCard.tsx` and wire `rpe` through `WorkoutTrackerScreen.tsx` set-record submit.
- New i18n copy branches per suggested-change kind (en + es, catalog-parity).

### Out of Scope
- Any qualitative "feedback"/difficulty capture surface (too-easy/too-hard/just-right). RPE is the only signal for v1. Possible future follow-up.
- Multi-recommendation array / breaking the single `DashboardSummaryDTO.adaptation` slot.
- Auto-regenerating a full next training block from feedback.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `14b-v1.1-adaptation-rpe-feedback`: realize the concrete v1 slice — RPE-trend LOAD suggestion + mobile RPE capture. Narrow the roadmap "Feedback Integration" requirement to RPE-only (qualitative feedback deferred).
- `14a-v1.1-adaptation-adherence`: add the adherence-wins single-slot precedence rule and generalize the `/adapt` confirm route for a LOAD change kind.

## Approach

Reuse 14a's proven `/adapt` machinery rather than a parallel flow (exploration Approach 1 + 3's discipline). Add RPE as a second signal competing for the same recommendation slot; adherence-low wins when both fire. Extend the contract for a LOAD change, add the confirm branch and its mutation, and branch banner copy. Both web (`DashboardCoachCard`) and mobile (`AdherenceBanner`) banners are already source-agnostic on shape — only copy branches are needed.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | Modified | LOAD `SuggestedChange` kind, RPE snapshot, `source: "rpe"` |
| `packages/domain/src/progress/` | New | `computeRpeAdaptation` pure policy |
| `packages/domain/src/offline/session-aggregation.ts` | Modified | rolling-window RPE trend helper |
| `apps/api/src/db/repositories/workout-session.ts:725-747` | Modified | RPE fold + adherence-wins precedence |
| `apps/api/src/routes/plan.ts:692-819` | Modified | generalize `isConfirmable` + new LOAD mutation |
| `apps/web/.../DashboardCoachCard.tsx` | Modified | copy branch per change kind |
| `apps/mobile/.../AdherenceBanner.tsx` | Modified | copy branch per change kind |
| `apps/mobile/.../tracker/ExerciseCard.tsx` + `WorkoutTrackerScreen.tsx:661` | Modified | RPE input + wire `rpe` on submit |
| i18n catalogs (en, es) | Modified | new adaptation copy keys |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| LOAD confirm path reintroduces #244 bug class | High | HARD INVARIANT: consume-before-write ordering, fresh `randomUUID()` key per request, rollback-on-failure — reuse 14a's exact pattern |
| Precedence surprises users (RPE suppressed by adherence) | Med | Document adherence-wins; surface only the winning signal in the single slot |
| Mobile RPE optional → sparse trend data | Med | Design handles insufficient-sample windows (no suggestion below threshold) |
| Threshold/window tuning wrong (over/under-suggesting) | Med | Deferred to design as explicit open question |

## Rollback Plan

Feature is additive and gated by the existing `/adapt` wiring. Revert order: unregister/short-circuit the RPE fold in `getDashboardSummary` (RPE recommendation stops surfacing) → revert confirm-route LOAD branch → revert contract/domain/UI/i18n commits. Mobile RPE input can ship independently; leaving it while reverting the policy is safe (extra captured data, no behavior).

## Dependencies

- `14a-v1.1-adaptation-adherence` (machinery being extended).
- `09a-v1-workout-tracking-core` (per-set RPE capture).

## Open Questions (defer to design)

- **RPE threshold + window semantics**: which RPE trend (too hard / too easy) over what rolling window and minimum sample size triggers a LOAD suggestion. Roadmap spec anchors a 6-8 target zone but final numbers are NOT decided here.
- LOAD mutation granularity: adjust working weight vs. rest period, and by how much.

## Success Criteria

- [ ] Recent high/low RPE trend produces a LOAD `AdaptationRecommendation` on both web and mobile.
- [ ] When adherence-low and RPE both fire, the adherence recommendation surfaces (single slot).
- [ ] Confirming a LOAD suggestion mutates the plan server-authoritatively with consume-before-write, fresh idempotency key, and rollback-on-failure.
- [ ] Mobile tracker captures and submits `rpe`.
- [ ] No qualitative feedback surface added; single-slot contract shape unchanged.
- [ ] i18n catalog parity (en + es) for new copy.
