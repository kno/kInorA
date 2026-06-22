# 07-v1-plan-wizard Specification

## Purpose

Provide card-based create-plan screens that guide the user through defining a workout plan and produce a shared `PlanSpec` data structure consumed by other capabilities.

The card-mode flow is the v1 create-plan scope. Conversational create-plan and voice-assistant screens are delivered by v1.1 specs.

## Requirements

### Requirement: Wizard Step Progression

The wizard MUST present sequential steps (goal, frequency, duration, equipment, limitations) and MAY allow backward navigation.

#### Scenario: Complete wizard flow

- GIVEN a user on the wizard start screen
- WHEN they complete all steps and click "Finish"
- THEN a `PlanSpec` object is persisted to the database

#### Scenario: Back navigation preserves state

- GIVEN a user on step 4 (equipment)
- WHEN they click "Back" to step 3 (duration)
- THEN previously entered values for steps 1-3 are preserved

### Requirement: Card-Based Open Design Alignment

The create-plan screens MUST follow the card-based interaction model from the local Open Design snapshot while preserving the canonical `PlanSpec` output.

#### Scenario: Create-plan screen presents card choices

- GIVEN a user opens the v1 create-plan flow
- WHEN a step renders
- THEN the primary choices are presented as selectable cards rather than conversational prompts

### Requirement: PlanSpec Output

The wizard MUST produce a typed `PlanSpec` shared structure containing: goal, weekly frequency, session duration, available equipment, user limitations (with warning-only flag), and preference scores.

#### Scenario: Limitations flagged as suggestions

- GIVEN a user enters a physical limitation (e.g., "knee pain")
- WHEN the wizard generates a `PlanSpec`
- THEN the limitation is stored with `isWarning: true` and no medical diagnosis is attempted

#### Scenario: Partial wizard exit

- GIVEN a user exits after step 2
- WHEN they return to the wizard
- THEN they resume at step 2 with previously entered data restored
