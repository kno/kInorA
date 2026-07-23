# Delta for 08-v1-ai-plan-generation

## MODIFIED Requirements

### Requirement: Auto-Trigger on Wizard Confirm and Regenerate

The system MUST automatically start generation when the user confirms the wizard (`PlanSpec` confirmed) only after active-tenant entitlement allows the operation and hybrid quota consumption succeeds for both tenant aggregate quota and `(tenantId,userId)` member allocation. A separate regenerate action MUST produce a NEW `workout_plans` row only when entitlement allows it; prior rows MUST NOT be deleted. The system MUST NOT generate a plan for an unconfirmed `PlanSpec`, denied tenant, exhausted allocation, exhausted tenant pool, or inactive membership.
(Previously: confirm/regenerate triggered generation without billing entitlement checks.)

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

## ADDED Requirements

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
