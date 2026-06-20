# 14b-v1.1-adaptation-rpe-feedback Specification

## Purpose

Adapt plan intensity from RPE trends and explicit user feedback.

## Dependencies

- `09a-v1-workout-tracking-core`
- `14a-v1.1-adaptation-adherence`

## Requirements

### Requirement: RPE Trend Adaptation

The system SHOULD recommend intensity adjustments when average RPE is consistently outside the target zone of 6-8.

#### Scenario: RPE too high

- GIVEN a user averages RPE 9 across the last 8 sessions
- WHEN the adaptation check runs
- THEN the system recommends reducing working weight or increasing rest periods

### Requirement: Feedback Integration

The system MUST collect feedback values such as too easy, too hard, or just right.

#### Scenario: Feedback changes next block

- GIVEN a user rates 3 consecutive sessions as too easy
- WHEN the next block is generated
- THEN it includes progressive overload suggestions

### Requirement: Safe Adaptation Boundaries

Adaptations MUST NOT override warning-only limitation guidance or present medical diagnosis.

#### Scenario: Limitation warning preserved

- GIVEN a suggested progression conflicts with a declared limitation
- WHEN the recommendation is shown
- THEN the system includes a warning and safer alternatives
