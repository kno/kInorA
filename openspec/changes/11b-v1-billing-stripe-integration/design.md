# Design: 11b — Billing Stripe Integration (test mode)

## Technical Approach

Stripe is integrated as **metadata + hosted flows** layered on the merged 11a model. `resolveEffectiveTier` (`entitlement.ts:49`) stays the single source of truth: Stripe columns are NEVER read by it. The webhook is the only writer that maps a paid subscription onto the existing `status`/`tier` contract (`active`/`pro`), so entitlement logic is untouched. All I/O follows the 11a hexagonal split: pure use cases in `apps/api/src/billing/*.ts` depend on ports; the Stripe SDK lives in ONE infra adapter wired in `app.ts`. This is the first real write path into `tenant_billing_states` → activates the latent #172 `overridden` reconciliation guard.

## Architecture Decisions

### Decision: Stripe fields are metadata; webhook writes `status`/`tier`
**Choice**: Additive stripe columns are pure metadata; the webhook maps subscription → existing status. Active paid → `status='active'`/`tier='pro'` (both cycles); `cancel_at_period_end=true` → stays `pro` until `current_period_end`, then a subscription.deleted/period-end event writes `status='expired'` → free. Paying mid-trial writes `active`/`pro`, superseding trial. Admin override still wins (resolved first).
**Alternatives**: teach `resolveEffectiveTier` to read stripe columns. **Rejected** — duplicates the source of truth, reopens entitlement hot path unnecessarily.
**Rationale**: clean insertion point; 11a logic + tests stay green; override precedence preserved.

### Decision: StripeGateway port + single SDK adapter
**Choice**: Pure interface `StripeGateway` in `billing/stripe-gateway.ts` (methods: `verifyAndParseEvent(rawBody, sig)`, `createCheckoutSession`, `createPortalSession`, `listInvoices`, `validatePromotionCode`). Concrete adapter `db/repositories/stripe-gateway.ts` (the established infra boundary the dependency-cruiser already permits) is the ONLY file importing `stripe`; injected in `app.ts`. Use cases (`process-webhook.ts`, `create-checkout.ts`, `create-portal-session.ts`, `list-invoices.ts`) are pure, mirroring the 11a `billing-quota.ts` adapter / pure-use-case split.
**Alternatives**: import `stripe` directly in routes. **Rejected** — breaks dependency-cruiser and un-testability without live Stripe.
**Rationale**: deterministic tests via a `FakeStripeGateway`; single secret-handling surface.

