# 08-v1-ai-plan-generation Specification

## Purpose

Generate personalized workout plans via LLM from a `PlanSpec`, ensuring safe substitutions and warning-only health limitation handling — never diagnosing or hard-blocking.

## Requirements

### Requirement: Plan Generation from PlanSpec

The system MUST accept a `PlanSpec` and produce a structured workout plan (exercises, sets, reps, rest periods, weekly schedule) using an LLM.

#### Scenario: Full plan generation

- GIVEN a `PlanSpec` with goal="hypertrophy", frequency=4, equipment="dumbbells only"
- WHEN the generation endpoint is called
- THEN a weekly plan with 4 sessions, dumbbell exercises, and hypertrophy rep ranges (8-12) is returned

#### Scenario: Empty PlanSpec edge case

- GIVEN an empty or incomplete `PlanSpec`
- WHEN the generation endpoint is called
- THEN the system returns a validation error before calling the LLM

### Requirement: Safe Substitutions and Limitations

The system MUST substitute exercises when equipment is unavailable and MUST flag user limitations as warnings/suggestions. It MUST NOT diagnose or hard-block.

#### Scenario: Substitution for missing equipment

- GIVEN equipment="none (bodyweight only)" and the generated plan includes "pull-ups"
- WHEN the system detects the equipment mismatch
- THEN it substitutes a bodyweight alternative (e.g., "inverted rows") and notes the substitution

#### Scenario: Limitation warning, not block

- GIVEN a user limitation of "lower back pain"
- WHEN generating the plan
- THEN the plan includes a warning: "Consult a professional before attempting" but still produces the plan

#### Scenario: No medical diagnosis

- GIVEN any user-reported physical limitation
- WHEN the plan is generated
- THEN the output MUST NOT contain diagnostic language (e.g., "you have X condition")
