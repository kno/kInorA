# 15a-v2-trainer-account-access Specification

## Purpose

Trainer role, same-tenant client assignment, client-owned plan creation, and the actor-vs-owner authorization model that lets an entitled trainer act on an assigned client's training data without weakening the default self-only access path. Supersedes the earlier roadmap placeholder spec for this capability.

## Dependencies

- `01c-v1-multi-tenant-schema`
- `05b-v1-security-tenant-validation`
- `11a-v1-billing-plans-tiers`

## Requirements

### Requirement: Trainer Role and Entitlement Gating

The system MUST support a `trainer` value in `memberships.role`. The trainer capability MUST require BOTH the actor's `role === "trainer"` for the active tenant AND an active `trainer` BillingTier entitlement resolved via `resolveEffectiveTier`. The capability MUST be denied if either condition is not met.

#### Scenario: Trainer role without entitlement denied

- GIVEN a user has `role: "trainer"` in their tenant but the tenant's billing tier is not `trainer`
- WHEN they attempt any trainer-scoped action
- THEN the request is denied and no client data is accessed

#### Scenario: Trainer entitlement without role denied

- GIVEN a tenant resolves to `trainer` billing tier but the acting user's membership role is `member`
- WHEN they attempt a trainer-scoped action
- THEN the request is denied

#### Scenario: Both role and entitlement present grants capability

- GIVEN a user has `role: "trainer"` and the tenant resolves to `trainer` billing tier
- WHEN they invite a client or create a client-owned plan
- THEN the action is permitted, subject to assignment checks

### Requirement: Same-Tenant Client Assignment

Clients MUST join the trainer's tenant via a second `memberships` row (`invited` -> `active`) plus a `trainer_client_assignments` row. Each client MUST have at most one active trainer assignment, enforced at the data layer.

#### Scenario: Invite creates assignment

- GIVEN a trainer invites a client by email
- WHEN the client accepts
- THEN the client's membership in the trainer's tenant transitions `invited -> active` and an `active` `trainer_client_assignments` row links trainer and client

#### Scenario: One trainer per client enforced

- GIVEN client C already has an active assignment to trainer T1
- WHEN trainer T2 attempts to create an active assignment for client C
- THEN the data layer rejects the second active assignment via its unique constraint

#### Scenario: Trainer sees only own clients

- GIVEN trainer T1 and trainer T2 have different assigned clients
- WHEN T1 lists clients
- THEN only clients with an active assignment to T1 appear

### Requirement: Client-Owned Plan Creation

An entitled, assigned trainer MUST be able to create a PlanSpec/WorkoutPlan whose owner (`userId`) is the assigned client, not the trainer. The client MUST be able to see and execute plans created for them.

#### Scenario: Trainer creates client-owned plan

- GIVEN trainer T has an active assignment to client C
- WHEN T creates a plan for C
- THEN the plan is persisted with `userId = C` and C can see and execute it

#### Scenario: Non-assigned client rejected

- GIVEN trainer T has no active assignment to user X
- WHEN T attempts to create a plan for X
- THEN the request is denied and no plan is created

### Requirement: Minimum-Necessary Trainer Data Access

An assigned trainer MUST reach only the client's training-relevant data: PlanSpec, WorkoutPlan, WorkoutSession/session records, and the training-relevant fields of the client's profile/preferences used to build a plan. The trainer MUST NOT reach the client's billing state, auth/session/credential rows, or vector-memory rows through any trainer-scoped path.

#### Scenario: Trainer cannot read client billing or auth data

- GIVEN trainer T has an active assignment to client C
- WHEN T calls any trainer-scoped endpoint
- THEN no route resolves C's billing state, sessions, credentials, or memory vectors on T's behalf

### Requirement: Deferred — Client-Facing View of Trainer-Built Plans

(Deferred: full client-side UX for viewing trainer-built plans depends on active-tenant selection at login/session-switch, which this change enables minimally but does not deliver a dedicated surface for. A dedicated client-facing view is deferred to a follow-up change.)

#### Scenario: Client sees trainer-built plan under minimal enablement

- GIVEN a client's active session is scoped to the trainer's tenant
- WHEN the client requests their plans
- THEN trainer-built plans owned by the client appear, using only the minimal active-tenant-selection enabler shipped in this change

**Note**: This capability's `trainer` value in `memberships.role` (who may act) is distinct from 11a's pre-existing "trainer-managed tenant" concept (a tenant *type* whose `owner` administers member quotas). The two do not conflate: a tenant `owner` need not hold the `trainer` role, and a `trainer`-role actor need not be a tenant `owner`.
