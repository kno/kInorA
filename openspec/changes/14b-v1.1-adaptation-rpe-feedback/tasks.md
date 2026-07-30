# Tasks: RPE-Driven Plan Adaptation (14b)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950-1050 (contracts ~20, domain policy+tests ~330, api fold+repo+route+tests ~665, web/mobile UI+tests ~230, i18n ~60) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Slice A, ~735 lines) → PR 2 (Slice B, ~280 lines) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (pending user confirmation) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Note: evaluated against this session's 800-line budget (not the skill-default 400). Slice A alone (~735 lines) is close to the 800-line ceiling; if the real diff runs over, split A further into A1 (contract+domain policy) and A2 (api fold+confirm route) before requesting review.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| A | Signal + policy + contract + `/adapt` confirm generalization (contracts, `rpe-adaptation.ts`, session-aggregation helper, `workout-session.ts` fold, `plan-spec.ts` mutation, `plan.ts` route, prompt/boundary) | PR 1 | `pnpm vitest packages/domain/src/progress/rpe-adaptation.test.ts apps/api/src/routes/plan.test.ts` | `supertest` against `apps/api` route tests (real DB fixtures) | revert PR 1; RPE fold no-ops (adherence-only), fields stay optional/back-compat |
| B | Mobile RPE capture + web/mobile banner copy + i18n | PR 2, base = PR 1 | `pnpm vitest apps/mobile/.../ExerciseCard.test.tsx apps/web/.../DashboardCoachCard.test.tsx` | RN component render/submit test + RTL | revert PR 2 independently; extra captured `rpe` data is harmless per proposal rollback order |

## Phase 1: Contracts (Foundation)

- [ ] 1.1 RED: failing type/boundary tests for `IntensityBias`, `adjust_load` `SuggestedChange`, `RpeSnapshot`, `PlanSpec.intensityBias` in `packages/contracts`.
- [ ] 1.2 GREEN: add these types/schemas to `packages/contracts/src/index.ts`.

## Phase 2: Domain Policy (pure)

- [ ] 2.1 RED: `packages/domain/src/progress/rpe-adaptation.test.ts` — high/low RPE, in-zone no-op, insufficient-data, ladder floor/ceiling (spec scenarios).
- [ ] 2.2 GREEN: create `computeRpeAdaptation` + constants in `rpe-adaptation.ts`.
- [ ] 2.3 RED: test for rolling-window RPE helper in `packages/domain/src/offline/session-aggregation.ts`.
- [ ] 2.4 GREEN: implement the helper.

## Phase 3: API Fold + Precedence

- [ ] 3.1 RED: `getDashboardSummary`/`workout-session.test.ts` — adherence-low suppresses RPE; RPE surfaces when adherence ok/insufficient.
- [ ] 3.2 GREEN: modify `workout-session.ts:725-747` (adherence-first, RPE fold, precedence, `RpeSnapshot`).
- [ ] 3.3 RED: repo test for `updateSpecIntensityBias` (jsonb_set, tenant/user scoped, restore-prior-value).
- [ ] 3.4 GREEN: implement in `plan-spec.ts`.

## Phase 4: Confirm Route Generalization

- [ ] 4.1 RED: `plan.test.ts` — 404 pre-consume, 409 stale mismatch, fresh-`randomUUID()` consume-before-write, 403 quota leaves spec untouched, successful accept, rollback on synchronous `startGeneration` throw (mirror #244).
- [ ] 4.2 GREEN: generalize `isConfirmable` + LOAD write/rollback branch in `plan.ts:750-815`.
- [ ] 4.3 RED: `prompt.ts` test — intensity-bias line present per bias value.
- [ ] 4.4 GREEN: implement in `buildPlanPrompt`.
- [ ] 4.5 RED: `boundary.ts` test — optional `intensityBias` enum validation.
- [ ] 4.6 GREEN: implement.

## Phase 5: Web + Mobile Banner Copy

- [ ] 5.1 RED: `DashboardCoachCard.test.tsx` — `adjust_load` increase/decrease copy.
- [ ] 5.2 GREEN: branch copy by `suggestedChange.kind` in `DashboardCoachCard.tsx`.
- [ ] 5.3 RED: mobile `AdherenceBanner` test, same branch.
- [ ] 5.4 GREEN: implement in `AdherenceBanner.tsx`.

## Phase 6: Mobile RPE Capture

- [ ] 6.1 RED: `ExerciseCard.test.tsx` — optional 0-10 RPE input renders.
- [ ] 6.2 GREEN: add RPE input to `ExerciseCard.tsx`.
- [ ] 6.3 RED: `WorkoutTrackerScreen.test.tsx` — submit payload includes `rpe` when entered, omits when not.
- [ ] 6.4 GREEN: wire `rpe` at `WorkoutTrackerScreen.tsx:661`.

## Phase 7: i18n

- [ ] 7.1 Add `adaptation.rpe.reduceLoad`/`increaseLoad` copy keys to `en` catalog.
- [ ] 7.2 Add matching `es` keys; run catalog-parity test.

## Phase 8: Verification

- [ ] 8.1 Run domain + api + web + mobile suites; confirm no half-applied `intensityBias` write on any failure branch.
- [ ] 8.2 Manual smoke: full accept flow for `adjust_load` on web and mobile.
