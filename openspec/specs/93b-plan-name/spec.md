# 93b-plan-name Specification

## Purpose

Capture an optional user-facing plan name end-to-end: wizard input → DB persistence →
`PlanSummary` DTO → `PlanSelector` display and plan view header. Two ready plans MUST
be distinguishable by name.

## Requirements

### Requirement: Optional Name Capture in Wizard

The plan wizard MUST accept an optional name field for the plan. When the user leaves
the field blank, the system MUST auto-generate a display name (e.g., "Plan {N}" or
date-based). The name field MUST NOT block wizard completion.

#### Scenario: User provides a name

- GIVEN a user reaches the name step of the create-plan wizard
- WHEN they enter "Push Pull Legs" and complete the wizard
- THEN the persisted plan record has `name = "Push Pull Legs"`

#### Scenario: User leaves name blank — auto-default applied

- GIVEN a user completes the wizard without entering a name
- WHEN the plan is persisted
- THEN `name` is set to a non-empty auto-generated default (not null, not empty string)

#### Scenario: Name field does not block completion

- GIVEN a user reaches the name step
- WHEN they skip the field and click the advance action
- THEN the wizard advances without error

### Requirement: Name Persisted on workout_plans

The `workout_plans` table MUST store `name VARCHAR(120)` (nullable). Existing plan rows
with `name = NULL` MUST resolve to the auto-default display value in all UI surfaces.

#### Scenario: Existing null-name plan displays auto-default

- GIVEN a plan row has `name = NULL`
- WHEN it appears in `PlanSelector` or the plan header
- THEN a non-empty default label is displayed (not "null" or empty)

### Requirement: Name Surfaced in PlanSummary DTO

The `PlanSummary` DTO returned by list and detail endpoints MUST include a `name` field.
The value MUST be the stored name when non-null, or the auto-default otherwise.

#### Scenario: List endpoint includes name

- GIVEN the user has two plans with names "Fuerza" and "Cardio"
- WHEN they call the list endpoint
- THEN each summary in the response carries the correct `name` value

#### Scenario: Detail endpoint includes name

- GIVEN a plan with `name = "Hipertrofia"`
- WHEN the detail endpoint is called
- THEN the response DTO contains `name: "Hipertrofia"`

### Requirement: Name Displayed in Selector and Header

`PlanSelector` MUST use `name` as the primary label for each option. The plan view
header MUST display the plan name. Two plans MUST be visually distinguishable by name.

#### Scenario: Selector distinguishes two plans by name

- GIVEN a user has two ready plans with distinct names
- WHEN `PlanSelector` renders
- THEN each option label reflects the respective plan name, not just date+status

#### Scenario: Selector uses auto-default for unnamed plan

- GIVEN a plan was created before this change (name = NULL)
- WHEN `PlanSelector` renders
- THEN the option shows the auto-default label

### Requirement: i18n Coverage

All new user-facing strings for the name field (label, placeholder, auto-default
pattern) MUST exist in both `en.json` and `es.json` with no hardcoded English literals.

#### Scenario: Name label sourced from catalog

- GIVEN the user's locale is `en`
- WHEN the wizard name step renders
- THEN the field label and placeholder come from `en.json`, not inline strings
