# Delta for 11a-v1-billing-plans-tiers

## MODIFIED Requirements

### Requirement: Plan Tiers

The system MUST maintain one authoritative tenant-owned billing state for personal and trainer-managed tenants with tier `free` or `pro`, status `active`, `trialing`, `expired`, or `overridden`, and source `system`, `backfill`, `admin_override`, or `stripe`. Free MUST allow each tenant 1 plan generation per calendar month, 1 regeneration per calendar month, and 0 premium vector-memory AI writes/retrievals. Pro MUST be gated by finite, high, per-feature monthly metered caps (replacing the provisional `1_000_000` placeholder); the confirmable initial Pro caps are `plan_generation` 500, `plan_regeneration` 1000, `memory_write` 50000, `memory_retrieval` 200000 per calendar month. `resolveEffectiveTier` remains the source of truth for tier resolution and MUST NOT read Stripe metadata columns. Pro-over-cap requests MUST be denied with the same hybrid tenant/member gating and denial reasons as Free-over-limit.
(Previously: Pro used a provisional flat `1_000_000` aggregate cap per feature and source did not include `stripe`; 11a explicitly did not model Stripe.)

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

#### Scenario: Pro metered cap enforced

- GIVEN a Pro tenant has reached its per-feature monthly metered cap
- WHEN another request for that feature is made in that tenant
- THEN it is denied with reason `tenant_quota_exhausted` and no AI work starts, consistent with Free-tier gating

#### Scenario: Pro tier resolution unchanged by Stripe metadata

- GIVEN a Pro tenant has Stripe metadata columns populated
- WHEN `resolveEffectiveTier` runs
- THEN it resolves tier only from status/override/trial and never reads the Stripe metadata columns
