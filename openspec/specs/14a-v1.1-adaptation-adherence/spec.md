# 14a-v1.1-adaptation-adherence Specification

## Purpose

Adapt future plans from workout adherence while keeping recommendations explainable and user-confirmed. The system observes whether a user is completing their planned training frequency over a configurable rolling window and, when adherence drops below threshold, suggests a deterministic frequency reduction that the user must explicitly accept or reject before anything changes. Delivered on both web and mobile, reusing the existing regenerate → generate path and billing gate — never a new AI brain, never auto-applied, never a new "missed" day-grid state. Defines the shared `AdaptationRecommendation` contract so a later signal (14b — RPE) can compose into the same dashboard surface.

## Dependencies

- `09b-v1-workout-offline-history`

## Requirements

### Requirement: Adherence Tracking

The system MUST compare completed sessions against planned sessions over a **configurable rolling window** (default 4 weeks) and MUST compute an adherence percentage `= completedInWindow / (plannedSessionsPerWeek * periodWeeks)`, clamped to `0..1`. Adherence below `70%` MUST be marked `low`; at or above `70%` MUST be marked `ok`. The computation MUST be a pure, deterministic domain function (no I/O, no LLM, no scheduler) and MUST NOT introduce a new "missed" day-grid state. When there is no active ready plan, `plannedSessionsPerWeek = 0`, or less than one full window of completion history is available, the function MUST return `level: 'insufficient_data'` and MUST NOT emit a recommendation. Truncation of the underlying bounded history window MUST NOT overstate adherence.

#### Scenario: Low adherence detected

- GIVEN a user completed 5 of 16 planned sessions in 4 weeks (`plannedSessionsPerWeek=4`, `periodWeeks=4`)
- WHEN adherence is computed
- THEN the adherence percentage is ~31% and the system marks adherence `low`

#### Scenario: Adherence at or above threshold is ok

- GIVEN a user completed at least 70% of planned sessions over the window
- WHEN adherence is computed
- THEN adherence is marked `ok` and no suggested change is produced

#### Scenario: No active ready plan yields insufficient data

- GIVEN a user has no plan in `status='ready'`
- WHEN adherence is computed
- THEN the function returns `level: 'insufficient_data'` and no recommendation

#### Scenario: Zero planned sessions yields insufficient data

- GIVEN `plannedSessionsPerWeek = 0`
- WHEN adherence is computed
- THEN the function returns `level: 'insufficient_data'` (no division by zero) and no recommendation

#### Scenario: New user with less than one window of history

- GIVEN a user whose completion history spans less than one full window
- WHEN adherence is computed
- THEN the function returns `level: 'insufficient_data'` and no recommendation

### Requirement: Adherence-Based Recommendation

When adherence is `low` (below `70%`), the system SHOULD suggest a **frequency reduction** expressed as a `suggestedChange` of `kind: 'reduce_frequency'` carrying `fromDays` (the current `PlanSpec.daysPerWeek`) and `toDays` (a reduced value floored at a sane minimum so `toDays >= 1` and `toDays < fromDays`). The suggestion MUST be derived deterministically from the adherence signal (no LLM in the recommendation path). If a reduction cannot be expressed (e.g. `fromDays` already at the floor), the system MUST mark adherence `low` without a `suggestedChange` rather than emitting an invalid change.

#### Scenario: Low adherence triggers a frequency reduction

- GIVEN adherence is 31% with `fromDays=4`
- WHEN the recommendation is generated
- THEN a `suggestedChange { kind: 'reduce_frequency', fromDays: 4, toDays: 3 }` is produced

#### Scenario: Reduction floored at the minimum

- GIVEN adherence is `low` with `fromDays=1`
- WHEN the recommendation is generated
- THEN adherence is reported `low` with no `suggestedChange` (cannot reduce below the floor)

### Requirement: User Confirmation

