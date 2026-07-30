# 14b-v1.1-adaptation-rpe-feedback Specification

## Purpose

Adapt plan intensity from RPE trends and explicit user feedback.

## Dependencies

- `09a-v1-workout-tracking-core`
- `14a-v1.1-adaptation-adherence`

## Requirements

### Requirement: RPE Trend Adaptation

The system MUST compute `computeRpeAdaptation` as a pure, deterministic domain function over the last `WINDOW_SESSIONS = 3` completed sessions, aggregating the mean `rpe` of completed working sets that carry a recorded `rpe`. A mean `>= 8.5` MUST mark `direction: "decrease"` (too hard); a mean `<= 5.5` MUST mark `direction: "increase"` (too easy); the `(5.5, 8.5)` band MUST produce no suggestion. When fewer than `MIN_SESSIONS_WITH_RPE = 2` sessions or `MIN_SETS_WITH_RPE = 4` rated sets are available, the function MUST return `level: 'insufficient_data'` with no suggestion. A qualifying trend MUST emit a `suggestedChange { kind: 'adjust_load', direction, from: PlanSpec.intensityBias, to }`, stepping one rung on the `reduce < maintain < increase` ladder; no suggestion is emitted at the floor/ceiling rung.

#### Scenario: High RPE trend suggests reducing load

- GIVEN the last 3 completed sessions have a mean rated RPE of 9.0 across at least 4 rated sets
- WHEN `computeRpeAdaptation` runs
- THEN it returns a `suggestedChange { kind: 'adjust_load', direction: 'decrease', to: 'reduce' }`

#### Scenario: Low RPE trend suggests increasing load

- GIVEN the last 3 completed sessions have a mean rated RPE of 5.0 across at least 4 rated sets
- WHEN `computeRpeAdaptation` runs
- THEN it returns a `suggestedChange { kind: 'adjust_load', direction: 'increase', to: 'increase' }`

#### Scenario: In-zone RPE produces no suggestion

- GIVEN the mean rated RPE across the window is 7.0
- WHEN `computeRpeAdaptation` runs
- THEN `level` is reported without a `suggestedChange`

#### Scenario: Insufficient sample yields insufficient data

- GIVEN fewer than 2 sessions have a rated set, or fewer than 4 sets carry `rpe` in the window
- WHEN `computeRpeAdaptation` runs
- THEN it returns `level: 'insufficient_data'` with no suggestion

#### Scenario: Ladder floor/ceiling suppresses suggestion

- GIVEN `PlanSpec.intensityBias` is already `"reduce"` and the trend is too hard
- WHEN `computeRpeAdaptation` runs
- THEN no `suggestedChange` is emitted (already at the floor rung)

### Requirement: RPE-Only Signal for v1 (Qualitative Feedback Deferred)

For this slice, RPE is the ONLY feedback signal driving adaptation. The system MUST NOT collect or require a separate qualitative feedback value (too easy / too hard / just right); any such surface is deferred to a future slice.

#### Scenario: No qualitative feedback surface exists

- GIVEN the RPE adaptation feature ships
- WHEN a user completes sessions
- THEN no too-easy/too-hard/just-right input is presented or required, and only per-set `rpe` drives adaptation

### Requirement: Mobile RPE Capture

The mobile workout tracker MUST let the user record an `rpe` value (0-10) per completed working set in `ExerciseCard.tsx` and MUST submit it through `WorkoutTrackerScreen.tsx`'s set-record path so RPE-driven adaptation has mobile-originated data parity with web.

#### Scenario: Mobile set submission carries rpe

- GIVEN a user completes a working set on mobile and enters an RPE value
- WHEN the set record is submitted
- THEN the submitted payload includes the entered `rpe`

#### Scenario: RPE remains optional on mobile

- GIVEN a user completes a working set without entering an RPE value
- WHEN the set record is submitted
- THEN the submission succeeds without `rpe`, and that set does not count toward the RPE sample floor

### Requirement: i18n Parity for RPE Adaptation Copy

All RPE adaptation banner copy (per `suggestedChange.kind: 'adjust_load'` and `direction`) MUST live in the existing `adaptation` i18n namespace with EN and ES parity, framed as an optional coaching suggestion.

#### Scenario: EN/ES parity for load copy

- GIVEN the `adaptation` namespace gains `adjust_load` increase/decrease copy keys
- WHEN rendered in EN or ES
- THEN both locales have matching keys and a coaching (non-diagnostic) tone

### Requirement: Safe Adaptation Boundaries

Adaptations MUST NOT override warning-only limitation guidance or present medical diagnosis.

#### Scenario: Limitation warning preserved

- GIVEN a suggested progression conflicts with a declared limitation
- WHEN the recommendation is shown
- THEN the system includes a warning and safer alternatives
