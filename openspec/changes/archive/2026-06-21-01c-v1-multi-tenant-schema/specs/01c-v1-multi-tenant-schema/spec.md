# Delta for 01c-v1-multi-tenant-schema

## ADDED Requirements

### Requirement: Tenant Membership Primitives

The first persistence schema MUST model tenants, users, and user-to-tenant memberships or associations suitable for future Trainer and B2B access.

#### Scenario: Membership schema supports shared tenant access

- GIVEN the first database migration is applied
- WHEN tenant, user, and membership structures are inspected
- THEN users can be associated with one or more tenants through explicit membership records
- AND membership records identify the tenant and user they connect

#### Scenario: User model is not a single-tenant shortcut

- GIVEN the schema supports future Trainer or B2B access
- WHEN user ownership is inspected
- THEN tenant access is represented through associations rather than only a required user tenant field

### Requirement: Persistence Dependency Boundaries

Database dependencies MUST be allowed only inside API infrastructure and MUST NOT be imported by domain or shared contracts.

#### Scenario: API infrastructure may use database packages

- GIVEN API infrastructure implements persistence
- WHEN dependency guards evaluate database package usage
- THEN database dependencies are permitted for API persistence code

#### Scenario: Domain and contracts reject database packages

- GIVEN domain or contracts code imports database packages or schema
- WHEN dependency checks run
- THEN the checks fail before the change can be accepted

### Requirement: Auth Integration Handoff

This change MUST provide tenant primitives for downstream auth but MUST NOT implement full Auth.js sign-up or session integration.

#### Scenario: Auth slice receives tenant primitives

- GIVEN `05a-v1-auth-core` implements sign-up and sessions later
- WHEN it needs tenant provisioning or session tenant context
- THEN it can build on the 01c tenant, user, and membership primitives

#### Scenario: Full auth remains out of scope

- GIVEN this change is implemented
- WHEN Auth.js sign-up or session flows are inspected
- THEN complete auth integration is deferred to `05a-v1-auth-core`

## MODIFIED Requirements

### Requirement: Tenant-Scoped Data Model

All user-owned persisted data MUST include tenant scope from the first migration. Tenant scope MAY be represented by a required tenant column or by a documented required tenant association through membership/ownership primitives.
(Previously: User-owned persisted data only required tenant scope from the first migration.)

#### Scenario: Tenant field exists on user data

- GIVEN the first database migration is applied
- WHEN user-owned tables are inspected
- THEN each table has a required tenant scope column or documented tenant association

#### Scenario: First migration creates tenant foundation

- GIVEN no persistence schema exists yet
- WHEN the first migration is applied
- THEN tenant-owned persistence starts with tenant-aware structures

### Requirement: Tenant Provisioning

The system MUST expose lower-level tenant provisioning primitives usable by future sign-up flows, while full user registration integration SHALL be completed by `05a-v1-auth-core`.
(Previously: The system created a tenant directly when a first-time user signed up.)

#### Scenario: New tenant creation

- GIVEN a downstream auth flow creates a first-time user without tenant context
- WHEN it invokes the tenant provisioning primitive successfully
- THEN a unique tenant is created and associated with the user

#### Scenario: Auth integration deferred

- GIVEN this 01c change is complete
- WHEN full Auth.js registration behavior is required
- THEN implementation responsibility belongs to `05a-v1-auth-core`

### Requirement: Tenant Query Contract

Every repository query for tenant-owned data MUST receive tenant context explicitly and MUST fail before reaching persistence when tenant context is missing.
(Previously: Repository queries required explicit tenant context.)

#### Scenario: Query without tenant rejected

- GIVEN a repository method for tenant-owned data
- WHEN it is called without tenant context
- THEN the call fails before reaching persistence

#### Scenario: Query with tenant context proceeds

- GIVEN a repository method for tenant-owned data
- WHEN it is called with valid tenant context
- THEN the repository may execute the tenant-scoped persistence operation
