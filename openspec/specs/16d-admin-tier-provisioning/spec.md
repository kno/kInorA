# 16d Admin Tier Provisioning Specification

## Purpose

Superadmin-gated grant and revoke of the `trainer`/`gym` billing tier for a tenant, implemented
as a `tenant_billing_overrides` write path. An active override is tier-authoritative
(`resolveEffectiveTier` gives it unconditional precedence over `tenant_billing_states`), so
granting requires no Stripe webhook change. This spec covers the API/domain write path and its
audit trail; the backoffice UI is out of scope (tracked separately as #306).

## Requirements

### Requirement: Superadmin Grant of Tier Override

The system MUST allow a global superadmin (`users.is_admin = true`) to grant the `trainer` or
`gym` tier to a tenant by inserting an active `tenant_billing_overrides` row, transactionally
paired with a `billingAuditEvents` row of action `admin_override_created`.

#### Scenario: Grant trainer tier to a tenant

- GIVEN a superadmin and a tenant with no active override
- WHEN the superadmin grants tier `trainer` with a reason and an open-ended lifecycle
- THEN an active `tenant_billing_overrides` row is created for that tenant with `tier = trainer`
- AND `resolveEffectiveTier` for that tenant returns `tier: trainer, source: admin_override`
- AND an `admin_override_created` audit row is written referencing the acting superadmin

#### Scenario: Grant gym tier to a tenant

- GIVEN a superadmin and a tenant with no active override
- WHEN the superadmin grants tier `gym` with a reason
- THEN an active `tenant_billing_overrides` row is created with `tier = gym`
- AND `resolveEffectiveTier` for that tenant returns `tier: gym, source: admin_override`

#### Scenario: Non-admin is denied

- GIVEN an authenticated user with `is_admin = false`
- WHEN that user calls the grant endpoint for any tenant
- THEN the system MUST respond 403
- AND no `tenant_billing_overrides` row and no audit row are written

#### Scenario: Superadmin with no membership in the target tenant can grant

- GIVEN a superadmin with zero `memberships` rows for the target tenant
- WHEN the superadmin grants a tier to that tenant
- THEN the grant succeeds and the audit insert succeeds (the audit actor FK is a plain
  `users.id` reference, not a tenant-membership composite FK)

### Requirement: Audit Actor FK Is Not Tenant-Scoped

`billingAuditEvents.actorUserId` MUST reference `users.id` directly (no composite
`(tenantId, userId) → memberships` requirement), so a global superadmin acting on a tenant they
are not a member of can be recorded as the audit actor. This MUST be an additive, backward
compatible migration.

#### Scenario: Existing member-allocation audit writes are unaffected

- GIVEN the existing `writeMemberAllocation` flow that writes `member_allocation_set` audit rows
  for an actor who IS a tenant member
- WHEN the audit-FK migration is applied
- THEN `writeMemberAllocation` continues to insert audit rows successfully with no behavior change

### Requirement: Grant Validation

The system MUST validate grant input before writing the override: `tier` MUST be one of
`trainer` or `gym` (`free`/`pro` MUST be rejected), `reason` MUST be a non-empty string
(`reason` is `NOT NULL`), and `endsAt` MUST be strictly greater than `startsAt`. An open-ended
grant MUST be represented as a far-future sentinel `endsAt` (not NULL, since the column is
`NOT NULL`).

#### Scenario: Reject invalid tier

- GIVEN a grant request with `tier: "pro"`
- WHEN the request is submitted
- THEN the system MUST reject it without writing any row

#### Scenario: Reject missing reason

- GIVEN a grant request with an empty or missing `reason`
- WHEN the request is submitted
- THEN the system MUST reject it without writing any row

#### Scenario: Reject invalid date range

- GIVEN a grant request where `endsAt <= startsAt`
- WHEN the request is submitted
- THEN the system MUST reject it without writing any row

#### Scenario: Open-ended grant uses far-future sentinel

- GIVEN a superadmin requests an open-ended grant (no explicit end date)
- WHEN the grant is written
- THEN `endsAt` MUST be set to a far-future sentinel timestamp, never NULL

### Requirement: Overlap Guard on Grant

The system MUST reject a grant request for a tenant that already has an active override
(`startsAt <= now < endsAt`) at the time of the request. The tenant MUST have at most one
active override at a time. No row is written when the guard rejects.

#### Scenario: Reject grant when an active override already exists

- GIVEN a tenant with an existing active `tenant_billing_overrides` row
- WHEN a superadmin attempts to grant a (possibly different) tier to that tenant
- THEN the system MUST reject the request
- AND no new `tenant_billing_overrides` row and no audit row are written
- AND the existing active override remains unchanged

#### Scenario: Grant succeeds after prior override was revoked

- GIVEN a tenant whose only override has `endsAt <= now` (revoked or naturally expired)
- WHEN a superadmin grants a new tier to that tenant
- THEN the grant succeeds and a new active override row is created

### Requirement: Revoke Sets endsAt, Never Deletes

The system MUST revoke an active override by updating its `endsAt` to the current time
(`UPDATE ... SET endsAt = now()`), never by deleting the row, transactionally paired with a
`billingAuditEvents` row of action `admin_override_expired`.

#### Scenario: Revoke an active grant

- GIVEN a tenant with an active `tenant_billing_overrides` row granting `trainer`
- WHEN a superadmin revokes that tenant's override
- THEN the row's `endsAt` is set to the current time and the row is NOT deleted
- AND `resolveEffectiveTier` for that tenant no longer returns `trainer` from that override
- AND an `admin_override_expired` audit row is written

#### Scenario: Revoke when no active override exists

- GIVEN a tenant with no currently active override
- WHEN a superadmin attempts to revoke
- THEN the system MUST reject the request without writing any row

### Requirement: Composition Contract With Seat-Scaled Billing (16c)

An active tier override MUST resolve tier independently of any coexisting
`tenant_billing_states` row. When a tenant has both an active `trainer` (or `gym`) override AND a
`tenant_billing_states` row carrying a `seatCount`, `resolveEffectiveTier` MUST return the
override's tier while `seatCount` remains available as orthogonal metadata for seat-scaled limit
resolution (16c). This change MUST NOT couple tier resolution to price-to-tier mapping.

#### Scenario: Override tier coexists with seat-scaled billing state

- GIVEN a tenant with an active `trainer` override AND a `tenant_billing_states` row that carries
  `seatCount = 5`
- WHEN tier and limits are resolved for that tenant
- THEN the resolved tier is `trainer` (from the override)
- AND the `seatCount = 5` value remains intact and available to seat-scaled limit resolution

### Requirement: Grant/Revoke Audit Trail Is Idempotent Per Action

Each grant produces exactly one `admin_override_created` audit row and each revoke produces
exactly one `admin_override_expired` audit row; retrying a rejected request (validation failure,
overlap guard, non-admin) MUST NOT produce any audit row.

#### Scenario: Rejected grant produces no audit row

- GIVEN a grant request rejected by the overlap guard or by validation
- WHEN the request is processed
- THEN zero audit rows are written for that request

#### Scenario: Successful grant produces exactly one audit row

- GIVEN a valid grant request that succeeds
- WHEN the request is processed
- THEN exactly one `admin_override_created` audit row is written, atomically with the override
  insert (both succeed or both fail)
