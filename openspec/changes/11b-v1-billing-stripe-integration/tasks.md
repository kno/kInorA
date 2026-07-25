# Tasks: 11b — Billing Stripe Integration (test mode)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1,600–2,000 across 5 slices (~320–400 each) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 schema-first → PR2 webhook/lifecycle → PR3 checkout/caps/coupons → PR4 portal/invoices → PR5 web UI |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Every slice is on the payments hot path → full 4R review each. Stripe SDK calls are ALWAYS mocked/stubbed in tests via `FakeStripeGateway`; signed webhook events use `stripe.webhooks.generateTestHeaderString` with a known test secret. NO live Stripe key runs in CI.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Additive stripe schema + `stripe_processed_events` + `BillingSource 'stripe'` + `billing_cycle` enum + contracts DTOs + pricing-config scaffold. ZERO SDK, ZERO routes, ZERO behavior change; `resolveEffectiveTier` untouched | PR1 | `pnpm --filter api test -- src/db/__tests__/stripe-schema.test.ts` + `pnpm --filter contracts test` | Real-Postgres: extend `billing-integration` CI job with `stripe-schema.integration.test.ts` (migration up/down + insert-on-conflict); keep `skipIf(!DATABASE_URL)` + placeholder + assert-executed guard | `apps/api/src/db/schema.ts`, `apps/api/drizzle/00XX_stripe_billing.sql`, `packages/contracts/src/index.ts`, `apps/api/src/billing/pricing-config.ts` — drop migration to revert |
| 2 | Raw-body webhook route + signature verify + idempotent processing + subscription→billing-state mapping (both cycles) + grace payment-failure | PR2 | `pnpm --filter api test -- src/billing/__tests__/process-webhook.test.ts src/routes/__tests__/billing-webhook.test.ts` | Real-Postgres: `stripe-webhook.integration.test.ts` (real PG, faked gateway) — insert-on-conflict exactly-once, subscription→state write, #172 override/status interaction | `apps/api/src/billing/process-webhook.ts`, `apps/api/src/db/repositories/stripe-events.ts`, webhook scope in `apps/api/src/routes/billing.ts` — drop route + UC |
| 3 | Checkout endpoint (monthly+annual) + Stripe SDK adapter + config-driven pricing + real metered Pro caps (drop `1_000_000`) + server-side coupon validation | PR3 | `pnpm --filter api test -- src/billing/__tests__/create-checkout.test.ts src/billing/__tests__/plan-limits.test.ts src/billing/__tests__/coupon.test.ts` | `pnpm --filter api dev` + Free→checkout(fake gateway)→webhook→Pro cap smoke | `apps/api/src/billing/create-checkout.ts`, `apps/api/src/db/repositories/stripe-gateway.ts`, `pricing-config.ts`, `plan-limits.ts` — revert route + config swap |
| 4 | Customer Portal session endpoint + invoice listing → privacy-safe DTOs | PR4 | `pnpm --filter api test -- src/billing/__tests__/create-portal-session.test.ts src/billing/__tests__/list-invoices.test.ts src/routes/__tests__/billing-portal.test.ts` | `pnpm --filter api dev` + portal/invoice tenant-scoping smoke | `apps/api/src/billing/create-portal-session.ts`, `apps/api/src/billing/list-invoices.ts`, portal/invoice routes — revert routes |
| 5 | OD billing screen (sidebar+main+aside), monthly/annual toggle + derived save badge, usage meters, invoice history, payment-method/support cards, "hasta N/mes" copy, i18n; wire CTAs | PR5 | `pnpm --filter web test -- src/app/(app)/billing` + `pnpm --filter i18n test` | `pnpm --filter api dev` + `pnpm --filter web dev` on `/billing`: toggle/checkout/portal/meters + EN/ES + a11y smoke | `apps/web/src/app/(app)/billing/*`, `apps/web/.../AppShell/*`, `packages/i18n/src/messages/{en,es}.json` — revert web slice |

## Phase 1: Slice 1 — Schema-First (Foundation) [Requirements: Webhook Subscription Updates, Config-Driven Pricing, Metered Pro Caps Enforcement]

