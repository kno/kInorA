# Delta for 14a-v1.1-adaptation-adherence

## ADDED Requirements

### Requirement: Adherence-Wins Precedence

When both an adherence signal and an RPE signal could produce a recommendation, `getDashboardSummary` MUST compute adherence first. If adherence is `low` with a `suggestedChange`, that recommendation MUST occupy the single `DashboardSummaryDTO.adaptation` slot and the RPE signal MUST NOT surface. Only when adherence is NOT a `low` suggestion MAY an RPE `adjust_load` recommendation occupy the slot. The contract MUST remain a single slot, never an array of competing recommendations.

#### Scenario: Adherence-low suppresses a concurrent RPE signal

- GIVEN adherence is `low` with a `suggestedChange` AND the RPE trend independently qualifies for `adjust_load`
- WHEN the dashboard summary is assembled
- THEN the `adaptation` slot carries the adherence recommendation and no RPE recommendation is surfaced

#### Scenario: RPE surfaces when adherence is not low

- GIVEN adherence is `ok` or `insufficient_data`
- WHEN the RPE trend qualifies for `adjust_load`
- THEN the `adaptation` slot carries the RPE recommendation

## MODIFIED Requirements

### Requirement: Shared Adaptation Recommendation Contract

The system MUST define a single shared `AdaptationRecommendation` contract (in `packages/contracts`) carrying a `source` discriminator (`'adherence' | 'rpe'`), a `level` (`'ok' | 'low' | 'insufficient_data'`), an optional `suggestedChange` (a `reduce_frequency` change carrying `fromDays`/`toDays`, OR an `adjust_load` change carrying `direction: 'increase' | 'decrease'` and `from`/`to: IntensityBias`), an optional `adherence` snapshot, an optional `rpe` snapshot (`RpeSnapshot { meanRpe, windowSessions, sessionsWithRpe, setsWithRpe }`), an optional `rationaleKey` (i18n key, never raw prose), and an optional `planSpecId`. Both 14a and 14b MUST compose into ONE dashboard surface via this contract, resolved by the adherence-wins precedence rule — never two competing banners. A banner MUST render only when `level === 'low'`.
(Previously: `suggestedChange` was `reduce_frequency`-only and `source` reserved `'rpe'` without a concrete shape; this block adds the `adjust_load` kind and `RpeSnapshot`.)

#### Scenario: Adherence populates the shared contract

- GIVEN a `low` adherence result
- WHEN the recommendation is assembled
- THEN it carries `source: 'adherence'`, `level: 'low'`, a `reduce_frequency` `suggestedChange`, an `adherence` snapshot, a `rationaleKey`, and the `planSpecId`

#### Scenario: RPE populates the shared contract

- GIVEN a qualifying RPE trend and no adherence-low signal
- WHEN the recommendation is assembled
- THEN it carries `source: 'rpe'`, `level: 'low'`, an `adjust_load` `suggestedChange`, an `rpe` snapshot, a `rationaleKey`, and the `planSpecId`

### Requirement: User Confirmation

Adherence- and RPE-based changes MUST be presented as suggestions requiring explicit user confirmation; auto-apply and silent regeneration are forbidden. On **accept**, `POST /plan-specs/:id/adapt` MUST re-derive the recommendation from `getDashboardSummary` (never trust the body); a mismatch MUST return `409 no_adaptation`. For `reduce_frequency`, the plan regenerates via `PlanSpec.daysPerWeek` adjusted to `toDays`. For `adjust_load`, the plan regenerates via `PlanSpec.intensityBias` written through `updateSpecIntensityBias(id, change.to)`. Both kinds MUST consume exactly one `plan_regeneration` unit at the existing billing gate via **consume-before-write** using a FRESH `randomUUID()` idempotency key per request; the mutation MUST be written only AFTER a successful consume. If `startGeneration` throws synchronously after a successful write, the write MUST be rolled back (`updateSpecDaysPerWeek`/`updateSpecIntensityBias` restored to the prior value) before the error is rethrown, with no quota refund. On **reject**, the current plan MUST remain unchanged and NOTHING MUST be consumed. If quota is exhausted, the request MUST fail with a clear error and the plan MUST remain unchanged.
(Previously: scoped only to `reduce_frequency`/`daysPerWeek`; this block generalizes the same consume-before-write, fresh-key, and rollback discipline to the `adjust_load`/`intensityBias` mutation.)

#### Scenario: User rejects adaptation

- GIVEN a recommendation of any kind is shown
- WHEN the user rejects it
- THEN the current plan remains unchanged and no quota is consumed

#### Scenario: User accepts a frequency adaptation

- GIVEN an adherence recommendation suggesting `4 → 3` days
- WHEN the user accepts
- THEN the plan regenerates with `daysPerWeek=3`, consuming exactly one `plan_regeneration` unit

#### Scenario: User accepts a load adaptation

- GIVEN an RPE recommendation suggesting `intensityBias: maintain → reduce`
- WHEN the user accepts
- THEN `updateSpecIntensityBias` writes `"reduce"` AFTER a successful fresh-key consume, then generation starts, consuming exactly one `plan_regeneration` unit

#### Scenario: Synchronous generation failure rolls back the load mutation

- GIVEN a successful consume and `updateSpecIntensityBias` write for an `adjust_load` accept
- WHEN `startGeneration` throws synchronously
- THEN `intensityBias` is rolled back to its prior value before the error is rethrown, with no quota refund

#### Scenario: Accept with exhausted quota fails safely

- GIVEN a tenant that has already consumed its monthly `plan_regeneration` unit
- WHEN the user accepts a recommendation of either kind
- THEN the request fails with a clear quota-exhausted error and the plan remains unchanged

## REMOVED Requirements

### Requirement: Frequency-Only Adjustment in Slice 1

(Reason: 14b introduces a second, independently-gated LOAD signal via `adjust_load`/`intensityBias`, so restricting the system to frequency-only suggestions is superseded.)
(Migration: see 14b's "RPE Trend Adaptation" requirement for the boundaries governing the `adjust_load` change kind; the single-slot and adherence-wins precedence rules still prevent both kinds from surfacing simultaneously.)
