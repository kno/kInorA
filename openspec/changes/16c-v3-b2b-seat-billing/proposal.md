# Proposal: 16c v3 B2B Seat-Based Billing ("Model B")

> **DESIGN SPIKE** — proposal + design only, NO implementation. GitHub issue #311.
> Roadmap: evolves Model A tier-grant (#307) into seat-scaled monetization for trainer/gym.

## Intent

Today a trainer/gym gets a flat 2×Pro tier; revenue does not scale with clients and Stripe `quantity` is hardcoded to 1. We want ONE sponsor subscription whose quantity tracks active seats (clients), so billing grows with the roster and generation stays correctly metered. Design the smallest viable model that makes pooled seat-billing work for both trainer and gym.

## Scope

### In Scope
- **Metering = Approach 1 (pooled trainer-tenant).** Sponsor tenant quota scales with seat count; client-initiated generation keeps metering against the sponsor pool (extend `plan.ts:844-845`).
- **Seat source of truth.** Trainer: COUNT active `trainer_client_assignments`. Gym: minimal seat surface (below).
- **Seat sync to Stripe.** New subscription-update path driving `quantity`; proration policy; failure rollback reusing `stripe_processed_events` / `billing_usage_ledger` idempotency keys.
- **Webhook → tier + seat count.** Map seat subscription to `trainer`/`gym` tier and persist seat count (new column on `tenant_billing_states` vs new table — design decides).
- **Seat-scaled limits.** Decide base + per-seat increment vs flat `TRAINER_TIER_LIMITS`.
- **Stripe per-seat product(s)** + checkout price selection.
- **Downgrade/lapse behavior** on seat removal or sponsor lapse.
- **Minimal gym seat model** + explicit 16b dependency callout.

### Out of Scope (Non-Goals)
- Approach 2 per-client entitlement propagation (rejected — no `EntitlementContext` redesign).
- Full 16b gym hierarchy beyond the minimal seat-counting + entitlement-attachment surface.
- The #307 tier-grant WRITE path itself (prerequisite, not built here).
- Any implementation — this spike ends at design.

## Capabilities

### New Capabilities
- `16c-v3-b2b-seat-billing`: seat-source counting, Stripe quantity sync + proration/rollback, webhook seat→tier mapping + seat-count persistence, seat-scaled pooled limits, downgrade/lapse rules, minimal gym seat surface.

### Modified Capabilities
- `11b-v1-billing-stripe-integration`: gateway gains subscription-update; webhook maps seat subscription → tier + seat count.
- `11a-v1-billing-plans-tiers`: pooled limit becomes seat-scaled.

## Approach

Extend the existing dark pooled-metering precedent rather than redesign the single-tenant engine. Seat count derives from active assignments (trainer) or a minimal gym-seat source (count active gym memberships OR a gym-client assignment mirror of `trainer_client_assignments` — design justifies). Assignment add/remove triggers an idempotent Stripe quantity update; webhook writes tier + seat count to the sponsor's `tenant_billing_states`; quota limits read seat count. Gym rides the same pooled path via the minimal seat surface only.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `stripe-gateway.ts` | Modified | Add subscription-update; parse `items[].quantity` |
| `process-webhook.ts` | Modified | Seat subscription → tier + seat count write |
| `schema.ts` (`tenant_billing_states`) | Modified | Seat-count storage (column/table — design) |
| `trainer_client_assignments` repo | Modified | Add count-active-clients query + sync hook |
| `billing-quota.ts` / `plan-limits.ts` | Modified | Seat-scaled pooled limit |
| `create-checkout.ts` | Modified | Per-seat product/price selection |
| Gym seat surface (new, minimal) | New | Seat-counting + entitlement attachment (16b overlap) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Double increment/decrement on retried webhook/route | High | Reuse `stripe_processed_events` + ledger operation keys |
| Stripe update fails mid-sync (drift) | Med | Rollback policy + idempotent reconcile |
| Gym seats silently expand into 16b | High | Freeze to minimal seat surface; explicit 16b dependency |
| Flat limits inconsistent with seat model | Med | Design decides seat-scaled formula |

## Rollback Plan

Design-spike artifacts only; no code ships. Revert by deleting the change folder / archiving the proposal. Downstream implementation (separate change) must gate seat sync behind a flag and keep the single flat-Pro path intact.

## Dependencies

- **#307** Model A tier-grant write path (a seat product must grant `trainer`/`gym` tier). Hard prerequisite.
- **16b** gym hierarchy — this spike defines only the minimal seat surface; full hierarchy is 16b.
- **#306** backoffice seat-management UI (related, not blocking).

## Success Criteria

- [ ] Proposal + design answer all 5 open questions (seat source, webhook mapping/storage, downgrade/lapse, seat-scaled limits, Stripe product/pricing).
- [ ] Minimal gym seat model defined with justified source of truth and explicit 16b boundary.
- [ ] Non-goals (Approach 2, full 16b, #307 write path) explicitly excluded.
- [ ] Idempotency reuse for seat sync specified.
