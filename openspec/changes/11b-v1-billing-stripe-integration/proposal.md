# Proposal: 11b — Billing Stripe Integration (test mode)

## Intent

Complete the billing epic with real paid Pro upgrades via Stripe (test mode). Today 11a models tiers, quota, trials, and admin overrides, but there is no path to *become* Pro by paying and no real Pro cap (provisional `PRO_FEATURE_LIMIT = 1_000_000`). 11b adds Stripe-hosted checkout (monthly + annual), webhook-driven subscription lifecycle, server-side coupon validation, config-driven pricing, real metered Pro caps, the Stripe Customer Portal for payment-method/subscription management, invoice history, and the web billing screen matching the existing Open Design. This is the **first real write path into `tenant_billing_states`**, which activates the latent #172 `overridden`/status reconciliation guard.

## Scope

### In Scope
- Stripe **test-mode** checkout, Stripe-hosted; **monthly + annual** billing cycles (two Stripe Prices); no card data on our servers; tenant via `client_reference_id`/metadata.
- **Webhook-driven** subscription lifecycle, idempotent; maps active paid subscription → `status='active'`/`tier='pro'` (both cycles), cancel/expiry → `expired`→free.
- **Server-side coupon validation** (validate in our backend before session creation) so we own the invalid-code error copy.
- **Config-driven pricing** (Price/Product IDs + amounts from env/secret, backoffice-ready). Initial values: 9,99 €/mo monthly; 7,99 €/mo billed annually ("save 20%").
- **Real finite metered Pro caps** replacing `1_000_000`.
- **Stripe Customer Portal** (hosted) for payment-method + subscription management; no card data on our servers.
- **Invoice history** listing read from the Stripe API + receipt download.
- **Web billing screen** reproducing the authoritative Open Design (see `design-reference-open-design.md`).

