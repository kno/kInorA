# 05b-v1-security-tenant-validation Specification

## Purpose

Enforce security by design through tenant isolation, input validation, and safe authorization defaults.

## Dependencies

- `01c-v1-multi-tenant-schema`
- `05a-v1-auth-core`

## Requirements

### Requirement: Tenant Isolation Enforcement

Every authenticated request MUST be scoped to the active tenant, and cross-tenant access MUST be rejected. Billing state, member allocations, metering, entitlement checks, and admin overrides MUST read and write only the active tenant. User membership in another tenant MUST NOT move or expose quota/usage across tenants.

#### Scenario: Cross-tenant access rejected

- GIVEN tenant A user and tenant B resource id
- WHEN tenant A requests tenant B's resource
- THEN the system returns HTTP 403 Forbidden

#### Scenario: Cross-tenant billing denied

- GIVEN tenant A user and tenant B billing identifier
- WHEN tenant A reads or mutates billing state
- THEN the system returns HTTP 403 and emits no tenant B details

#### Scenario: Membership does not migrate usage

- GIVEN user U leaves tenant A and joins tenant B
- WHEN quota or usage is resolved in tenant B
- THEN tenant A usage remains in A and is not copied to B

### Requirement: Boundary Validation

Every public API endpoint MUST validate body, query, and params before executing use cases.

#### Scenario: Invalid input rejected

- GIVEN a request missing required fields
- WHEN it reaches the API boundary
- THEN the response is HTTP 422 with a descriptive error payload

### Requirement: Secure Defaults

Unauthenticated, ambiguous, missing, failed billing authorization, or suspended/revoked/inactive membership MUST fail closed rather than exposing data, permitting quota management, or starting cost-bearing work. Product entitlement denial is distinct from technical AI retrieval fail-open: memory retrieval outages MAY continue without memory only after entitlement is allowed.

#### Scenario: Missing session rejected

- GIVEN a protected endpoint
- WHEN the request has no valid session
- THEN the response is HTTP 401 and no tenant data is queried

#### Scenario: Billing read failure denies paid work

- GIVEN billing state cannot be resolved authoritatively
- WHEN a premium AI operation is requested
- THEN the API denies the operation and no expensive provider call starts

#### Scenario: Denial semantics

- GIVEN entitlement is denied
- WHEN the API responds
- THEN it returns a stable denial code, safe message, and upgrade prompt metadata without leaking internals

#### Scenario: Membership suspension blocks consumption

- GIVEN user U is suspended, revoked, or inactive in tenant T
- WHEN U requests premium AI or quota management in T
- THEN the operation is denied and no quota is consumed or changed

#### Scenario: Technical memory retrieval fail-open remains separate

- GIVEN entitlement is allowed but vector retrieval times out
- WHEN AI generation continues
- THEN it proceeds without memory and records operational telemetry

### Requirement: Quota Privacy Boundary

Quota management MUST authorize only tenant billing/allocation actions and non-sensitive totals; it MUST NOT authorize access to member memories, health details, prompts, generated private content, or cross-tenant data.

#### Scenario: Trainer sees totals only

- GIVEN trainer O manages tenant T
- WHEN O views quota usage
- THEN O sees non-sensitive aggregate/member counts only

#### Scenario: Private content remains hidden

- GIVEN trainer O manages member U's allocation
- WHEN O requests U's memories, prompts, health details, or generated private content through quota surfaces
- THEN access is denied or omitted by contract

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

### Requirement: Client-to-Trainer-Tenant Read Authorization

A client MUST be able to read plan rows owned by their own `userId` inside an assigned trainer's tenant, through a single deny-by-default resolver (`resolveClientTrainerTenant`), without any change to normal login, session establishment, or the existing self-only `(tenantId, userId)` read path for any user. The resolver MUST look up the caller's client-side `trainer_client_assignments` row by `clientUserId === ctx.actorUserId`, deny (`ForbiddenOwnerAccess`, flat 403) unless a row exists with `status === "active"` and `clientUserId === ctx.actorUserId`, and otherwise return that row's trainer `tenantId`. Every downstream repository read MUST use the resolved trainer `tenantId` filtered by `ctx.actorUserId` — the `userId` filter MUST NEVER be widened to any other user's id. `selectActiveTenant` MUST remain unwired from login/session (`service.ts`, `social.ts`, `plugin.ts`); no session or login byte changes for any user, including non-client, non-trainer users.

#### Scenario: Client reads own plan in trainer's tenant

- GIVEN a client has an active assignment to trainer T, and a ready plan exists in T's tenant owned by the client's `userId`
- WHEN the client requests their trainer plan
- THEN `resolveClientTrainerTenant` returns T's `tenantId` and the plan read filtered by `(T's tenantId, ctx.actorUserId)` succeeds

#### Scenario: Client A cannot read Client B's data

- GIVEN client A and client B are both assigned to trainer T within T's tenant
- WHEN client A requests the trainer-plan read
- THEN the repository filter uses only `ctx.actorUserId` (A), so no row owned by B's `userId` can ever be returned

#### Scenario: Client cannot read beyond their assigned trainer

- GIVEN a client is assigned only to trainer T and has no assignment to trainer U
- WHEN the client attempts to read a plan located in trainer U's tenant
- THEN `resolveClientTrainerTenant` resolves only T's `tenantId` (the client's single active assignment), so no read against U's tenant is possible

#### Scenario: Revoked or missing assignment denied

- GIVEN a client's `trainer_client_assignments` row has `status` other than `"active"`, or no row exists for the client
- WHEN the client requests the trainer-plan read
- THEN `resolveClientTrainerTenant` throws `ForbiddenOwnerAccess` and the response is a flat 403 with no repository call

#### Scenario: Normal user self-only access and login unchanged

- GIVEN a user with no trainer/client relationship uses any existing self-only route, or any user logs in
- WHEN the request or login is processed
- THEN behavior is byte-identical to before this change: `selectActiveTenant` is not invoked, and self routes resolve owner strictly to `ctx.actorUserId` against the session tenant
