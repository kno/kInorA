# 08-v1-ai-plan-generation Specification

## Purpose

Generate personalized workout plans via LLM from a `PlanSpec`, ensuring safe substitutions and warning-only health limitation handling — never diagnosing or hard-blocking.

## Requirements

### Requirement: Plan Generation from PlanSpec

The system MUST accept a confirmed `PlanSpec`, validate it via `assertPlanSpecShape` before any LLM call, and produce a structured `WorkoutProgram` (weekly sessions × exercises × sets/reps/rest/notes, plus substitution notes and limitation warnings) persisted as JSONB in `workout_plans`, referencing `plan_specs(id)`. The `WorkoutProgram` contract MUST be defined in `@kinora/contracts` and be forward-compatible with workout-tracking (09a session/exercise/planned-set structure).

(Previously: generation returned a plan synchronously; no persistent storage shape was specified; `WorkoutProgram` contract not defined.)

#### Scenario: Full plan generation

- GIVEN a `PlanSpec` with goal="hypertrophy", frequency=4, equipment="dumbbells only"
- WHEN the generation endpoint is called
- THEN a `WorkoutProgram` with 4 weekly sessions, dumbbell exercises, and hypertrophy rep ranges (8–12) is persisted and made available

#### Scenario: Empty PlanSpec edge case

- GIVEN an empty or incomplete `PlanSpec`
- WHEN generation is triggered
- THEN the system returns a validation error before calling the LLM
- AND no `workout_plans` row is created

---

### Requirement: Async Generation Lifecycle

The system MUST run plan generation asynchronously. When generation is triggered, a `workout_plans` row MUST be created with `status: generating` and the HTTP response MUST return immediately without blocking on the LLM call. On successful generation and parse, `status` MUST transition to `ready` and the valid `WorkoutProgram` MUST be persisted. On any LLM call or parse failure, `status` MUST transition to `failed`; no partial or invalid plan SHALL be persisted as `ready`.

#### Scenario: Trigger returns immediately with generating status

- GIVEN a confirmed `PlanSpec`
- WHEN generation is triggered (wizard confirm or explicit regenerate)
- THEN the HTTP response returns with a reference to the new plan and `status: generating`
- AND the LLM call has not yet completed

#### Scenario: Generation succeeds

- GIVEN a `workout_plans` row with `status: generating`
- WHEN the background task completes parsing and validation
- THEN the `workout_plans` row transitions to `status: ready`
- AND `program_json` holds a valid `WorkoutProgram`

#### Scenario: Generation fails

- GIVEN a `workout_plans` row with `status: generating`
- WHEN the LLM call or response parsing fails
- THEN the `workout_plans` row transitions to `status: failed`
- AND no partial plan is stored as `ready`

---

### Requirement: Auto-Trigger on Wizard Confirm and Regenerate

The system MUST automatically start generation when the user confirms the wizard (`PlanSpec` confirmed) only after active-tenant entitlement allows the operation and hybrid quota consumption succeeds for both tenant aggregate quota and `(tenantId,userId)` member allocation. A separate regenerate action MUST produce a NEW `workout_plans` row only when entitlement allows it; prior rows MUST NOT be deleted. The system MUST NOT generate a plan for an unconfirmed `PlanSpec`, denied tenant, exhausted allocation, exhausted tenant pool, or inactive membership.

#### Scenario: Wizard confirm auto-triggers generation

- GIVEN the user completes and confirms the plan wizard and hybrid entitlement allows generation
- WHEN the `POST /plan-specs` confirm flow executes
- THEN a new `workout_plans` row is created with `status: generating`
- AND the confirm response returns without waiting for LLM completion

#### Scenario: Regenerate creates a new plan row

- GIVEN a `PlanSpec` with an existing `workout_plans` row and hybrid entitlement allows regeneration
- WHEN the user triggers regenerate
- THEN a new `workout_plans` row is created with `status: generating`
- AND the prior row is retained and not deleted

#### Scenario: Unconfirmed PlanSpec is rejected

- GIVEN a `PlanSpec` that is not in confirmed state
- WHEN generation is triggered
- THEN the system returns an error and does not create a `workout_plans` row

#### Scenario: Expired trial blocks premium generation

