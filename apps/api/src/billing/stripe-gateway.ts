import type { BillingCycle } from "@kinora/contracts";

/**
 * Pure StripeGateway PORT (11b-v1-billing-stripe-integration, Slice 2).
 *
 * This file is framework- and SDK-free: it declares ONLY the domain-shaped
 * types the webhook use case needs and the port interface it depends on. The
 * concrete adapter that imports the `stripe` node SDK lives in the infra layer
 * (`db/repositories/stripe-gateway.ts`) — the dependency-cruiser boundary keeps
 * the `stripe` import out of every pure use case, exactly like the 11a
 * drizzle-adapter / pure-use-case split.
 */

/**
 * The Stripe subscription statuses we map, as a single canonical tuple.
 * `StripeSubscriptionStatus` is DERIVED from this array (`typeof [...][number]`)
 * so the type and the runtime allow-list (the infra adapter's
 * `normalizeStatus`) can never drift apart — adding a status here is the ONE
 * place that needs editing (4R readability fix: a hand-duplicated `Set` had no
 * compile-time link to this union and would have silently let a new Stripe
 * status fall through to the fail-closed `canceled` default forever).
 *
 * `active`/`trialing` are entitled; `past_due` is the grace state (keep Pro
 * while Stripe retries); everything else reconciles to expired (fail-closed
 * for any unknown status).
 */
export const STRIPE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;

export type StripeSubscriptionStatus = (typeof STRIPE_SUBSCRIPTION_STATUSES)[number];

/**
 * A normalized, SDK-free projection of the Stripe subscription carried by a
 * webhook event. `tenantId` is resolved server-side from the SIGNED payload
 * (subscription metadata / checkout `client_reference_id`) and is NEVER taken
 * from untrusted request input. It is null when the event carries no resolvable
 * tenant, in which case the webhook acknowledges and applies no state.
 */
export interface StripeSubscriptionSnapshot {
  tenantId: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: StripeSubscriptionStatus;
  cycle: BillingCycle | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /**
   * The Stripe subscription item quantity (16c v3 Slice A — seat-based
   * billing). `null` when the subscription carries no readable quantity
   * (e.g. no items, or a non-numeric quantity on the SDK shape). NOT yet
   * persisted anywhere — Slice B wires this into `tenant_billing_states.
   * seat_count` via the webhook write path. Never read by
   * `resolveEffectiveTier`.
   */
  seatQuantity: number | null;
}

/**
 * A verified, normalized Stripe webhook event. `eventTs` is the ordering key
 * (the Stripe event `created` timestamp) used for the out-of-order guard.
 * `subscription` is null for events that carry no subscription snapshot.
 */
export interface StripeWebhookEvent {
  id: string;
  type: string;
  eventTs: Date;
  subscription: StripeSubscriptionSnapshot | null;
}

/**
 * Thrown by {@link StripeGateway.verifyAndParseEvent} when the signature is
 * missing, malformed, or does not match the raw body under the signing secret.
 * The message NEVER contains the payload or any secret — the route maps this to
 * a 400 with no state write (fail-closed).
 */
export class StripeSignatureError extends Error {
  constructor(message = "stripe signature verification failed") {
    super(message);
    this.name = "StripeSignatureError";
  }
}

/**
 * Thrown when the gateway itself cannot verify ANY event because Stripe is not
 * configured (missing secret key / webhook signing secret) — an
 * OPERATOR/SERVER fault, never a client/spoof fault. Deliberately NOT a
 * subclass of {@link StripeSignatureError}: the webhook use case (`process-
 * webhook.ts`) only maps `StripeSignatureError` to the permanent
 * `invalid_signature` (400) outcome. This error propagates instead, so the
 * route returns 5xx and Stripe safely RETRIES until the deployment is
 * configured — a misconfigured deploy must never silently DROP real billing
 * events behind a client-fault 400 (4R resilience fix).
 */
export class StripeGatewayUnconfiguredError extends Error {
  constructor(message = "stripe webhook gateway is not configured") {
    super(message);
    this.name = "StripeGatewayUnconfiguredError";
  }
}

