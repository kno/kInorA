# Delta for 11b-v1-billing-stripe-integration

## MODIFIED Requirements

### Requirement: Stripe Test Checkout

The system MUST create Stripe-hosted checkout sessions in test mode for Pro upgrades, offering both a **monthly** and an **annual** billing cycle backed by two config-driven Stripe Prices. Card data MUST NOT be collected, transmitted, or stored on our servers — checkout is entirely Stripe-hosted. The tenant MUST be bound to the session server-side from `authContext` (via `client_reference_id`/metadata), never from client-supplied tenant input. A successful paid subscription MUST result in the tenant's effective tier becoming Pro (via the webhook-driven state write), superseding any remaining trial.
(Previously: sessions were created in test mode for Pro upgrades with a single unspecified price and no cycle/hosting/tenant-binding constraints.)

#### Scenario: Free user upgrades to Pro via checkout

- GIVEN an active member of a Free-tier tenant selects "Upgrade to Pro"
- WHEN they complete a Stripe-hosted test-mode checkout for that tenant
- THEN the resulting active subscription drives the tenant billing state to `status='active'`/`tier='pro'` and the effective tier resolves to Pro

#### Scenario: Monthly vs annual cycle selection

- GIVEN the two configured Stripe Prices for the monthly and annual cycles
- WHEN a user starts checkout choosing the monthly cycle and another user chooses the annual cycle
- THEN each session is created against the Price for the selected cycle and both, once paid, yield `tier='pro'`

#### Scenario: No card data on our servers

- GIVEN a checkout is initiated
- WHEN the payment details are entered
- THEN they are entered only on the Stripe-hosted surface and no card/PAN data is received or persisted by our API

#### Scenario: Tenant binding is server-derived

- GIVEN a member authenticated in tenant T requests checkout
- WHEN the checkout session is created
- THEN the tenant reference is taken from `authContext` and a client-supplied tenant id cannot redirect the subscription to another tenant

### Requirement: Webhook Subscription Updates

Stripe webhook events MUST drive the tenant billing subscription lifecycle idempotently and fail-closed. Each event MUST be processed at most once, keyed by the Stripe event id in a dedicated processed-events store (insert-on-conflict-do-nothing). An active paid subscription (monthly or annual) MUST map to `status='active'`/`tier='pro'` with source `stripe`; cancellation MUST keep Pro until `current_period_end` and then reconcile to `status='expired'`→free; a subscription deletion/expiry MUST reconcile to `expired`→free. Out-of-order events MUST be guarded by subscription timestamp so a stale event never overwrites newer state. The additive Stripe columns MUST NOT be read by `resolveEffectiveTier`, which remains the source of truth; a paid subscription supersedes a trial only by writing `active`/`pro`. Any webhook processing failure MUST NOT grant or retain Pro (fail-closed).
(Previously: webhook events updated subscription state idempotently, with only the duplicate-event guarantee specified.)

#### Scenario: Duplicate webhook processed once

- GIVEN Stripe delivers the same subscription event twice with the same event id
- WHEN both deliveries are processed
- THEN the billing state is updated exactly once and no side effect is applied twice

#### Scenario: Active subscription grants Pro

- GIVEN a checkout completes and Stripe reports the subscription active
- WHEN the corresponding webhook is processed
- THEN the tenant billing state is written `status='active'`/`tier='pro'` with source `stripe` and effective tier resolves to Pro

#### Scenario: Cancellation keeps Pro until period end

- GIVEN a Pro subscriber cancels with `cancel_at_period_end=true`
- WHEN the cancellation webhook is processed
- THEN the tenant remains Pro until `current_period_end`, after which the state reconciles to `expired` and effective tier resolves to Free

#### Scenario: Subscription deleted reverts to Free

- GIVEN a Pro tenant's subscription is deleted/expired at Stripe
- WHEN the deletion webhook is processed
- THEN the billing state reconciles to `status='expired'` and effective tier resolves to Free with tenant data preserved

#### Scenario: Payment failure — happy path retained

- GIVEN a Pro subscription whose renewal payment succeeds after a transient retry
- WHEN the payment-succeeded webhook is processed
- THEN the tenant remains `active`/`pro` with no downgrade

#### Scenario: Payment failure — failure path

- GIVEN a Pro subscription whose renewal payment ultimately fails and Stripe marks the subscription past-due/unpaid or cancels it
- WHEN the payment-failed/subscription-update webhook is processed
- THEN minimal handling applies: the tenant retains Pro only while Stripe still reports the subscription as entitled, and once Stripe reports it no longer active/entitled the state reconciles to `expired`→Free

#### Scenario: Out-of-order event ignored

