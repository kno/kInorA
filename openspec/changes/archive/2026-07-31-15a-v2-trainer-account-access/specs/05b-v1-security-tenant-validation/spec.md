# Delta for 05b-v1-security-tenant-validation

## ADDED Requirements

### Requirement: Actor-vs-Owner Authorization for Trainer Access

Every trainer-scoped route MUST resolve the authorized owner through a single deny-by-default resolver (`resolveAuthorizedOwner`) before any repository call. A request with no explicit client parameter, or one naming the caller, MUST resolve to the caller (self path), identical to today's behavior. A request naming a different owner MUST be denied unless the actor's role is `trainer`, the active tenant's billing tier is `trainer`, AND an `active` `trainer_client_assignments` row links the actor to the requested owner in that tenant. Repositories MUST keep their existing `(tenantId, userId)` filter unchanged; the resolver never hands them an unauthorized owner.

#### Scenario: Self path unchanged for normal users

- GIVEN a `member` request carries no client parameter
- WHEN `resolveAuthorizedOwner` runs
- THEN it returns the caller's own `userId`, matching pre-existing self-only behavior

#### Scenario: Non-trainer cannot widen to another user

- GIVEN a `member` requests a resource naming a different `userId`
- WHEN `resolveAuthorizedOwner` runs
- THEN it throws and no repository call occurs

#### Scenario: Trainer without entitlement denied widening

- GIVEN an actor has `role: "trainer"` but the tenant's billing tier is not `trainer`
- WHEN they request a named client's resource
- THEN `resolveAuthorizedOwner` throws and no repository call occurs

#### Scenario: Trainer with entitlement but no assignment denied

- GIVEN an actor is an entitled trainer with no active assignment to requested client X
- WHEN they request X's resource
- THEN `resolveAuthorizedOwner` throws and no repository call occurs

#### Scenario: Trainer with active assignment permitted

- GIVEN an actor is an entitled trainer with an active assignment to client C
- WHEN they request C's resource
- THEN `resolveAuthorizedOwner` returns C's `userId` and the unchanged `(tenantId, userId)` repository filter executes