- GIVEN a tenant's trial has expired and applicable Free quota is exhausted
- WHEN wizard confirm would trigger generation
- THEN no `workout_plans` row is created and no AI provider call starts

#### Scenario: Member allocation exhausted while tenant remains

- GIVEN tenant T has generation quota remaining but member U's allocation is exhausted
- WHEN U confirms a wizard in T
- THEN generation is denied and no tenant quota is consumed

#### Scenario: Tenant pool exhausted while member remains

- GIVEN member U has allocation remaining but tenant T's generation quota is exhausted
- WHEN U confirms a wizard in T
- THEN generation is denied and no member allocation is consumed

#### Scenario: Same user switches tenant before generation

- GIVEN user U belongs to Free tenant A and Pro tenant B
- WHEN U switches to B and confirms a PlanSpec in B
- THEN only B entitlement and U's B allocation are checked and consumed

#### Scenario: Concurrent generation requests are metered once

- GIVEN a tenant has one remaining generation and two active members have allocation
- WHEN two confirm requests race concurrently
- THEN at most one request is allowed and neither tenant nor member counters over-consume

#### Scenario: Suspended membership blocks generation

- GIVEN user U is suspended, revoked, or inactive in tenant T
- WHEN U confirms or regenerates a plan in T
- THEN generation is denied before row creation or provider work

### Requirement: Generation Metering

Generation and regeneration allowance checks MUST be idempotent per operation key and atomic with monthly tenant and member meter consumption.

#### Scenario: Idempotent retry

- GIVEN an allowed generation request is retried with the same operation key
- WHEN entitlement is checked again
- THEN the same allowed result is returned without consuming either quota again

#### Scenario: Empty operation key rejected

- GIVEN a cost-bearing generation request has no operation key
- WHEN metering would occur
- THEN the API rejects the request before consuming quota or starting AI work

---

### Requirement: Real-Time Status via WebSocket

The system MUST notify the owning user of `ready` or `failed` status transitions over an authenticated WebSocket. The WebSocket channel MUST be scoped to the authenticated tenant and user; a user MUST NOT receive plan events belonging to another user or tenant.

#### Scenario: Owner receives ready notification

- GIVEN a user has an active authenticated WebSocket connection
- WHEN their `workout_plans` row transitions to `status: ready`
- THEN that user's WebSocket receives a notification containing the plan reference and status

#### Scenario: Cross-user events are not delivered

- GIVEN user A and user B each have active WebSocket connections in the same tenant
- WHEN user A's plan becomes `ready`
- THEN user B's WebSocket does NOT receive user A's plan event

#### Scenario: Cross-tenant events are not delivered

- GIVEN user A (tenant X) and user B (tenant Y) each have active WebSocket connections
- WHEN user A's plan becomes `ready`
- THEN user B's WebSocket does NOT receive the event

---

### Requirement: Safe Substitutions and Limitations

The system MUST substitute exercises when equipment is unavailable and MUST flag user limitations as warnings. It MUST NOT produce diagnostic language. The system MUST NOT hard-block plan generation due to a reported limitation. Limitation warnings and substitution notes MUST be included in the persisted `WorkoutProgram` output (not only returned inline).

(Previously: no requirement to persist substitution notes and limitation warnings inside the `WorkoutProgram`; no explicit prohibition on hard-blocking generation due to limitations.)

#### Scenario: Substitution for missing equipment

- GIVEN equipment="none (bodyweight only)" and the generated plan includes "pull-ups"
- WHEN the system processes the plan output
- THEN it substitutes a bodyweight alternative (e.g., "inverted rows") and records the substitution note in the `WorkoutProgram`

#### Scenario: Limitation warning, not block

- GIVEN a user limitation of "lower back pain"
- WHEN generating the plan
- THEN the plan includes a warning ("Consult a professional before attempting") and still produces a complete plan
- AND the limitation warning is stored in the persisted `WorkoutProgram`

#### Scenario: No medical diagnosis

- GIVEN any user-reported physical limitation
- WHEN the plan is generated
- THEN the output MUST NOT contain diagnostic language (e.g., "you have X condition")
- AND the parser MUST reject any LLM response that contains diagnostic language, causing the generation to transition to `failed`
