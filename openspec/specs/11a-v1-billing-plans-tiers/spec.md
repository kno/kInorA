# 11a-v1-billing-plans-tiers Specification

## Purpose

Define launch billing tiers, 30-day Pro trial behavior, hybrid tenant/member quota gating, owner/trainer quota administration, admin overrides, and upgrade prompts without external payment dependency.

## Dependencies

- `05b-v1-security-tenant-validation`

## Requirements

### Requirement: Plan Tiers

The system MUST maintain one authoritative tenant-owned billing state for personal and trainer-managed tenants with tier `free` or `pro`, status `active`, `trialing`, `expired`, or `overridden`, and source `system`, `backfill`, or `admin_override`. Free MUST allow each tenant 1 plan generation per calendar month, 1 regeneration per calendar month, and 0 premium vector-memory AI writes/retrievals. 11a MUST NOT model Stripe, checkout, webhooks, invoices, coupons, tax, or payment methods.

#### Scenario: Free tier access

- GIVEN a personal or trainer-managed tenant has tier `free` and no active trial or override
- WHEN an active member requests non-premium app features in that tenant
- THEN access is allowed and premium AI capabilities show upgrade prompts

#### Scenario: Same user in Free and Pro tenants

- GIVEN one user belongs to Free tenant A and Pro tenant B
- WHEN they switch active tenant and request premium AI
- THEN entitlement is evaluated only from the active tenant's billing state

#### Scenario: Free AI limit boundary

- GIVEN a Free tenant has used 0 generations and 0 regenerations this month
- WHEN one active member requests one generation and one regeneration
- THEN both are allowed and metered once against that tenant and member

#### Scenario: Free AI limit exceeded

- GIVEN a Free tenant has already used its monthly generation quota
- WHEN another generation is requested in that tenant
- THEN it is denied with reason `tenant_quota_exhausted` and no AI work starts

#### Scenario: Stripe concepts excluded

- GIVEN 11a billing state is read or written
- WHEN the contract is inspected
- THEN it contains no provider payment identifiers or checkout workflow fields

### Requirement: Trial Period

Tenant creation MUST start a 30-day Pro trial for each newly created tenant, personal or trainer-managed. Trial expiry MUST preserve tenant data, member allocations, plans, memories, and history while blocking premium AI generation/regeneration beyond Free limits and premium vector-memory AI use.

#### Scenario: Trial starts at tenant creation

- GIVEN a personal or trainer-managed tenant is created at time T
- WHEN billing state is resolved
- THEN it is `pro`/`trialing` with `trial_started_at=T` and `trial_ends_at=T+30 days`

#### Scenario: Trial expiration

- GIVEN a tenant's trial ended one second ago
- WHEN an active member accesses a premium AI feature
- THEN the feature is blocked with a subscribe-to-continue prompt

#### Scenario: Expiry preserves data

- GIVEN an expired trial tenant has plans, progress, memories, and allocations
- WHEN billing state downgrades to Free
- THEN existing records remain readable/manageable and are not deleted

#### Scenario: Exact expiry boundary

- GIVEN current time equals `trial_ends_at`
- WHEN entitlement is evaluated
- THEN trial access is expired and Free limits apply

### Requirement: Billing State Visibility

The UI and API SHOULD expose tenant tier, status, trial end, active override end, denial reason, upgrade prompt destination, tenant usage total, and requesting member allocation usage without exposing provider-specific payment concepts or other members' private content.

#### Scenario: Active trial badge

- GIVEN a tenant is inside the 30-day trial
- WHEN the account area or sidebar loads
- THEN remaining trial state and Pro-trial badge are visible

#### Scenario: Empty billing state is backfilled

- GIVEN an existing tenant has no billing row
- WHEN billing state is requested after migration
- THEN a deterministic Free state exists with source `backfill`

#### Scenario: Tenant switching refreshes billing

- GIVEN a user belongs to multiple tenants
- WHEN they switch active tenant
- THEN badges, quota totals, and prompts refresh from the new tenant only

### Requirement: Hybrid Tenant Quotas

Premium AI operations MUST atomically check and consume both tenant aggregate quota and `(tenantId,userId)` member allocation. Usage MUST remain isolated per pair and MUST NOT migrate with membership changes.

#### Scenario: Member allocation exhausted while tenant remains

- GIVEN tenant T has quota remaining but member U has no allocation remaining
- WHEN U requests premium AI in T
- THEN the request is denied with reason `member_allocation_exhausted`

#### Scenario: Tenant pool exhausted while member remains

- GIVEN member U has allocation remaining but tenant T has no quota remaining
- WHEN U requests premium AI in T
- THEN the request is denied with reason `tenant_quota_exhausted`

#### Scenario: Concurrent members race final tenant unit

- GIVEN tenant T has one aggregate unit and two members each have allocation
- WHEN both consume concurrently
- THEN at most one succeeds and neither counter is over-consumed

#### Scenario: Idempotent quota consumption retry

- GIVEN an allowed premium operation consumed quota with operation key K
- WHEN the request is retried with K
- THEN the prior result is returned without consuming either counter again

### Requirement: Member Quota Administration

Tenant owners/trainers MUST configure per-member allocations within plan bounds and view non-sensitive usage totals only. Quota management MUST NOT authorize access to member memories, health details, prompts, generated private content, or cross-tenant data.

#### Scenario: Authorized trainer changes allocation

- GIVEN trainer O owns tenant T and member U is active in T
- WHEN O sets U's allocation within plan bounds
- THEN the allocation changes and an audit record is written

#### Scenario: Unauthorized member quota edit rejected

- GIVEN member U is not an owner/trainer of tenant T
- WHEN U edits their own or another member's allocation
- THEN the request is rejected and allocation is unchanged

#### Scenario: Trainer privacy boundaries

- GIVEN trainer O views tenant usage totals
- WHEN totals are returned
- THEN they contain aggregate counts only and no memories, prompts, health details, or private generated content

#### Scenario: Inactive membership blocks management

- GIVEN member U is suspended, revoked, or inactive in tenant T
- WHEN allocation is changed for U
- THEN consumption remains blocked and management follows the membership policy without exposing private data

### Requirement: Safe Backfill

The system MUST backfill existing tenants idempotently to Free without granting retroactive trials unless an existing tenant trial start is known.

#### Scenario: Backfill idempotency

- GIVEN a tenant already has billing state
- WHEN migration/backfill runs twice
- THEN exactly one authoritative tenant state remains

#### Scenario: Existing tenant migration

- GIVEN an existing tenant without billing state
- WHEN backfill runs
- THEN Free active state is created and tenant data is unchanged

### Requirement: Admin Overrides

Admin overrides MUST be tenant-scoped, audited, time-limited, and SHALL expire automatically back to the underlying tenant state.

#### Scenario: Active override allows Pro

- GIVEN a Free tenant has an audited Pro override expiring tomorrow
- WHEN premium entitlement is checked
- THEN access is allowed with source `admin_override`

#### Scenario: Override expiry

- GIVEN an override ended at time T
- WHEN entitlement is checked after T
- THEN the override is ignored and the underlying state applies

#### Scenario: Unauthorized override rejected

- GIVEN a non-admin or cross-tenant actor
- WHEN they attempt to create an override
- THEN the request is rejected and no override changes state

**Note**: "trainer" denotes the tenant `owner` of a trainer-managed tenant; 11a has no distinct `trainer` role (`membership_role` is `owner`/`member`), so owner-only enforcement for quota administration is a faithful reading of this spec, not a gap.