- GIVEN the current billing state reflects a newer subscription timestamp
- WHEN an older, out-of-order subscription event arrives
- THEN it is ignored (or reconciled without regression) and does not overwrite the newer state

#### Scenario: Webhook failure never grants Pro

- GIVEN a webhook cannot be processed successfully (validation, mapping, or persistence error)
- WHEN processing aborts
- THEN no Pro entitlement is written and the tenant retains its prior (non-elevated) state

### Requirement: Coupon Support

The system MUST validate coupon/promotion codes **server-side before checkout session creation** so it owns the invalid-code error copy. An invalid, unknown, or expired code MUST be rejected with our own controlled invalid-code error and MUST NOT create a checkout session. A valid code MUST be applied to the created session so its discount is reflected at Stripe checkout.
(Previously: coupon codes were supported during checkout with only the invalid-coupon rejection specified and no server-side pre-validation boundary.)

#### Scenario: Invalid coupon rejected before checkout

- GIVEN a user enters an unknown or expired coupon code
- WHEN the backend validates the code prior to session creation
- THEN validation fails with our controlled invalid-code error and no checkout session is created

#### Scenario: Valid coupon applied

- GIVEN a user enters a valid, active coupon code
- WHEN the backend validates it and creates the checkout session
- THEN the coupon/discount is attached to the session and reflected in the Stripe-hosted checkout total

## ADDED Requirements

### Requirement: Config-Driven Pricing

Pricing MUST be config-driven from env/secret (Stripe Price/Product IDs and displayed amounts), backoffice-ready but with no backoffice UI in scope. The initial configured values MUST be 9,99 €/month for the monthly cycle and 7,99 €/month billed annually (an approximate 20% saving). Displayed prices and the save badge MUST derive from configuration, not hardcoded literals in application code.

#### Scenario: Prices sourced from configuration

- GIVEN the monthly and annual Price/Product IDs and amounts are provided via env/secret
- WHEN checkout and the billing screen render pricing
- THEN the displayed amounts and the Price used for each cycle come from configuration and changing configuration changes them without code edits

#### Scenario: Secrets are never logged

- GIVEN Stripe secret keys and webhook signing secrets are configured
- WHEN checkout, webhook, portal, or invoice operations run
- THEN no secret value is written to logs or error output

### Requirement: Metered Pro Caps Enforcement

Pro tenants MUST be gated by finite, high, per-feature monthly metered caps that replace the provisional `1_000_000` placeholder, using the same hybrid tenant/member gating and denial reasons as Free (consistency with 11a). `resolveEffectiveTier` remains the source of truth for tier, and a paid subscription supersedes a trial. The confirmable initial Pro caps per calendar month are: `plan_generation` 500, `plan_regeneration` 1000, `memory_write` 50000, `memory_retrieval` 200000. (These specific values are confirmable in the design phase; the metered-cap behavior is fixed.)

#### Scenario: Pro under cap allowed

- GIVEN a Pro tenant is below its per-feature monthly cap
- WHEN an active member requests that premium AI feature
- THEN access is allowed and metered once against the tenant and member

#### Scenario: Pro over cap denied like Free-over-limit

- GIVEN a Pro tenant has reached a per-feature monthly cap
- WHEN another request for that feature is made
- THEN it is denied with reason `tenant_quota_exhausted` and no AI work starts, consistent with Free-tier gating

#### Scenario: Paid subscription supersedes trial

- GIVEN a tenant inside its 30-day trial completes a paid subscription
- WHEN the webhook writes `status='active'`/`tier='pro'`
- THEN effective tier resolves to Pro under the metered caps regardless of remaining trial days

### Requirement: Stripe Customer Portal

An authenticated Pro member MUST be able to open the Stripe-hosted Customer Portal for their tenant to manage payment method and cancel/modify the subscription, with no card data collected or stored on our servers. The portal session MUST be created server-side from the tenant's `stripe_customer_id` resolved from `authContext`, never from client-supplied customer/tenant input.

#### Scenario: Pro user opens the Customer Portal

- GIVEN an authenticated member of a Pro tenant with a Stripe customer
- WHEN they request to manage billing
- THEN a Stripe-hosted portal session is created server-side from that tenant's `stripe_customer_id` and they are redirected to the hosted portal

#### Scenario: Portal is tenant-scoped

- GIVEN a member authenticated in tenant T
- WHEN a portal session is requested
- THEN the customer is resolved from T's billing state via `authContext` and cannot be pointed at another tenant's Stripe customer

#### Scenario: No card data on our servers via portal

- GIVEN payment-method changes are made
- WHEN they occur
- THEN they occur only on the Stripe-hosted portal and no card/PAN data reaches or is stored by our API

### Requirement: Invoice History