/**
 * The port the webhook use case depends on. The infra adapter verifies the raw
 * body against the signing secret with `stripe.webhooks.constructEvent` and
 * normalizes the Stripe event into a {@link StripeWebhookEvent}. Verification
 * failure MUST throw {@link StripeSignatureError} BEFORE any parsing/side effect.
 */
export interface StripeGateway {
  verifyAndParseEvent(
    rawBody: Buffer | string,
    signature: string | undefined,
  ): StripeWebhookEvent;
}

// ---------------------------------------------------------------------------
// Checkout + coupon port (11b-v1-billing-stripe-integration, Slice 3).
//
// Interface-segregated from {@link StripeGateway}: the checkout use case needs
// ONLY these methods, and keeping the webhook port narrow means the Slice 2
// `FakeStripeGateway` (bare `{ verifyAndParseEvent }`) still satisfies its
// contract. The SINGLE SDK adapter (`db/repositories/stripe-gateway.ts`)
// implements BOTH ports, so all `stripe` imports stay confined to that one file.
// ---------------------------------------------------------------------------

/**
 * Result of a SERVER-SIDE promotion-code validation. `promotionCodeId` is the
 * Stripe `promotion_code` id to attach to the session, present ONLY when the
 * code validates. An invalid/expired code yields `{ valid: false, promotionCodeId: null }`.
 */
export interface PromotionCodeValidation {
  valid: boolean;
  promotionCodeId: string | null;
}

/**
 * Input to open a Stripe-hosted checkout session for a Pro upgrade. `tenantId`
 * is resolved SERVER-SIDE from `authContext` by the route and becomes the
 * session `client_reference_id` + subscription metadata `tenantId` — the same
 * key the webhook reads back to grant Pro. It is NEVER taken from client input.
 * `priceId` is the config-driven Stripe Price for the requested cycle;
 * `promotionCodeId` is a pre-validated Stripe promotion-code id or null.
 */
export interface CreateCheckoutSessionInput {
  tenantId: string;
  cycle: BillingCycle;
  priceId: string;
  promotionCodeId: string | null;
}

/** The Stripe-hosted checkout session URL to redirect the buyer to. */
export interface CheckoutSession {
  url: string;
}

/**
 * Thrown by the checkout use case when a supplied promotion code is invalid or
 * expired. It is OUR OWN controlled error: the route maps it to a 422 and NO
 * Stripe checkout session is created (fail-closed on the payments hot path).
 * The message NEVER contains the raw code or any secret.
 */
export class InvalidPromotionCodeError extends Error {
  constructor(message = "invalid or expired promotion code") {
    super(message);
    this.name = "InvalidPromotionCodeError";
  }
}

/**
 * The checkout/coupon port the pure `CreateCheckout` use case depends on. The
 * infra adapter calls the Stripe SDK (`checkout.sessions.create`,
 * `promotionCodes.list`) and never leaks a secret. Segregated from
 * {@link StripeGateway} so each pure use case depends only on the methods it uses.
 */
export interface CheckoutGateway {
  validatePromotionCode(code: string): Promise<PromotionCodeValidation>;
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>;
}

// ---------------------------------------------------------------------------
// Customer Portal + invoice ports (11b-v1-billing-stripe-integration, Slice 4).
//
// Interface-segregated from {@link StripeGateway}/{@link CheckoutGateway}: the
// portal use case needs ONLY `createPortalSession` and the invoice use case
// ONLY `listInvoices`, so the Slice 2/3 fakes keep satisfying their narrower
// contracts. The SINGLE SDK adapter (`db/repositories/stripe-gateway.ts`)
// implements EVERY port, so all `stripe` imports stay confined to that one file.
//
// The Stripe CUSTOMER identity is NEVER accepted from client input. It is
// resolved SERVER-SIDE from OUR `tenant_billing_states.stripe_customer_id`
// keyed by the `authContext` tenant (see BillingCustomerReaderPort in
// `create-portal-session.ts`) and only then handed to these gateway methods.
// ---------------------------------------------------------------------------

