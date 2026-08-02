# Design: 16c v3 B2B Seat-Based Billing ("Model B")

> **DESIGN SPIKE** — terminal deliverable is this document. NO implementation, NO task execution. GitHub issue #311.

## Technical Approach

Extend the existing **dark pooled-trainer-tenant precedent** (`plan.ts:844-845` meters
`billing.checkAndConsume({ tenantId, userId })` against the TRAINER's own tenant). One sponsor
subscription's Stripe `quantity` tracks active `trainer_client_assignments`; the webhook maps that
subscription → tier + seat count on the sponsor's `tenant_billing_states` row; quota limits scale
with the persisted seat count. Approach 2 (per-client `EntitlementContext` propagation) is rejected
and untouched. Gym rides the same pooled path through a minimal seat-source PORT only; the gym
implementation is deferred behind a 16b foundation.

`resolveEffectiveTier` stays the single source of truth for tier (never reads seat data). Seat count
is additive metadata on the same 1:1 billing row, read only on the limit-resolution path.

## Architecture Decisions

### Decision Q1 — Seat-count storage shape

| Option | Tradeoff | Decision |
|--------|----------|----------|
| New nullable column on `tenant_billing_states` | 1:1 with sponsor row (PK `tenantId`), read on same `loadContext` path, ADD COLUMN metadata-only migration (mirrors 11b Stripe columns) | ✅ **Chosen** |
| Dedicated `tenant_seats` table | Adds a join for a strictly 1:1 attribute; history/audit already covered by `billing_usage_ledger` + `stripe_processed_events` | Rejected |

**Schema delta (Drizzle, `schema.ts` `tenantBillingStates`):**
```ts
// 16c: nullable seat count; null for non-seat tiers. Written ONLY by the
// customer.subscription.updated webhook (Stripe quantity is authoritative).
// Never read by resolveEffectiveTier — only by resolveTenantFeatureLimit.
seatCount: integer("seat_count"),
```
Additive, nullable, no table rewrite — same pattern as the 11b Stripe-metadata columns.

### Decision Q2 — Gym seat source of truth + 16b boundary

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Trainer: `COUNT` active `trainer_client_assignments` | Explicit active/revoked lifecycle already matches seat billing semantics; global partial-unique index guarantees one active trainer per client | ✅ **Chosen (built here)** |
| Gym: count active gym `memberships` | Memberships lack revoke lifecycle for billing; no `gyms` table / `gym_id` FK exists | Rejected as gym source |
| Gym: gym-client **assignment mirror** of `trainer_client_assignments` | Symmetric active/revoked semantics; but requires 16b structural foundation | ✅ **Chosen shape, DEFERRED to a post-16b change** |

**What this change builds:** a `SeatSource` port — `countActiveSeats(tenantId): Promise<number>` —
with a **trainer-only** implementation backed by a new `countActiveByTrainer` repo query.
**16b boundary:** the gym implementation of `SeatSource`, plus the `gyms` table and gym-client
assignment schema it counts, is **out of scope** and gated on 16b. This change ships only the port +
trainer impl; no gym row is ever counted here.

### Decision Q3 — Seat sync to Stripe (trigger / proration / rollback / reconcile)

> **Revised after Judgment Day** (see "Judgment Day resolutions" below). The original key/trigger/
> reconcile spec had concurrency + trigger-coverage defects; the corrected spec is below.

- **New gateway method** `updateSubscriptionQuantity(subscriptionId, quantity, idempotencyKey)` →
  `stripe.subscriptions.update({ items: [{ id, quantity }], proration_behavior: "create_prorations" })`.
- **Trigger — the ACTIVE transition, not `create`.** A seat is counted only when an assignment is
  `active`. So seat-sync fires on the transitions that change the active set:
  `updateStatus(...,"active")` (accept of an invite) → resync; `updateStatus(...,"revoked")` → resync.
  Assignment `create` (default status `invited`, `trainer-assignment.ts:57`) does **NOT** count and
  does **NOT** fire. (The original "create/accept" wording was wrong — `create` yields `invited`.)
  If a future flow creates an already-`active` assignment directly, that path must fire too — the
  rule is "any write that changes the active-assignment set fires a resync."
- **Serialized recompute (concurrency-safe).** Desired quantity is always recomputed as
  `countActiveSeats(tenantId)` (never a delta), but the recompute + outbound Stripe call MUST run
  under a per-sponsor lock so concurrent assignment writes cannot settle on a stale quantity. Take a
  Postgres advisory lock (or `SELECT ... FOR UPDATE` on the sponsor's `tenant_billing_states` row)
  keyed by `tenantId` around `countActiveSeats → updateSubscriptionQuantity`. This serializes the
  last-writer so the final Stripe quantity always equals the true active count.
- **Idempotency key.** Keyed on the sponsor + the observed count generation, NOT on the bare target
  quantity: `seat-sync:{tenantId}:{countTakenUnderLock}`. Because the recompute runs under the
  per-tenant lock, only one syncer observes a given count at a time; the key exists solely to make
  the single in-flight call safe to RETRY. (The prior `seat-sync:{tenantId}:{targetQuantity}` key,
  combined with unlocked recompute, allowed two concurrent adds to collapse to one quantity —
  dropping a real seat — or two reorderable updates to land last-writer-wins. The lock is the fix;
  the key is only retry-safety.)
- **Proration policy:** `create_prorations` — immediate pro-rated charge on add, pro-rated credit on
  remove. Stripe nets prorations correctly per change. (Churn/thrash from rapid add-revoke toggles is
  an accepted tradeoff for v1; a debounce window is a possible later optimization — see Open Questions.)
- **Zero-seat / minimum quantity.** A licensed recurring price line item cannot be `quantity: 0`.
  Floor the synced quantity: `stripeQuantity = max(1, countActiveSeats)`. When the LAST active
  assignment is revoked (`countActiveSeats === 0`) the subscription stays at `quantity: 1` (the
  sponsor still holds a paid trainer subscription with zero clients — a valid state); it is NOT
  auto-canceled. Cancellation stays an explicit user/billing action via the existing portal. The
  seat-scaled LIMIT still floors at `TRAINER_BASE` (Q4) so a 0/1-seat trainer is coherent.
- **Ordering / mid-sync failure:** commit the assignment mutation FIRST (authorization must stand),
  then call Stripe under the lock. Stripe is external — it is **not** in the DB transaction. On Stripe
  failure the assignment is **not** rolled back; DB desired-quantity is simply ahead of Stripe
  actual-quantity, and the reconcile path (below) is what heals it.
- **Reconcile / drift — with a NAMED trigger.** DB active-assignment count = desired source of truth;
  Stripe `items[].quantity` (echoed via webhook into `seatCount`) = actual source of truth. The
  reconcile function recomputes `countActiveSeats` under the per-sponsor lock and calls
  `updateSubscriptionQuantity` idempotently. It is invoked by:
  1. **Opportunistic:** every seat-sync trigger first reconciles (recompute is already authoritative).
  2. **Scheduled sweep:** a periodic job reconciles sponsors whose DB count and last-known `seatCount`
     disagree. **No job/scheduler infra exists in `apps/api/src` today** — Slice C must introduce the
     minimal scheduled-sweep entrypoint (or wire an existing ops cron) as an explicit deliverable, not
     assume one exists. Without a scheduled trigger, a failed outbound call after the last assignment
     event would never self-heal.
  Never write `seatCount` from the outbound path — the webhook remains its sole writer.

### Decision Q4 — Seat-scaled limit formula

**Formula:** `limit(feature) = max(TRAINER_BASE[feature], seatCount * PRO_TIER_LIMITS[feature])`.
Each seat contributes one Pro allowance; the current flat `TRAINER_TIER_LIMITS` (2× Pro) becomes the
floor so a 0–2-seat trainer is never worse off. Gym uses the same formula once its `SeatSource` lands.

**Plug-in point:** `resolveTenantFeatureLimit(tier, feature, seatCount)` gains a `seatCount` arg
(`plan-limits.ts:62`). `null` seatCount ⇒ fall back to the flat tier table (byte-identical current
behavior for pro/free).

**ALL FOUR call sites must thread `seatCount`** (Judgment Day: the original plan named only two, which
would silently diverge the admin allocation cap and the dashboard messaging from real consumption):
1. `quota-consumption.ts:90` — the metering path (already planned).
2. `entitlement.ts:135` — `CheckEntitlement.check`'s premium gate (its OWN call, previously unlisted).
3. `quota-admin.ts:153` — `SetMemberAllocation` validates a per-member allocation ≤ tenant cap. If not
   seat-scaled, an admin CANNOT allocate above the flat 2×Pro even when the tenant's true seat-scaled
   cap is far higher (`allocation_out_of_bounds` false negatives).
4. `billing-visibility.ts:105` — the dashboard's premium-denial reason would show the flat limit while
   consumption enforces the seat-scaled one.

Thread `seatCount` end-to-end: `billing-quota.ts loadContext` (select `seatCount`) →
`EntitlementContext.billing.seatCount` → `EntitlementDecision` → each of the four call sites. Making
`seatCount` a REQUIRED param (not optional-defaulted) forces the compiler to surface any missed site.

**Mid-period volatility (accepted tradeoff, documented):** `resolveTenantFeatureLimit` is re-resolved
fresh on every `checkAndConsume` (`quota-consumption.ts:90`), so removing a seat mid-period lowers the
limit immediately and can drop it below already-consumed usage, denying further consumption that
period. This mirrors the existing trial-expiry/tier-change behavior (not novel), and is accepted for
v1 — noted here so it is a conscious decision, not a surprise.

### Decision Q5 — Stripe per-seat product + checkout

- **New product/price:** a "Trainer Seat" Stripe product with a **per-unit recurring** Price, one per
  cycle. New env `STRIPE_PRICE_TRAINER_SEAT_MONTHLY` / `_ANNUAL`; `CheckoutPriceConfig` +
  `pricing-config.ts` gain `trainerSeatMonthly`/`trainerSeatAnnual`.
- **Checkout selection:** `CreateCheckoutInput` gains `product: "pro" | "trainer"`; `create-checkout.ts`
  picks the seat price when `product === "trainer"`. `createCheckoutSession` sets
  `line_items: [{ price, quantity: initialSeatCount }]` (replaces the hardcoded `quantity: 1` at
  `db/repositories/stripe-gateway.ts:125`).
- **Webhook reads quantity — but does NOT map price→tier** (simplification confirmed by 16d/#307
  exploration). `normalizeSubscription` (ignores quantity today) reads `sub.items.data[0].quantity` →
  new `seatQuantity` field on `StripeSubscriptionSnapshot`. `mapSubscriptionToWrite` keeps writing
  `tier: "pro"` (UNCHANGED) and additionally persists `seatCount = seatQuantity`. **The `trainer`/`gym`
  TIER is granted by the 16d admin override, which `resolveEffectiveTier` gives unconditional
  precedence** (`entitlement.ts:69-71`) — so the webhook never needs a price→tier mapping. `loadContext`
  composes the override-derived tier with the webhook-derived `seatCount` on the same tenant; the
  seat-scaled limit `max(base, seatCount × Pro)` then applies with `tier = trainer`. This REMOVES the
  price→tier mapping from Slice B and resolves the #307/Slice-B overlap the review flagged.

### Decision — Downgrade / lapse behavior (pooled model, precise client-visible effect)

- **Seat removed (assignment revoked):** reconcile lowers Stripe quantity → webhook lowers `seatCount`
  (floored so Stripe quantity never drops below 1 — Q3). Client keeps ALL existing generated plans/data
  (untouched). Future trainer-initiated generation for that client is denied — `resolveAuthorizedOwner`
  finds no active assignment → `403 forbidden_owner_access` (existing behavior). The client's OWN tenant
  tier is unaffected (Approach 1: no per-client propagation).
- **Sponsor subscription lapses:** webhook writes the sponsor tenant `status=expired` (and per #307
  tier handling) → `resolveEffectiveTier` no longer returns `trainer` → `assertTrainerEntitled` fails →
  ALL trainer-mediated client generation blocked (403). Existing client plans stay readable; on expiry
  the webhook zeroes `seatCount`. Clients lose trainer-mediated generation but retain their data and any
  independent Free/Pro tier of their own.

## Data Flow

    Assignment add/revoke ─→ SeatSource.countActiveSeats ─→ gateway.updateSubscriptionQuantity (idempotent)
                                                                         │
    Stripe ── customer.subscription.updated ──→ process-webhook ──→ stripe_processed_events (exactly-once)
                                                       │                        │
                                     normalizeSubscription.seatQuantity   tenant_billing_states.seatCount (authoritative)
                                                                                │
    plan.ts:844 checkAndConsume ─→ loadContext(seatCount) ─→ resolveTenantFeatureLimit(tier, feature, seatCount)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modify | Add nullable `seatCount` column to `tenant_billing_states` (+ migration) |
| `apps/api/src/billing/stripe-gateway.ts` | Modify | `SubscriptionGateway` port + `updateSubscriptionQuantity`; `seatQuantity` on snapshot; `product` on checkout input |
| `apps/api/src/db/repositories/stripe-gateway.ts` | Modify | Implement `updateSubscriptionQuantity`; `normalizeSubscription` reads `items[0].quantity`; `line_items` quantity from seat count |
| `apps/api/src/billing/process-webhook.ts` | Modify | `seatCount` on `BillingStateWrite`; `mapSubscriptionToWrite` price→tier + seatCount |
| `apps/api/src/db/repositories/stripe-events.ts` | Modify | Persist `seatCount` in the guarded upsert |
| `apps/api/src/db/repositories/trainer-assignment.ts` | Modify | Add `countActiveByTrainer` query |
| `apps/api/src/billing/seat-sync.ts` | Create | `SeatSource` port + trainer impl + per-sponsor-locked sync + reconcile + **scheduled-sweep entrypoint** |
| `apps/api/src/routes/trainer.ts` | Modify | Fire seat-sync on the **active/revoked** transitions (accept + revoke), NOT on `create` (invited) |
| `apps/api/src/billing/plan-limits.ts` | Modify | `resolveTenantFeatureLimit(tier, feature, seatCount)` + `max(base, seat×Pro)` formula |
| `apps/api/src/billing/entitlement.ts` | Modify | Carry `seatCount` through `EntitlementContext`/decision + thread it into the `resolveTenantFeatureLimit` call at **`entitlement.ts:135`** |
| `apps/api/src/billing/quota-admin.ts` | Modify | Thread `seatCount` into `resolveTenantFeatureLimit` at **`:153`** (per-member allocation cap) |
| `apps/api/src/billing/billing-visibility.ts` | Modify | Thread `seatCount` into `resolveTenantFeatureLimit` at **`:105`** (dashboard premium-gate) |
| `apps/api/src/db/repositories/billing-quota.ts` | Modify | `loadContext` selects `seatCount` |
| `apps/api/src/billing/quota-consumption.ts` | Modify | Pass `seatCount` to limit resolver (`:90`) |
| `apps/api/src/billing/create-checkout.ts` + `pricing-config.ts` | Modify | Seat product/price selection; initial checkout quantity floored to `max(1, initialSeatCount)` |

## Interfaces / Contracts

```ts
interface SeatSource { countActiveSeats(tenantId: string): Promise<number>; } // trainer impl only here
interface SubscriptionGateway {
  updateSubscriptionQuantity(subscriptionId: string, quantity: number, idempotencyKey: string): Promise<void>;
}
// StripeSubscriptionSnapshot += seatQuantity: number | null
// BillingStateWrite       += seatCount: number | null
// EntitlementContext.billing += seatCount: number | null
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | seat formula, tier/quantity mapping, reconcile convergence, lapse zeroing | pure-function tests |
| Integration | webhook persists `seatCount` under out-of-order/duplicate guard; `countActiveByTrainer` | real-Postgres suite (mirrors `stripe-webhook.integration.test.ts`) |
| Integration | idempotent double add/revoke does not double-sync | fake gateway asserting idempotency key |
| E2E | trainer adds seat → quantity grows → limit scales; revoke → 403 for client generation | existing billing e2e harness |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (Stripe I/O reuses the existing signed-webhook + server-resolved-tenant boundary from 11b, unchanged here.)

## Migration / Rollout

Additive `ADD COLUMN seat_count integer` (nullable, no rewrite). Implementation MUST gate the seat-sync
outbound path behind a feature flag and keep the single flat-Pro `quantity: 1` path intact until the
seat product is live. `seatCount = null` preserves byte-identical pro/free limit behavior.

## Implementation Slice Plan (for `sdd-tasks` — chained PRs)

> Split confirmed. Each slice is an independent future change/PR. Est. lines are authored additions+deletions
> against the 800-line review budget (target < 400 authored per slice).

| # | Slice | Goal | Files | Depends on | Est. lines |
|---|-------|------|-------|-----------|-----------|
| 0 | **#307 tier-grant write path** (PREREQ — not this change) | Webhook maps a configured price → `trainer`/`gym` tier | (Model A) | — | n/a |
| A | Gateway subscription-update + parse quantity | `updateSubscriptionQuantity`; `normalizeSubscription` reads `items[].quantity`→`seatQuantity` | `billing/stripe-gateway.ts`, `db/repositories/stripe-gateway.ts` (+tests) | none | ~180 |
| B | Schema delta + webhook seatCount persist | `seatCount` column; `BillingStateWrite`/`mapSubscriptionToWrite`/`stripe-events.ts` persist seatCount. **No price→tier mapping** — webhook stays `pro`; tier comes from the 16d override. | `schema.ts`(+migration), `process-webhook.ts`, `stripe-events.ts` (+tests) | A, **16d (#307)** | ~200 |
| C | Seat-count source + sync orchestration | `countActiveByTrainer`; `SeatSource` port+trainer impl; **per-sponsor-locked** sync on accept/revoke; reconcile + **scheduled-sweep entrypoint**; zero-seat floor | `trainer-assignment.ts`, `billing/seat-sync.ts`, `routes/trainer.ts` (+tests) | A, B | ~300 |
| D | Seat-scaled limits (**all 4 call sites**) | Thread `seatCount` → `resolveTenantFeatureLimit` at `quota-consumption.ts:90`, `entitlement.ts:135`, `quota-admin.ts:153`, `billing-visibility.ts:105`; `max(base, seat×Pro)` formula | `plan-limits.ts`, `billing-quota.ts`, `entitlement.ts`, `quota-consumption.ts`, `quota-admin.ts`, `billing-visibility.ts` (+tests) | B | ~260 |
| E | Per-seat product + checkout | Env/price config; `product` selection; `line_items` quantity floored `max(1, initialSeatCount)` | `create-checkout.ts`, `pricing-config.ts`, `db/repositories/stripe-gateway.ts`, `routes/billing.ts` (+tests) | A, B (may parallel D) | ~180 |
| F | Downgrade / lapse | Expiry zeroes `seatCount`; revoke→403 tests; lapse flips sponsor entitlement | `process-webhook.ts`, `owner-access` tests | B, C, D | ~140 |
| G | **Gym seats** (SEPARATE change, GATED on minimal 16b) | Gym `SeatSource` impl + gym-client assignment schema | (post-16b) | 16b foundation | n/a (out of scope) |

Total trainer chain (A–F) ≈ **1360 authored lines** (up from ~1180 after Judgment Day added the lock,
the scheduled sweep, and the two missed limit call sites) → **chained/stacked PRs required**, one per
slice. Slice G is explicitly firewalled behind 16b and never enters the trainer chain.

**#307 (16d) / Slice B coordination — RESOLVED:** the 16d/#307 exploration confirmed the `trainer`/`gym`
tier is granted by an admin **override**, which `resolveEffectiveTier` treats as unconditionally
authoritative. So there is NO price→tier mapping in the webhook and no overlap to coordinate: the
webhook keeps writing `pro` + `seatCount`, and the tier comes from the override. Slice B depends on 16d
only because the tenant must actually HOLD the `trainer` tier (via override) for seat-scaling to apply;
if Slice B lands first, `seatCount` is written as harmless metadata until an override grants the tier.

## Judgment Day resolutions

Two blind adversarial judges reviewed this design. The confirmed findings (both-judge agreement or
deterministic/verified) are resolved above:

1. **Limit call-site coverage (CRITICAL, both judges, verified):** `resolveTenantFeatureLimit` has 4
   real call sites, not 2. All four now threaded (Q4 + Slice D + File Changes).
2. **Concurrency-unsafe sync (CRITICAL, both judges):** unlocked recompute + quantity-keyed idempotency
   dropped/over-counted seats. Fixed with a per-sponsor lock around recompute+update (Q3).
3. **Reconcile had no trigger (CRITICAL, both judges, verified no scheduler exists):** now has an
   opportunistic trigger + an explicit scheduled-sweep entrypoint that Slice C must build (Q3, Slice C).
4. **Trigger omitted `accept` (CRITICAL, verified `create`⇒`invited`):** trigger corrected to the
   active/revoked transitions, not `create` (Q3, File Changes, Slice C).
5. **Zero-seat quantity (secondary):** Stripe quantity floored to `max(1, count)`; last-seat-removed
   keeps quantity 1, not auto-cancel (Q3). Initial checkout floored too (Slice E).

Minor notes accepted (not blocking): proration thrash on churn (Q3), #307/Slice-B mapping overlap
(coordination note above), mid-period limit volatility (documented as accepted tradeoff in Q4).

## Open Questions

- [ ] Seat product pricing tiers/currency (Stripe dashboard config) — ops decision, not code.
- [ ] Whether a seat-sync reservation needs an explicit `billing_usage_ledger` row or the per-sponsor
      lock + Stripe idempotency key alone suffices (Slice C spike).
- [ ] Reconcile scheduled-sweep hosting: introduce a minimal in-app scheduler vs wire an external ops
      cron hitting an admin-only reconcile endpoint (Slice C decision).