### Decision: Config-driven pricing + real metered caps
**Choice**: New `billing/pricing-config.ts` reads env (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`) and exports Pro caps. `plan-limits.ts` imports `PRO_TIER_LIMITS` from config instead of the hardcoded `1_000_000`; `resolveTenantFeatureLimit` becomes `tier==='pro' ? PRO_TIER_LIMITS[feature] : FREE_TIER_LIMITS[feature]`. Values fit the 32-bit `integer` counter columns.
**Rationale**: backoffice-ready (11b only makes it config-driven); prices/IDs never hardcoded.

### Decision: Raw-body webhook in an encapsulated Fastify scope
**Choice**: Register the webhook route inside its own encapsulated plugin that calls `addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))`, so only that scope receives the raw `Buffer`; the rest of the app keeps JSON parsing. Verify with `stripe.webhooks.constructEvent(raw, sig, secret)`. Route is unauthenticated — the signature IS the auth.
**Alternatives**: global raw parser (**rejected** — breaks every JSON route); `config.rawBody` plugin (extra dep). **Rationale**: minimal blast radius, no new dependency.

### Decision: Idempotent, fail-closed, out-of-order-safe processing
**Choice**: `stripe_processed_events` insert-on-conflict-do-nothing (mirrors the ledger replay pattern at `billing-quota.ts:417`) keyed by Stripe `event_id`; a conflict → already processed → 200 no-op. Out-of-order guard: apply a subscription write only when the incoming Stripe subscription timestamp ≥ the stored one (new `stripe_event_ts` column). Any handler error → 5xx (Stripe retries); a failure NEVER grants Pro (fail-closed).
**Rationale**: exactly-once state transitions under retry + reordering.

## Data Flow

    Checkout:  web CTA → POST /billing/checkout (auth) → create-checkout UC
               → StripeGateway.createCheckoutSession(client_reference_id=tenantId)
               → 303 to Stripe-hosted page → (payment) → Stripe

    Webhook:   Stripe → POST /billing/webhook (raw body, sig) → verify
               → stripe_processed_events insert-on-conflict → map subscription
               → tenant_billing_states (status/tier + metadata)   [fail-closed]

    Portal/Invoices: web → POST /billing/portal | GET /billing/invoices (auth)
               → gateway (customer resolved server-side from tenant) → Stripe

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modify | stripe_* columns on `tenant_billing_states`; `stripe_processed_events`; `billing_cycle` enum; `billingSourceEnum` += `stripe` |
| `apps/api/drizzle/*` | Create | additive migration (Slice 1) |
| `packages/contracts/src/index.ts` | Modify | `BillingSource += 'stripe'`; `BillingCycle`; checkout/portal/invoice DTOs; cycle fields on `TenantBillingStateDTO` |
| `apps/api/src/billing/stripe-gateway.ts` | Create | pure `StripeGateway` port |
| `apps/api/src/db/repositories/stripe-gateway.ts` | Create | Stripe SDK adapter (only `stripe` importer) |
| `apps/api/src/billing/process-webhook.ts` / `create-checkout.ts` / `create-portal-session.ts` / `list-invoices.ts` | Create | pure use cases |
| `apps/api/src/db/repositories/stripe-events.ts` | Create | idempotency + billing-state writer adapter |
| `apps/api/src/routes/billing.ts` (+ webhook scope) | Modify | webhook, checkout, portal, invoices routes |
| `apps/api/src/billing/pricing-config.ts` | Create | env-driven prices + Pro caps |
| `apps/api/src/billing/plan-limits.ts` | Modify | drop `1_000_000`; import `PRO_TIER_LIMITS` |
| `apps/api/src/app.ts` | Modify | wire gateway + use cases |
| `apps/web/.../billing/*` + `AppShell/*` | Modify | OD layout, cycle toggle, i18n |

## Interfaces / Contracts

```typescript
type BillingSource = "system" | "backfill" | "admin_override" | "stripe";
type BillingCycle = "monthly" | "annual";
interface CheckoutSessionRequest { cycle: BillingCycle; promotionCode?: string; }
interface CheckoutSessionResponse { url: string; }
interface PortalSessionResponse { url: string; }
interface InvoiceDTO {   // privacy-safe: no PAN
  id: string; amountDue: number; currency: string; status: string;
  createdAt: string; hostedInvoiceUrl: string | null; receiptUrl: string | null;
  cardBrand?: string; cardLast4?: string;
}
```

## Resolved Open Questions

1. **Metered Pro caps** — CONFIRM the proposed values: `plan_generation` 500, `plan_regeneration` 1000, `memory_write` 50000, `memory_retrieval` 200000 per month. All fit the 32-bit counter columns and read as generous vs Free (1/1/0/0).
2. **"ilimitado" copy** — RECOMMEND option (b): change the OD copy in the web slice to reflect high finite limits (e.g. "hasta N/mes", meters shown). Presenting caps so high they read as unlimited risks a surprise hard-denial on the payments hot path and contradicts the shipped metered enforcement. Adjust OD `web-billing.html` copy accordingly.
3. **Stripe events** — `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Payment-failure handling: **grace** — on `invoice.payment_failed` record `stripe_subscription_status='past_due'` metadata but keep `pro` until Stripe's own retries resolve or a `subscription.deleted`/period-end drives `expired`→free. No custom dunning (out of scope).
4. **Annual save %** — DERIVE from the two configured price amounts (`round(1 - annual/monthly)`); the config price amounts are the single source of truth, no separately maintained "20%" constant.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | webhook mapping, idempotency replay, out-of-order guard, checkout/portal/invoice UCs, coupon validation, cap resolution | pure UCs against `FakeStripeGateway`; signed test events via `stripe.webhooks.generateTestHeaderString` with a known test secret — no live Stripe |
| Integration (real Postgres) | `stripe_processed_events` insert-on-conflict exactly-once, subscription→billing-state write, #172 override/status interaction | extend the existing `billing-integration` CI job with a `stripe-webhook.integration.test.ts` (real PG, faked gateway); keep the skipIf(!DATABASE_URL) + placeholder + assert-executed guard |
| E2E | checkout CTA → Stripe (stubbed) → webhook → Pro; cancel keeps Pro to period end | gateway stubbed; NO live Stripe key in CI |

## Threat Matrix

Applicable — the webhook adds an unauthenticated process-integration boundary.

| Row | Applicable | Safe/failure behavior | RED test |
|-----|-----------|-----------------------|----------|
| Signature spoof/replay | Yes | invalid/absent signature → 400, no state write; duplicate event_id → no-op 200 | forged + replayed signed events |
| Raw-body tamper | Yes | body must match signature over raw bytes | mutated body fails verify |
| Out-of-order event | Yes | stale timestamp ignored | reordered subscription events |
| Cross-tenant grant | Yes | tenant/customer resolved server-side from `client_reference_id`, never client input | spoofed tenant in portal/invoice request |
| Secret leakage | Yes | secrets via env; never logged | log-scrub assertion |
| Fail-closed | Yes | handler error → 5xx, no Pro grant | injected write failure |

## Slice Mapping

| Slice | Elements | Rollback boundary | Test | 4R |
|-------|----------|-------------------|------|----|
| 1 schema-first | stripe_* columns, `stripe_processed_events`, `billing_cycle` enum, `BillingSource 'stripe'`, contracts DTOs. **Boundary: purely additive schema/contracts + migration; ZERO Stripe SDK, ZERO routes, ZERO behavior change; `resolveEffectiveTier` untouched** (mirrors 11a slice-1) | drop migration | schema/type compile + migration up/down | Full 4R |
| 2 webhook + lifecycle | raw-body scope, verify, idempotency, subscription→state map (both cycles), grace payment-failure | drop route + UC | real-PG idempotency + mapping | Full 4R (hottest) |
| 3 checkout + caps + coupons | checkout endpoint (both cycles), SDK adapter, `pricing-config.ts`, real Pro caps (drop `1_000_000`), server-side coupon validation | revert route + config swap | UC + caps unit | Full 4R |
| 4 portal + invoices | portal-session endpoint, invoice listing → privacy-safe DTO | revert routes | UC + DTO mapping | Full 4R |
| 5 web UI | OD layout (sidebar+main+aside), monthly/annual toggle + derived save badge, usage meters, invoice history, payment-method + support cards, i18n; wire CTAs | revert web slice | component + i18n tests | Full 4R |

Every slice ≤~400 authored lines, hot path → full 4R.

## Migration / Rollout

Additive-only schema; revert per slice by dropping the migration. No 11a data mutated destructively; `resolveEffectiveTier` reverts cleanly since stripe columns are unread. Stripe test-mode keys + monthly/annual Price IDs via env/secret.

## Open Questions

- [ ] Confirm the exact Pro cap numbers with product (defaults recommended above).
- [ ] Confirm whether `stripe_event_ts` is added as a column vs reusing `current_period_end` for the out-of-order guard (recommend the dedicated column).
