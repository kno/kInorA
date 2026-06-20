# 14a-v1.1-adaptation-adherence Specification

## Purpose

Adapt future plans from workout adherence while keeping recommendations explainable and user-confirmed.

## Dependencies

- `09b-v1-workout-offline-history`

## Requirements

### Requirement: Adherence Tracking

The system MUST compare completed sessions against planned sessions over a configurable period.

#### Scenario: Low adherence detected

- GIVEN a user completed 5 of 16 planned sessions in 4 weeks
- WHEN the adherence check runs
- THEN the system marks adherence as low

### Requirement: Adherence-Based Recommendation

The system SHOULD recommend lower frequency or volume when adherence drops below 70%.

#### Scenario: Low adherence triggers adjustment

- GIVEN adherence is 31%
- WHEN recommendations are generated
- THEN the system suggests reducing frequency from 4 to 3 days per week

### Requirement: User Confirmation

Adherence-based changes MUST be presented as suggestions requiring user confirmation.

#### Scenario: User rejects adaptation

- GIVEN an adherence recommendation is shown
- WHEN the user rejects it
- THEN the current plan remains unchanged
