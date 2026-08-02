# Exploration — 16c-v3-b2b-seat-billing (B2B seat-based billing, "Model B")

GitHub issue: #311. This is a **design spike** (exploration → proposal → design; no implementation).

## Goal

A trainer or gym holds ONE Stripe subscription whose **quantity scales with the number
of active clients (seats)**, and each client's tenant derives entitlement FROM that
subscription. This is the monetization evolution beyond the flat trainer/gym tier
("Model A" = issue #307, tier-grant only).

## Current State (all file:line confirmed)

### Checkout / Stripe pipeline — one flat Pro product, quantity hardcoded
- `apps/api/src/db/repositories/stripe-gateway.ts:125` — `line_items: [{ price: input.priceId, quantity: 1 }]`.
  No subscription-**update** method exists anywhere in `StripeApiGateway`/`StripeGateway`
  (only create-checkout, create-portal, list-invoices, retrieve-price).
- `apps/api/src/billing/stripe-gateway.ts:141-146` — `CreateCheckoutSessionInput` =
  `{ tenantId, cycle, priceId, promotionCodeId }`; no quantity/seat field.
- `apps/api/src/billing/create-checkout.ts:26-27,45` — selects `priceMonthly`/`priceAnnual`
  only (env `STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_ANNUAL`); no trainer/gym/seat price exists.
- `stripe-gateway.ts:354-368` `normalizeSubscription` reads `interval` for cycle but never
  reads `sub.items[].quantity` — seat data isn't even parsed from Stripe today.

### Webhook — mints only `pro`, no seat write
- `apps/api/src/billing/process-webhook.ts:204` — `mapSubscriptionToWrite` hardcodes
  `tier: "pro"`. `BillingStateWrite` has no seat-count field.
- `process-webhook.ts:228-266` — one Stripe subscription maps to exactly one `tenantId`
  (from subscription metadata); no concept of "this subscription funds N tenants".

### Entitlement / quota — strictly single-tenant
- `apps/api/src/billing/entitlement.ts:14-27,68-107` — `EntitlementContext` /
  `resolveEffectiveTier` resolve only from `scope.tenantId`'s own row.
- `apps/api/src/db/repositories/billing-quota.ts:40-84` — `loadContext`'s three queries
  (memberships, tenantBillingStates, tenantBillingOverrides) are filtered by `scope.tenantId` alone.
- `apps/api/src/billing/quota-consumption.ts:74-111` — metering has no seat concept, just a
  flat `tenantLimit` from `plan-limits.ts:62-67`.
- `apps/api/src/billing/plan-limits.ts:26-31` — `TRAINER_TIER_LIMITS` = flat 2× Pro, NOT seat-scaled.

### The dark trainer→client flow (existing precedent)
- `apps/api/src/routes/plan.ts:808-854` — `POST /clients/:clientUserId/plan-specs` resolves
  the owner via `resolveAuthorizedOwner`, then at **lines 844-845** meters
  `billing.checkAndConsume({ tenantId, userId }, ...)` against the TRAINER's own tenant/quota —
  i.e. pooled-trainer-tenant metering, not per-client entitlement propagation. Coded and tested,
  but dark (unreachable until a tenant has tier `trainer`).

### Schema (`apps/api/src/db/schema.ts`)
- `tenant_billing_states` (206-245): PK `tenantId`; tier/status/source, trial window, Stripe
  metadata (`stripeCustomerId`, `stripeSubscriptionId`, `stripeSubscriptionStatus`,
  `currentPeriodEnd`, `cancelAtPeriodEnd`, `billingCycle`, `stripeEventTs`). **No seat-count
  column, no sponsor/parent-tenant FK.**
- `tenant_billing_overrides` (263-290): admin tier grant; no app-code INSERT (issue #307's surface).
- `tenant_quota_counters` (292-324), `member_quota_allocations` (326-357),
  `member_quota_counters` (359-400), `billing_usage_ledger` (402-441): all scoped
  `(tenantId[, userId], feature, period)` — no seat / cross-tenant reference.
- `billingTierEnum` = `["free","pro","trainer","gym"]` (113); `billingSourceEnum` =
  `["system","backfill","admin_override","stripe"]` (122-131).
- `trainer_client_assignments` (992-1024): unique `(tenantId, clientUserId)` + a **global
  partial unique index on `clientUserId` WHERE status <> 'revoked'** (one active trainer per
  client). `TrainerAssignmentRepository` has `create`/`findByClientUserId`/`findActiveAssignment`/
  `listByTrainer`/`updateStatus` — **no COUNT-active-clients query exists today**.

### Trainer/gym access seams
- `owner-access.ts:75-129` — role + tier + active-assignment gate.
- `client-access.ts:60-75` — client→trainer-tenant read.
- `gym-access.ts:45-57` — tier-only gate; doc comment confirms `gym` has no role, no hierarchy check.

## The three hard barriers
1. **Quantity hardcoded to 1** (`stripe-gateway.ts:125`) — and NO subscription-update method
   exists at all. Seat sync is greenfield Stripe infra.
2. **Webhook mints only `pro`** (`process-webhook.ts:204`) — must map subscription → `trainer`
   tier + seat count; `BillingStateWrite` has no seat field.
3. **No inter-tenant entitlement propagation** (`entitlement.ts`/`billing-quota.ts`) — the
   engine is single-tenant; a client tenant cannot derive entitlement from a sponsor's subscription.

## Gym scope reality (confirmed)
No `gyms` table and no `gym_id` FK exist anywhere. `gym` is only a `billingTierEnum` value plus a
tier-only `assertGymEntitled` check. Gym seats have **zero structural foundation** — that hierarchy
belongs to (unbuilt) issue 16b. **Recommendation: defer gym seats out of this change's scope.**

## Approaches (decision surface for propose/design)

### Approach 1 — Extend pooled-trainer-tenant metering
Sync Stripe `quantity` from active `trainer_client_assignments` count; webhook writes tier
`trainer` to the trainer's own tenant only. Client generation keeps metering against the trainer's
pool (extends `plan.ts:844-845`).
- **Pros:** smallest structural change; one existing precedent to extend; no `EntitlementContext`
  redesign; naturally excludes gym.
- **Cons:** client tenants never get independent entitlement — a lapsed sponsor subscription has no
  per-client signal beyond the trainer's own tier flipping.
- **Effort:** Medium.

### Approach 2 — Per-client entitlement propagation
Redesign `EntitlementContext`/`loadContext` so a client tenant's `resolveEffectiveTier` can resolve
from a sponsor tenant's billing row.
- **Pros:** cleaner "client sees their own Pro status" UX; symmetric with B2C entitlement.
- **Cons:** touches the single-tenant boundary at the core of the entitlement engine — much larger
  blast radius, no existing precedent, likely a multi-slice effort of its own.
- **Effort:** High.

### Recommendation
Approach 1 (extend pooled metering) — smaller, reuses the dark-coded precedent, defers gym hierarchy.
Recommendation surface for `sdd-propose`, not a decision made here.

## Open questions for proposal + design
1. **Seat source of truth** — drive Stripe `quantity` from active-assignment count; proration policy;
   rollback when the Stripe update fails (idempotency reuse: `stripe_processed_events`,
   `billing_usage_ledger` operation keys).
2. **Metering model** — pooled trainer-tenant quota (Approach 1) vs per-client entitlement (Approach 2).
3. **Downgrade / lapse behavior** — what happens to a client's plans/entitlement when a seat is
   removed or the sponsor subscription lapses.
4. **Seat limits** — `TRAINER_TIER_LIMITS` is flat 2× Pro; decide whether limits become a function
   of seat count.
5. **Stripe product/pricing** — new per-seat trainer product; checkout price selection.

## Risks
- Seat sync without idempotency reuse risks double increment/decrement on retried webhooks/route calls.
- No Stripe subscription-update method exists — greenfield infra, not a small patch.
- Gym seats have zero schema foundation; scoping them in silently expands into 16b territory.
- Flat `TRAINER_TIER_LIMITS` is inconsistent with a genuinely seat-scaled model.

## Ready for proposal: Yes
