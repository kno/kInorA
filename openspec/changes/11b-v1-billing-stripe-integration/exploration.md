# Exploration: 11b-v1-billing-stripe-integration

Integrate Stripe (test mode) for Pro checkout, subscription lifecycle, and coupons, on top of the merged 11a billing model. No production code written in this phase.

## Current state (grounded in merged 11a)

- **Effective tier is a pure function** `resolveEffectiveTier(ctx, now)` — `apps/api/src/billing/entitlement.ts:49`. Precedence: active admin override → `billing.status`. `trialing` = pro until `trialEndsAt`; `expired` → free; `overridden` with no active override reconciles to free (#172 latent guard, `entitlement.ts:71-79`); `active` → stored tier stands. **Clean insertion point — needs no logic change** if a paid subscription maps to `status='active'` / `tier='pro'`.
- Entitlement reads tier/status/source/trial + activeOverrideTier via `BillingStateReaderRepository.loadContext` — `apps/api/src/db/repositories/billing-quota.ts:37`.
- Schema (`apps/api/src/db/schema.ts`): `tenant_billing_states` (L176, **no stripe fields**), `tenant_billing_overrides` (L199), quota counters/allocations, `billing_usage_ledger` with unique `(tenant,user,feature,period,operation_key)` = the idempotency-replay pattern (L338), `billing_audit_events` (L379).
- Routes (`apps/api/src/routes/billing.ts`) = usage / allocations / visibility only. Web upgrade CTA is `<a href={upgradePromptPath}>` in `BillingPageClient.tsx:197` — the natural checkout entry point.
- **Zero Stripe references in source** — greenfield; no `stripe` dependency.

## Deferred-from-11a follow-ups (confirmed, in scope for 11b)

1. Provisional Pro cap `PRO_FEATURE_LIMIT = 1_000_000` — `plan-limits.ts:9` ("exact Pro pricing/limits arrive in 11b").
2. Single-phase void compensation (`quota-consumption.ts:132`, `billing-quota.ts:291`) with a documented residual concurrent-same-key under-count race — not payments-critical; revisit two-phase only if payments make it matter.
3. No admin-override write path exists yet — 11b's subscription writes are the **first real write path into `tenant_billing_states`**, which activates the latent `overridden`/status reconciliation guard from #172.

## Recommended integration approach

- **Additive stripe columns** on `tenant_billing_states` (`stripe_customer_id`, `stripe_subscription_id`, `stripe_subscription_status`, `current_period_end`, `cancel_at_period_end`) — metadata NOT read by `resolveEffectiveTier`. Webhook maps active paid subscription → `status='active'`/`tier='pro'`; cancel/expiry → `status='expired'` → free. Override still wins; a subscription supersedes trial by writing `active`.
- **Webhook idempotency**: dedicated `stripe_processed_events(event_id pk, ...)` with insert-on-conflict-do-nothing, mirroring the ledger pattern; Stripe event id as key; guard out-of-order events by subscription timestamp.
- **Checkout**: Stripe-hosted Checkout Session (test mode, no card data on our servers); tenant from authContext via `client_reference_id`/metadata; webhook resolves customer → tenant server-side.
- **Coupons**: Stripe `allow_promotion_codes` (Stripe validates) vs server-side `promotion_code` lookup for custom error copy — product decision.
- **Real Pro limits** replace `1_000_000` in `plan-limits.ts` (internal product numbers, not from Stripe); Stripe Price/Product IDs in env/secrets.

## Security surface (payments = hot path, 4R every slice)

Webhook signature verification needs the **raw request body** (Fastify JSON parser must be bypassed for that route — key gotcha); the webhook is unauthenticated (the signature IS the auth); replay defended via the processed-events table + timestamp tolerance; tenant scoping never trusts client input; Stripe secrets via env/secrets, never logged; fail-closed (a webhook failure must never grant Pro); Stripe-hosted checkout so no card data touches our servers.

## Proposed slicing (chained PRs, ≤~400 authored lines each, mirroring 11a)

1. **Slice 1 — schema-first, no external Stripe calls**: migration for stripe_* columns + `stripe_processed_events` table + any enum/source additions + contracts DTO fields. (Mirrors 11a slice-1.)
2. **Slice 2 — webhook (hottest, 4R)**: webhook route + signature verification (raw body) + idempotent processing + subscription→billing-state mapping use case.
3. **Slice 3 — checkout**: checkout session endpoint + Stripe SDK adapter + swap provisional Pro cap for real Pro limits.
4. **Slice 4 — coupons + web**: coupon support + web CTA→checkout wiring + i18n.

## Open questions (blocking a full proposal — need product answers)

1. Exact Pro price + Stripe Price/Product IDs.
2. Real Pro per-feature limits — unlimited or metered caps?
3. Coupon rules — predefined vs customer-entered vs server-validated?
4. Trial ↔ subscription — immediate conversion mid-trial? cancel-at-period-end then free?
5. New `BillingSource 'stripe'` vs reuse `'system'`? (defaultable)
6. Add `stripe` node SDK (which version) + signature lib? (defaultable)
7. Which events drive tier changes + dunning/grace on payment failure?
8. Is memory_write two-phase reserve→commit in scope, or defer? (defaultable: defer)

## Reference

Full exploration also persisted to Engram `sdd/11b-v1-billing-stripe-integration/explore` (id 2386).
