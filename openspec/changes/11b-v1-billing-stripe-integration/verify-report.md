# Verify Report — 11b-v1-billing-stripe-integration / Slice 5 (Web Billing UI)

## Scope
Web billing screen (PR5, final slice): reproduces the Open Design `screens/web-billing.html`
layout + tokens, renders per-feature metered usage (`used / limit`, "up to N/mo" — never
"unlimited/ilimitado"), invoice history (owner-only), a Monthly/Annual Pro card with a
config-driven price + derived save badge, payment-method + support cards, and wires the CTAs
to the merged API (`POST /billing/checkout`, `POST /billing/portal`, `GET /billing/invoices`,
new `GET /billing/pricing`).

## Gate results (exact)
| Gate | Command | Result |
|---|---|---|
| Type-check | `pnpm type-check` (6 packages) | PASS |
| Build | `pnpm build` (deps-guard, ui-api-guard, architecture/depcruise, all tsc, web build) | PASS |
| Full coverage (pre-push equivalent) | `pnpm -r --if-present test:coverage` | EXIT 0 / PASS |

Per-package tests: contracts 58 · domain 255 · i18n 30 · api 1047 passed (+34 skipped) · web 920 passed · 0 failed.
Web global function coverage 90.69% (threshold 90).

## Requirements coverage
- **Web Billing Screen** — OD layout (main+aside regions; sidebar is the shared AppShell), plan hero, metered usage meters, invoice history, upgrade prompt; privacy = own tenant + own usage (visibility endpoint is member-scoped, invoices/portal owner-only). Covered by `BillingPageClient.test.tsx` (26 tests).
- **Config-Driven Pricing** — displayed amounts + derived save % come from `GET /billing/pricing` (env-backed `buildBillingPricing`), never hardcoded in the web. Covered by `pricing-config.test.ts`, `billing-visibility.test.ts` (pricing route), `billing-client.test.ts`, `BillingPageClient.test.tsx` (toggle updates price + save badge).
- **Metered-cap reconciliation** — copy asserts "up to N/mo" / "hasta N/mes" and NO "unlimited"/"ilimitado" string; pre-existing `billing.upgrade.description` reworded in both locales.
- **Owner boundary** — invoice history + portal/manage CTA shown only when the owner-only invoice read did NOT 403; a proven non-owner (403 → `forbidden`) sees tier/trial/usage but no owner-only actions; refreshed on tenant switch.

## Rollout notes
- **Config**: set the Stripe display-price env vars in the API deploy env (all optional; sensible defaults ship):
  `STRIPE_PRICE_MONTHLY_AMOUNT` (minor units, default `999`), `STRIPE_PRICE_ANNUAL_AMOUNT` (per-month minor units, default `799`), `STRIPE_PRICE_CURRENCY` (default `eur`). The save badge is derived, not configured.
  The existing Stripe secrets/Price IDs (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`) are unchanged.
- **No schema/migration change in this slice** — web + one additive read-only route only. Zero data migration.
- **Support link** — the support card links to `/help/billing`; ensure that route/redirect exists or update the href before enabling if the FAQ lives elsewhere.
- Deploy order: API (for `GET /billing/pricing`) before/with web; the web degrades gracefully (Pro card hides its price block) if pricing is unavailable.

## Rollback notes
- **Boundary**: revert the web slice — `apps/web/src/app/(app)/billing/*` (BillingPageClient.tsx, BillingPageClient.module.css, billing-types.ts, billing-client.ts pricing/invoices/checkout/portal additions, actions.ts additions, page.tsx) — plus the additive `GET /billing/pricing` route in `apps/api/src/routes/billing.ts`, `buildBillingPricing`/display config in `apps/api/src/billing/pricing-config.ts`, the `BillingPricingDTO`/`BillingCyclePriceDTO` contracts, and the +49 `billing.*` i18n keys (revert count 83 → 34).
- Reverting is safe and self-contained: no DB objects, no changes to entitlement/webhook/checkout/portal/invoice behavior from Slices 1–4. The prior 11a-Phase-4 billing page is restored by reverting these files.

## Deferred / not run locally
- **Real-stack `/billing` runtime smoke** (`pnpm --filter api dev` + `pnpm --filter web dev`: tenant switch, loading/empty/error/offline, Monthly/Annual toggle, live checkout + portal redirect, EN/ES + a11y) could NOT be executed locally because local **podman is DOWN** (no API/Postgres/Stripe-stub stack available). This is covered by the web unit/component suite and MUST be run in CI or a podman-up environment before release. No e2e/real-stack evidence is claimed for this slice beyond the unit/component + type/build/coverage gates above.