An authenticated member MUST be able to view their tenant's invoice history read from the Stripe API and download the corresponding receipts. There is no local invoice store; listings are fetched live from Stripe scoped to the tenant's Stripe customer. When no invoices exist an empty state MUST be shown.

#### Scenario: List tenant invoices

- GIVEN a Pro tenant has past Stripe invoices
- WHEN a member of that tenant views invoice history
- THEN the invoices for that tenant's Stripe customer are listed with downloadable receipts

#### Scenario: Empty invoice state

- GIVEN a tenant has no Stripe invoices yet
- WHEN a member views invoice history
- THEN an empty state ("no charges yet") is shown and no error occurs

#### Scenario: Invoices are tenant-scoped

- GIVEN a member authenticated in tenant T
- WHEN invoices are listed
- THEN only T's Stripe customer's invoices are returned and no other tenant's invoices are exposed

### Requirement: Web Billing Screen

The web billing screen MUST reproduce the authoritative Open Design layout and tokens (see `design-reference-open-design.md`): sidebar + main (plan hero, per-feature usage meters with `used / limit`, invoice history) + aside (Pro card with a Monthly/Annual toggle and save badge, payment-method card, support). It MUST render the tenant's tier, status, trial state, usage, and an upgrade prompt, and wire the CTAs to checkout and the Customer Portal. It MUST NOT invent a new layout. Privacy MUST reuse the 11a boundary: a member sees only their own tenant's billing state and their own allocation usage, never other members' private content or other tenants' billing.

#### Scenario: Billing state renders per design

- GIVEN an authenticated member opens the billing screen
- WHEN the screen loads
- THEN tier, status, trial state, per-feature usage meters, invoice history, and an upgrade prompt render in the Open Design layout/tokens

#### Scenario: Monthly/annual toggle

- GIVEN the Pro upgrade card is shown
- WHEN the user toggles between Monthly and Annual
- THEN the displayed price and save badge update to the configured value for that cycle and the "Upgrade to Pro" CTA starts checkout for the selected cycle

#### Scenario: Member sees only own tenant billing and own usage

- GIVEN a member belongs to a tenant with other members
- WHEN the billing screen loads
- THEN it shows only the active tenant's billing state and the requesting member's own allocation usage, exposing no other member's private content and no other tenant's billing

### Requirement: Payment Security

Payment surfaces MUST be secured. The webhook route MUST verify the Stripe signature against the raw request body and reject unsigned or invalid-signature events; the route is unauthenticated because the signature is the authentication. Checkout, portal, and invoice operations MUST be tenant-scoped with the tenant/customer identity derived from `authContext` and never crossing tenants. The system MUST fail closed: no payment operation may grant Pro on a verification or processing failure.

#### Scenario: Unsigned or invalid-signature webhook rejected

- GIVEN a webhook request arrives with a missing or invalid Stripe signature
- WHEN the raw body is verified against the signing secret
- THEN the event is rejected and no billing state is changed

#### Scenario: Cross-tenant payment access prevented

- GIVEN a member authenticated in tenant T
- WHEN they invoke checkout, portal, or invoice endpoints
- THEN the tenant/customer identity is taken from `authContext` and no parameter can access another tenant's checkout, portal, or invoices

#### Scenario: Fail-closed on verification failure

- GIVEN any payment operation encounters a signature, validation, or processing failure
- WHEN the operation aborts
- THEN no Pro entitlement is granted or retained as a side effect

## Notes

- **Design-copy reconciliation (for design phase)**: the Open Design copy states Pro is "ilimitado / sin límite", but the product decision is finite high metered caps (see `Metered Pro Caps Enforcement`). These are in direct conflict. **Recommendation: option (b)** — change the UI copy so it reflects high metered limits (e.g. "amplias generaciones incluidas" / show the actual high `used / limit` meters) rather than claiming literally unlimited, because the enforcement path denies over-cap Pro requests and "unlimited" copy would be misleading and a support risk. Option (a) — set caps effectively-unlimited and keep the "ilimitado" copy — is only acceptable if product explicitly wants no practical Pro ceiling; that contradicts the confirmable caps above. The design phase MUST resolve this before the web slice and choose the copy accordingly.
- **Confirmable values (for design phase)**: the exact Pro per-feature caps and the precise set of Stripe events driving tier changes (e.g. `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`) plus the minimal grace-vs-expire payment-failure policy are confirmable in design; the behaviors specified above (idempotent, out-of-order-guarded, fail-closed, cancel-until-period-end) are fixed.
- **Annual save %**: whether the "save 20%" badge is a fixed config value or derived from monthly vs annual amounts is a design decision; `Config-Driven Pricing` requires it to derive from configuration either way.
