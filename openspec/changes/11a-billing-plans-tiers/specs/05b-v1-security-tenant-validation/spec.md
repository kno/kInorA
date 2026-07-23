# Delta for 05b-v1-security-tenant-validation

## MODIFIED Requirements

### Requirement: Tenant Isolation Enforcement

Every authenticated request MUST be scoped to the active tenant, and cross-tenant access MUST be rejected. Billing state, member allocations, metering, entitlement checks, and admin overrides MUST read and write only the active tenant. User membership in another tenant MUST NOT move or expose quota/usage across tenants.
(Previously: tenant isolation applied generically without billing-specific enforcement.)

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

### Requirement: Secure Defaults

Unauthenticated, ambiguous, missing, failed billing authorization, or suspended/revoked/inactive membership MUST fail closed rather than exposing data, permitting quota management, or starting cost-bearing work. Product entitlement denial is distinct from technical AI retrieval fail-open: memory retrieval outages MAY continue without memory only after entitlement is allowed.
(Previously: secure defaults did not distinguish entitlement denial from technical fallback.)

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

## ADDED Requirements

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