### Out of Scope (non-goals)
- Pricing/limits **backoffice UI** (11b only makes pricing/limits config-driven).
- Production Stripe keys / go-live.
- Dunning and complex proration beyond immediate-convert + cancel-at-period-end (minimal payment-failure handling only).
- `memory_write` two-phase reserve→commit rework (keep single-phase void from #174).
- **Voice-coach minutes** shown in the OD design — that is feature 13 (voice), NOT a billing feature in 11a/11b scope.

## Capabilities

### New Capabilities
- `11b-v1-billing-stripe-integration`: Stripe test checkout (monthly+annual), idempotent webhook lifecycle, coupon validation, Customer Portal, invoice listing (canonical spec exists; portal/invoices/cycles extend it).

### Modified Capabilities
- `11a-v1-billing-plans-tiers`: real metered Pro caps replace the provisional cap in `plan-limits.ts` (limit values only; tier resolution unchanged).

## Approach

- **Additive stripe columns** on `tenant_billing_states` (`stripe_customer_id`, `stripe_subscription_id`, `stripe_subscription_status`, `current_period_end`, `cancel_at_period_end`) — pure metadata, **NOT read by `resolveEffectiveTier`**, which stays the source of truth. Override still wins; a paid subscription supersedes trial by writing `active`/`pro`.
- **Idempotency**: `stripe_processed_events(event_id pk, …)` insert-on-conflict-do-nothing (mirrors the ledger replay pattern); out-of-order events guarded by subscription timestamp; **fail-closed** (a webhook failure never grants Pro).
- **Webhook**: unauthenticated route where the Stripe signature IS the auth; needs the **raw request body** — Fastify's JSON parser must be bypassed for this route (key gotcha).
- **Portal + invoices**: Customer Portal session created server-side from the tenant's `stripe_customer_id`; invoices listed via Stripe API (no local invoice store).
- **Decisions (not open questions)**: add `BillingSource 'stripe'` enum value (contracts + `billingSourceEnum`); official `stripe` node SDK; two billing cycles; defer two-phase memory_write.
- **Web**: reproduce the OD layout/tokens — sidebar + main (plan hero, usage meters, invoice history) + aside (Pro card with Monthly/Annual toggle + save badge, payment-method card, support); dark oklch theme, lime accent, Space Grotesk + DM Sans. **Do not invent a new layout.**
- **Trial↔subscription**: paying converts immediately (`active`/`pro`, superseding remaining trial); cancellation keeps Pro until `current_period_end`, then `expired`→free.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modified | stripe columns + `stripe_processed_events` |
| `packages/contracts/src/index.ts` | Modified | `BillingSource 'stripe'`, cycle + invoice DTO fields |
| `apps/api/src/routes/billing.ts` (+ webhook/checkout/portal/invoices) | New/Modified | raw-body webhook, checkout, portal session, invoice list |
| `apps/api/src/billing/plan-limits.ts` | Modified | real metered Pro caps |
| `apps/web` `BillingPageClient.tsx` | Modified | OD-matching billing screen + i18n |

## Slicing (5 chained PRs, ≤~400 authored lines each, hot path / full 4R every slice)

1. **Slice 1 — schema-first (no external Stripe calls)**: migration for stripe_* columns + `stripe_processed_events` table + `BillingSource 'stripe'` enum + contracts DTO fields. **Boundary: purely additive schema/contracts + migration; zero Stripe SDK, zero routes, zero behavior change; `resolveEffectiveTier` untouched.** Mirrors 11a slice-1.
2. **Slice 2 — webhook + subscription lifecycle**: raw-body webhook route + signature verification + idempotent processing + subscription→billing-state mapping (monthly + annual) + minimal payment-failure handling.
3. **Slice 3 — checkout + real caps + coupons**: checkout-session endpoint (both cycles) + Stripe SDK adapter + config-driven pricing + real metered Pro caps + server-side coupon validation.
4. **Slice 4 — Customer Portal + invoices**: portal-session endpoint (payment-method + subscription management) + invoice listing/receipt download from the Stripe API.
5. **Slice 5 — web billing UI**: reproduce the OD billing screen (plan hero, usage meters, invoice history, Pro card w/ Monthly/Annual toggle + save badge, payment-method card, support) + i18n; wire CTAs to checkout/portal.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Payments hot path regressions | High | Full 4R every slice; test-mode only |
| Webhook signature bypass / replay | Med | Verify raw-body signature; processed-events table + timestamp tolerance |
| Secret leakage in logs | Med | Secrets via env/secret store; never logged |
| Cross-tenant grant / portal access | Med | Tenant/customer mapping resolved server-side, never client input |
| Design/product copy mismatch (unlimited vs metered) | Med | Reconcile in design phase before web slice |
| #172 guard first exercised | Med | Explicit tests on subscription/override/status interaction |

## Rollback Plan

Additive-only schema — revert per slice by dropping the migration (stripe columns/table) and unmerging the slice. No 11a data is mutated destructively; `resolveEffectiveTier` reverts cleanly since stripe columns are unread by it.

## Dependencies

- `11a-v1-billing-plans-tiers` (merged).
- Official `stripe` node SDK; Stripe test-mode keys + monthly/annual Price/Product IDs via env/secret.
- Open Design `web-billing.html` (project kiNorA) as the authoritative web reference.

## Success Criteria

- [ ] Test-mode checkout upgrades a free tenant to Pro end-to-end for both monthly and annual cycles.
- [ ] Duplicate/out-of-order webhooks update billing state exactly once.
- [ ] Invalid coupon rejected server-side with controlled error copy.
- [ ] Cancellation keeps Pro until `current_period_end`, then free.
- [ ] Customer Portal manages payment method/subscription; invoices listed from Stripe.
- [ ] Real metered Pro caps enforced; provisional `1_000_000` removed.
- [ ] Web billing screen matches the OD layout/tokens.

## Open Questions (for design phase — narrow)

1. **Exact metered Pro caps** — proposed starting values (internal product config, needs confirmation): `plan_generation` 500/mo, `plan_regeneration` 1000/mo, `memory_write` 50000/mo, `memory_retrieval` 200000/mo.
2. **Design-copy reconciliation**: the OD design says Pro is "ilimitado / sin límite", but the product decision is high finite metered caps. Design/spec MUST resolve to either (a) caps set effectively-unlimited and keep the "ilimitado" copy, or (b) change the copy to reflect high metered limits.
3. **Precise Stripe events** driving tier changes (e.g. `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`) + the minimal payment-failure handling (grace vs immediate expire).
4. **Annual save %**: is the "save 20%" badge a fixed config value or derived from the monthly vs annual price amounts?