/** The Stripe-hosted Customer Portal URL to redirect the member to. */
export interface PortalSession {
  url: string;
}

/**
 * Thrown by the portal use case when the tenant has NO `stripe_customer_id`
 * (never subscribed). It is OUR OWN controlled precondition error: a portal
 * cannot exist without a Stripe customer, so the route maps it to a clean 409
 * — NOT a 500/crash. The message NEVER contains a customer id or any secret.
 */
export class NoStripeCustomerError extends Error {
  constructor(message = "tenant has no stripe customer") {
    super(message);
    this.name = "NoStripeCustomerError";
  }
}

/**
 * A privacy-safe, SDK-free projection of the fields we read off a Stripe
 * invoice. It carries NO full card number (PAN), CVC, or other member PII — the
 * adapter that talks to the `stripe` SDK is the trust boundary and extracts ONLY
 * these fields, so a PAN can never cross the port into a pure use case by type.
 * `created` is the Stripe unix-seconds timestamp; card display fields are null
 * when the invoice has no associated card.
 */
export interface StripeInvoiceView {
  id: string;
  amountDue: number;
  currency: string;
  status: string;
  created: number;
  hostedInvoiceUrl: string | null;
  receiptUrl: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
}

/** The Customer Portal port the pure `CreatePortalSession` use case depends on. */
export interface PortalGateway {
  createPortalSession(stripeCustomerId: string): Promise<PortalSession>;
}

/** The invoice-listing port the pure `ListInvoices` use case depends on. */
export interface InvoiceGateway {
  listInvoices(stripeCustomerId: string): Promise<StripeInvoiceView[]>;
}

// ---------------------------------------------------------------------------
// Price-lookup port (#195 — displayed prices sourced from the Stripe Price API).
//
// The displayed monthly/annual amounts MUST come from the SAME Stripe Price
// objects checkout actually charges (`STRIPE_PRICE_MONTHLY` /
// `STRIPE_PRICE_ANNUAL`), not from independent display-only env amounts that can
// silently drift. Interface-segregated like the other billing ports so the pure
// `ResolveBillingPricing` use case depends only on this method; the single SDK
// adapter (`db/repositories/stripe-gateway.ts`) implements it via
// `stripe.prices.retrieve`.
// ---------------------------------------------------------------------------

/** The recurring interval of a Stripe Price, normalized to the shapes we map. */
export type StripePriceInterval = "month" | "year";

/**
 * A privacy-safe, SDK-free projection of a Stripe Price object. `unitAmount` is
 * the amount charged per interval in the currency's MINOR unit (e.g. cents), or
 * null when the Price carries no fixed unit amount. `interval` is the recurring
 * interval, or null for a non-recurring/one-off Price.
 */
export interface StripePrice {
  unitAmount: number | null;
  currency: string;
  interval: StripePriceInterval | null;
}

/** The Price-lookup port the pure `ResolveBillingPricing` use case depends on. */
export interface PriceGateway {
  retrievePrice(priceId: string): Promise<StripePrice>;
}

// ---------------------------------------------------------------------------
// Subscription-quantity port (16c v3 B2B seat-based billing, Slice A).
//
// Pure Stripe infra ONLY in this slice: no seat-count source, no persistence,
// no limit-scaling — those land in later slices (B–D). This port exists so a
// future seat-sync use case can depend on ONLY `updateSubscriptionQuantity`,
// interface-segregated like every other gateway port here. The single SDK
// adapter (`db/repositories/stripe-gateway.ts`) implements it.
// ---------------------------------------------------------------------------

/**
 * The seat-quantity port a future seat-sync use case depends on.
 * `updateSubscriptionQuantity` sets the Stripe subscription's (first) item
 * quantity with `proration_behavior: "create_prorations"` — an immediate
 * pro-rated charge/credit on add/remove (design Q3). `idempotencyKey` MUST be
 * supplied by the caller so a retried outbound call is safe; this port does
 * not generate one itself.
 */
export interface SubscriptionGateway {
  updateSubscriptionQuantity(
    subscriptionId: string,
    quantity: number,
    idempotencyKey: string,
  ): Promise<void>;
}