- [x] 1.1 RED: Add failing `apps/api/src/db/__tests__/stripe-schema.test.ts` asserting `tenant_billing_states` exposes `stripe_customer_id`, `stripe_subscription_id`, `stripe_subscription_status`, `current_period_end`, `cancel_at_period_end`, `billing_cycle`; that `stripe_processed_events` exists with `event_id` PK + `stripe_event_ts`; and that `billingSourceEnum` includes `stripe` and `billingCycleEnum` = `{monthly,annual}`.
- [x] 1.2 RED: Add failing `packages/contracts/src/__tests__/billing-dto.test.ts` asserting `BillingSource` accepts `'stripe'`, `BillingCycle` type exists, and `TenantBillingStateDTO` carries `billingCycle`/`currentPeriodEnd`/`cancelAtPeriodEnd`; plus `CheckoutSessionRequest/Response`, `PortalSessionResponse`, `InvoiceDTO` shapes compile.
- [x] 1.3 RED: Add failing `apps/api/src/billing/__tests__/pricing-config.test.ts` asserting `pricing-config.ts` reads env (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`), exports `PRO_TIER_LIMITS` = `{plan_generation:500, plan_regeneration:1000, memory_write:50000, memory_retrieval:200000}`, and derives annual save% as `round(1 - annual/monthly)` from amounts (no hardcoded 20%).
- [x] 1.4 GREEN: Add the additive columns + `stripe_processed_events` table + `billing_cycle` enum + `billingSourceEnum += 'stripe'` in `apps/api/src/db/schema.ts`, and generate the additive migration `apps/api/drizzle/0012_stripe_billing.sql`. NO changes to `resolveEffectiveTier`/`entitlement.ts`, NO routes, NO Stripe SDK import.
- [x] 1.5 GREEN: Extend `packages/contracts/src/index.ts` with `BillingSource 'stripe'`, `BillingCycle`, checkout/portal/invoice DTOs, and the new cycle/period fields on `TenantBillingStateDTO` (added optional to preserve zero-behavior-change in the 11a visibility mapper).
- [x] 1.6 GREEN: Create `apps/api/src/billing/pricing-config.ts` (env-driven prices + Product/Price IDs + `PRO_TIER_LIMITS` + derived save%). Do NOT yet wire it into `plan-limits.ts` (that swap is Slice 3) — export only, keeping `1_000_000` behavior unchanged.
- [x] 1.7 TRIANGLE: Add `apps/api/src/db/repositories/__tests__/stripe-schema.integration.test.ts` (real Postgres) proving migration up applies additively (existing 11a rows/columns intact), `stripe_processed_events` insert-on-conflict-do-nothing is exactly-once, and migration down drops only the new objects. Pair `describe.skipIf(!DATABASE_URL)` real suite with a `skipIf(hasDb)` placeholder.
- [x] 1.8 TRIANGLE: Extend `.github/workflows/ci-cd.yml` `billing-integration` job to run the new integration file and update the assert-executed guard count (DB-present passed vs DB-absent placeholders) so a dropped `DATABASE_URL` fails RED, not false-green.
- [x] 1.9 TRIANGLE: Prove ZERO behavior change — run the existing 11a suites (`entitlement.test.ts`, `billing-quota.integration.test.ts`) green with no edits, confirming `resolveEffectiveTier` and Free/Pro resolution are untouched by the additive columns.

## Phase 2: Slice 2 — Webhook + Subscription Lifecycle (hottest) [Requirements: Webhook Subscription Updates, Payment Security]

- [x] 2.1 RED: Add failing `apps/api/src/billing/__tests__/process-webhook.test.ts` for Threat Matrix + spec scenarios against `FakeStripeGateway`: signature spoof/replay (400, no write), raw-body tamper (verify fails), duplicate event_id (no-op 200), out-of-order stale timestamp ignored, fail-closed (handler error → 5xx, no Pro), active→`active`/`pro` source `stripe` (both cycles), cancel_at_period_end keeps Pro then period-end→`expired`, deletion→`expired`, payment-failed grace (`past_due` metadata, keep Pro) vs Stripe-not-entitled→`expired`.
- [x] 2.2 GREEN: Create pure `apps/api/src/billing/stripe-gateway.ts` port (`verifyAndParseEvent`, etc.) and pure `apps/api/src/billing/process-webhook.ts` mapping subscription→billing-state (grace policy encoded), plus `apps/api/src/db/repositories/stripe-events.ts` (idempotency insert-on-conflict + `stripe_event_ts` out-of-order guard + billing-state writer).
- [x] 2.3 GREEN: Register the encapsulated webhook plugin scope in `apps/api/src/routes/billing.ts` using `addContentTypeParser('application/json',{parseAs:'buffer'},…)` for raw body only in that scope; unauthenticated (signature is auth); wire in `apps/api/src/app.ts` with `FakeStripeGateway` injectable for tests.
- [x] 2.4 TRIANGLE: Add `apps/api/src/db/repositories/__tests__/stripe-webhook.integration.test.ts` (real PG, faked gateway) proving insert-on-conflict exactly-once state transition under retry, subscription→state write, and the #172 `overridden`/status reconciliation interaction (admin override still wins over a paid subscription write). Wire into the `billing-integration` CI job + guard count.

## Phase 3: Slice 3 — Checkout + Real Caps + Coupons [Requirements: Stripe Test Checkout, Coupon Support, Config-Driven Pricing, Metered Pro Caps Enforcement]

- [x] 3.1 RED: Add failing `create-checkout.test.ts` (monthly+annual Price selection, tenant from `authContext` not client input, 303/url response), `coupon.test.ts` (invalid/expired code rejected server-side with controlled error, no session created; valid code attached), and `plan-limits.test.ts` (Pro under cap allowed; Pro over cap → `tenant_quota_exhausted` like Free; paid supersedes trial).
- [x] 3.2 GREEN: Create pure `apps/api/src/billing/create-checkout.ts` + `validatePromotionCode` flow; extend the single SDK adapter `apps/api/src/db/repositories/stripe-gateway.ts` (only file importing `stripe`) with `createCheckoutSession`+coupon validation; wire checkout route in `apps/api/src/routes/billing.ts` + `app.ts`. (Port extended via segregated `CheckoutGateway` in `billing/stripe-gateway.ts` so the Slice 2 webhook port + fakes stay intact.)
- [x] 3.3 GREEN: Swap `apps/api/src/billing/plan-limits.ts` to import `PRO_TIER_LIMITS` from `pricing-config.ts`, removing the provisional `1_000_000`; `resolveTenantFeatureLimit` = `tier==='pro' ? PRO_TIER_LIMITS[f] : FREE_TIER_LIMITS[f]`.
- [x] 3.4 TRIANGLE: Prove cross-tenant checkout prevented (spoofed tenant id ignored), secrets never logged (log-scrub assertion), and real Pro caps enforced end-to-end via `FakeStripeGateway`; confirm no live Stripe key required. Added real-Postgres Pro-cap boundary test to `billing-quota.integration.test.ts` + bumped the CI assert-executed guard (30→31).

## Phase 4: Slice 4 — Customer Portal + Invoices [Requirements: Stripe Customer Portal, Invoice History, Payment Security]

- [ ] 4.1 RED: Add failing `create-portal-session.test.ts` (portal session from tenant `stripe_customer_id` resolved via `authContext`; tenant-scoped; no cross-tenant) and `list-invoices.test.ts` (live Stripe list mapped to privacy-safe `InvoiceDTO` with no PAN; empty state; tenant-scoped).
- [ ] 4.2 GREEN: Create pure `apps/api/src/billing/create-portal-session.ts` + `list-invoices.ts` using the `StripeGateway` port; add `createPortalSession`/`listInvoices` to the adapter; wire `POST /billing/portal` + `GET /billing/invoices` routes (authenticated) in `billing.ts` + `app.ts`.
- [ ] 4.3 TRIANGLE: Prove `InvoiceDTO` mapping strips card PAN (only `cardBrand`/`cardLast4` allowed), empty-invoice state renders no error, and portal/invoice customer identity is never taken from client input.

## Phase 5: Slice 5 — Web Billing UI [Requirements: Web Billing Screen, Config-Driven Pricing]

- [ ] 5.1 RED: Add failing web tests under `apps/web/src/app/(app)/billing/__tests__/` for OD layout (sidebar+main+aside), per-feature `used / limit` meters, invoice history, Pro card with Monthly/Annual toggle + derived save badge, payment-method + support cards, and the privacy boundary (own tenant + own usage only). Add EN/ES parity + a11y tests; assert "hasta N/mes" metered copy replaces any "ilimitado/unlimited" string.
- [ ] 5.2 GREEN: Build/modify `apps/web/src/app/(app)/billing/*` + `AppShell/*` reproducing the OD tokens (dark oklch, lime accent, Space Grotesk + DM Sans); toggle updates displayed price + save badge from config; wire CTAs to `POST /billing/checkout` (selected cycle) and `POST /billing/portal`.
- [ ] 5.3 GREEN: Add `packages/i18n/src/messages/{en,es}.json` keys for all billing copy including the concrete "hasta N/mes" metered strings (NOT "ilimitado"); render meters from real caps.
- [ ] 5.4 TRIANGLE: Runtime smoke on `/billing` (tenant switch, loading/empty/error/offline, monthly/annual toggle, checkout + portal CTA), a11y pass, and EN/ES parity; write rollout/rollback notes to the verify report.