Adherence-based changes MUST be presented as **suggestions requiring explicit user confirmation**; auto-apply and silent regeneration are forbidden and no code path may regenerate a plan without a user action. On **accept**, the plan MUST be regenerated through the EXISTING regenerate path (`POST /plan-specs/:id/regenerate`) with `PlanSpec.daysPerWeek` adjusted to `toDays`, consuming exactly one `plan_regeneration` unit at the existing billing gate. On **reject**, the current plan MUST remain unchanged and NOTHING MUST be consumed. If the `plan_regeneration` quota is exhausted at confirm time, the request MUST fail with a clear error and the plan MUST remain unchanged (no partial regeneration, no quota deduction beyond the existing gate's behavior).

#### Scenario: User rejects adaptation

- GIVEN an adherence recommendation is shown
- WHEN the user rejects it
- THEN the current plan remains unchanged and no quota is consumed

#### Scenario: User accepts adaptation

- GIVEN an adherence recommendation suggesting `4 → 3` days for `planSpecId`
- WHEN the user accepts
- THEN the plan is regenerated via the existing `POST /plan-specs/:id/regenerate` with `daysPerWeek=3`, consuming exactly one `plan_regeneration` unit

#### Scenario: Accept with exhausted quota fails safely

- GIVEN a Free tenant that has already consumed its monthly `plan_regeneration` unit
- WHEN the user accepts the recommendation
- THEN the request fails with a clear quota-exhausted error and the current plan remains unchanged

#### Scenario: No auto-apply path exists

- GIVEN a `low` adherence recommendation is computed at read time
- WHEN no user confirmation occurs
- THEN no regeneration runs and no quota is consumed

### Requirement: Shared Adaptation Recommendation Contract

The system MUST define a single shared `AdaptationRecommendation` contract (in `packages/contracts`) carrying a `source` discriminator (`'adherence'` populated now; `'rpe'` reserved for 14b), a `level` (`'ok' | 'low' | 'insufficient_data'`), an optional `suggestedChange` (present only when `level === 'low'` and a change is worth suggesting), an optional `adherence` snapshot (`{ adherence, periodWeeks, completedInWindow, plannedInWindow }`), an optional `rationaleKey` (an i18n key, never raw prose), and an optional `planSpecId` (the spec to regenerate on confirm). Both 14a and 14b MUST compose into ONE dashboard surface via this contract — never two competing banners. A banner MUST render only when `level === 'low'`; `ok` and `insufficient_data` MUST render no banner.

#### Scenario: Adherence populates the shared contract

- GIVEN a `low` adherence result
- WHEN the recommendation is assembled
- THEN it carries `source: 'adherence'`, `level: 'low'`, a `suggestedChange`, an `adherence` snapshot, a `rationaleKey`, and the `planSpecId` to regenerate

#### Scenario: RPE source reserved without breaking 14a

- GIVEN the contract defines `source: 'adherence' | 'rpe'`
- WHEN 14a emits only `'adherence'`
- THEN the shape remains valid for a later 14b `'rpe'` recommendation feeding the same banner slot

### Requirement: On-Demand Read Surface

The recommendation MUST be exposed on an on-demand, tenant/user-scoped read (folded into the dashboard summary read or a small `GET /adaptation/adherence`), computed each time from the already-fetched completion history plus the latest ready plan. The read MUST consume NO billing quota and MUST be available to all tiers. No scheduler, cron, background job, or event queue may be introduced.

#### Scenario: Recommendation read consumes no quota

- GIVEN any authenticated user (any tier)
- WHEN the adherence recommendation is read
- THEN the recommendation is returned and no billing unit is consumed

#### Scenario: Read is computed on demand

- GIVEN the dashboard/adaptation read is requested
- WHEN it is served
- THEN the recommendation is recomputed from already-fetched data with no background job or scheduler involved

### Requirement: Frequency-Only Adjustment in Slice 1

In this slice the only adaptation the system MAY suggest is a frequency reduction (`daysPerWeek`). Volume reduction, per-session de-load, and intensity tuning are out of scope and MUST NOT be suggested or applied.

#### Scenario: Only frequency is adjusted

- GIVEN a `low` adherence recommendation
- WHEN a `suggestedChange` is produced
- THEN its `kind` is `reduce_frequency` and no volume/de-load change is emitted

### Requirement: Preserve the No-Missed Day State

Adherence MUST be represented as a separate percentage/banner and MUST NOT add a `"missed"` value to `WeeklyDayStatus`, which remains `"done" | "active" | "rest" | "soon"`. The week board MUST be left untouched by this change.

#### Scenario: Week board unchanged

- GIVEN low adherence is detected
- WHEN the dashboard renders
- THEN `WeeklyDayStatus` gains no `"missed"` state and the week board is unchanged; adherence appears only as a separate banner/percentage

### Requirement: Web Adherence Suggestion Surface

The web dashboard MUST render the adherence suggestion as a banner on `DashboardCoachCard` when `level === 'low'`, with an accept action that regenerates via the existing `regeneratePlan` client (reduced days) and a reject action that leaves the plan unchanged. The surface MUST handle loading, empty/no-recommendation (`ok`), insufficient-data, and regenerate-error states, and MUST NOT introduce a new generation entry point.

#### Scenario: Banner renders on low adherence

- GIVEN a `low` adherence recommendation for the current user
- WHEN the web dashboard loads
- THEN the coach card shows the suggestion banner with accept and reject actions

#### Scenario: No banner when ok or insufficient data

- GIVEN `level` is `ok` or `insufficient_data`
- WHEN the web dashboard loads
- THEN no suggestion banner is shown

#### Scenario: Loading state while the read resolves

- GIVEN the adherence read is in flight
- WHEN the web dashboard renders
- THEN a loading affordance is shown and no premature banner/action appears

#### Scenario: Regenerate error surfaced without corrupting the plan

- GIVEN the user accepts and the regenerate call fails (e.g. quota exhausted or network error)
- WHEN the error returns
- THEN a clear error is shown, the plan remains unchanged, and the user may retry

### Requirement: Mobile Adherence Suggestion Surface

The mobile app (Expo RN) MUST render the adherence suggestion banner on the Home/dashboard when `level === 'low'`, with accept wired to the ported RN regenerate flow (its Track C prerequisite) and reject leaving the plan unchanged. It MUST reuse the shared API and the `adaptation` i18n namespace, apply the same confirm-only quota and no-quota-on-read rules as web, and handle loading, empty/insufficient-data, error, and offline states.

#### Scenario: Mobile banner confirms via the ported regenerate flow

- GIVEN a `low` adherence recommendation on mobile with the RN regenerate flow available
- WHEN the user accepts
- THEN the plan regenerates through the ported RN regenerate flow with the same confirm-only quota behavior as web

#### Scenario: Offline read degrades gracefully

- GIVEN the mobile device is offline
- WHEN the adherence surface is opened
- THEN it shows an offline/error state without crashing and no regeneration is attempted

### Requirement: Coaching Tone and Internationalization

All adherence copy MUST live in a new `adaptation` i18n namespace with EN/ES parity and MUST be framed as an optional suggestion (coaching tone), never a diagnosis or judgment about the user. Rationale MUST be referenced by i18n key (`rationaleKey`), never raw prose in the contract or domain layer.

#### Scenario: EN/ES parity and coaching tone

- GIVEN the `adaptation` namespace
- WHEN copy is rendered in EN or ES
- THEN both locales have parity and the suggestion is phrased as an option (e.g. "Want to try 3 days/week?"), not a diagnosis

### Requirement: Boundaries and Security

The recommendation logic MUST be pure domain code (no I/O, no LLM); the API MUST aggregate and the route MUST orchestrate; web/mobile MUST only render. The LLM MUST stay confined to the existing regenerate → generate path. Every read MUST be tenant- and user-scoped from `authContext`; tenant/user/tier values supplied in the request body MUST be ignored. The recommendation read MUST be available to all tiers; the quota'd, confirmed regenerate remains the only billed action.

#### Scenario: Body identity spoof ignored

- GIVEN a request supplies a tenant/user/tier in its body
- WHEN the adherence read or confirm resolves identity
- THEN identity is taken only from `authContext`, the body values are ignored, and scoping is enforced to the authenticated tenant/user

#### Scenario: Recommendation path uses no LLM

- GIVEN the adherence recommendation is computed
- WHEN it is produced
- THEN no LLM call occurs in the recommendation path; the LLM runs only if the user confirms, via the existing regenerate → generate path

## Notes

- **Window default**: the fixed behavior is a configurable rolling window with default 4 weeks and a `< 70%` low threshold. Shipped as `periodWeeks` default 4, pinned in code as a parameter (satisfies "configurable period"); no per-user configurability shipped in this slice.
- **Frequency floor**: `toDays = max(1, fromDays - 1)`; `suggestedChange` emitted only when `toDays < fromDays`, so a plan already at 1 day/week reports `low` with no actionable change.
- **Read-surface shape**: the recommendation is folded into `DashboardSummaryDTO` (via the existing `GET /progress/dashboard`) rather than a dedicated endpoint — zero extra DB round-trip, tenant/user-scoped, on-demand, no-quota read.
- **Confirm route**: `POST /plan-specs/:id/adapt` is a new, server-authoritative confirm route that re-derives `toDays` itself (never trusts the body), persists via a narrow `updateSpecDaysPerWeek`, gates on `plan_regeneration` (consume-before-write), and calls the existing `startGeneration`. A stale/forged accept (adherence recovered, or a non-`low` state) returns `409 no_adaptation`; quota-exhausted returns `403` with the plan left unchanged. The idempotency key is a fresh nonce per accept (not a stable key), so a repeated accept during the async generation window costs its own quota unit rather than replaying a free extra regeneration.
- **Mobile sequencing**: the mobile banner (Track D) depended on the RN plan/regenerate port (Track C, itself split into C1 client / C2 plan-status screen / C3 nav+dashboard-fetch entry point); web (Tracks A+B) shipped independently and first.
