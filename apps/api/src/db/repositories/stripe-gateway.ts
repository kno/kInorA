import Stripe from "stripe";
import type { BillingCycle } from "@kinora/contracts";
import {
  STRIPE_SUBSCRIPTION_STATUSES,
  StripeGatewayUnconfiguredError,
  StripeSignatureError,
  type CheckoutGateway,
  type CheckoutSession,
  type CreateCheckoutSessionInput,
  type InvoiceGateway,
  type PortalGateway,
  type PortalSession,
  type PriceGateway,
  type PromotionCodeValidation,
  type StripeGateway,
  type StripeInvoiceView,
  type StripePrice,
  type StripePriceInterval,
  type StripeSubscriptionSnapshot,
  type StripeSubscriptionStatus,
  type SubscriptionGateway,
  type StripeWebhookEvent,
} from "../../billing/stripe-gateway.js";

/**
 * Max invoices returned per {@link StripeApiGateway.listInvoices} call (11b
 * Slice 4 4R FIX 3, readability). No pagination in this slice — the web
 * invoice-history list (Slice 5) shows a single page, so this bounds the
 * Stripe read to that page size rather than an unexplained magic number.
 */
const INVOICE_LIST_LIMIT = 24;

/**
 * The ONLY file in `apps/api` that imports the `stripe` node SDK
 * (11b-v1-billing-stripe-integration). It lives in the infra layer
 * (`db/repositories`) — the same boundary the dependency-cruiser already
 * permits for persistence adapters — so the pure use cases in `billing/*`
 * depend only on the {@link StripeGateway} port and stay SDK-free and
 * deterministically testable against a `FakeStripeGateway`.
 *
 * Secret handling: the secret key and webhook signing secret are passed in from
 * env at the composition root and are NEVER logged. A verification failure is
 * surfaced as a {@link StripeSignatureError} whose message carries no payload
 * and no secret.
 */
export class StripeApiGateway
  implements
    StripeGateway,
    CheckoutGateway,
    PortalGateway,
    InvoiceGateway,
    PriceGateway,
    SubscriptionGateway
{
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    /**
     * Base web URL the Stripe-hosted checkout redirects back to on
     * success/cancel (e.g. `WEB_PUBLIC_ORIGIN`). Kept out of the signed webhook
     * path; used only by {@link createCheckoutSession}.
     */
    private readonly returnUrl: string = "",
    stripeClient?: Stripe,
  ) {
    // Injectable client for hermetic tests; production constructs from the key.
    // Bounded timeout + limited retries (4R FIX 1, resilience): the SDK default
    // has no request timeout, and neither the checkout nor the coupon call
    // passes an AbortSignal, so a Stripe brownout (reachable but slow) would
    // stall a POST /billing/checkout for the SDK's own ~80s ceiling — the
    // first synchronous outbound Stripe call on a request path (webhook
    // verification is local). `timeout: 10_000` + `maxNetworkRetries: 1` makes
    // a degraded Stripe fail fast to a clean 5xx (Fastify has no default
    // request timeout, so unbounded stalls would otherwise pile up
    // concurrent attempts) instead of hanging for tens of seconds.
    this.stripe = stripeClient ?? new Stripe(secretKey, { timeout: 10_000, maxNetworkRetries: 1 });
  }

  verifyAndParseEvent(
    rawBody: Buffer | string,
    signature: string | undefined,
  ): StripeWebhookEvent {
    if (!signature) {
      throw new StripeSignatureError("missing stripe-signature header");
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch {
      // Deliberately swallow the underlying error: it can echo body/secret
      // fragments. Surface only a generic, secret-free signature failure.
      throw new StripeSignatureError();
    }
    return normalizeEvent(event);
  }

  /**
   * Validate a promotion code SERVER-SIDE (11b Slice 3). We own the invalid-code
   * decision: an inactive/absent code, or one whose coupon is no longer valid
   * (expired / usage-exhausted), returns `{ valid: false }` so the use case
   * rejects it WITHOUT opening a checkout session. The raw code is sent only to
   * Stripe for lookup and is never logged.
   */
  async validatePromotionCode(code: string): Promise<PromotionCodeValidation> {
    const list = await this.stripe.promotionCodes.list({ code, active: true, limit: 1 });
    const promo = list.data[0];
    if (!promo || !promo.active) {
      return { valid: false, promotionCodeId: null };
    }
    // A promotion code can be active while its underlying coupon has expired or
    // hit its redemption cap; Stripe flags that on `coupon.valid`. Read it
    // defensively — the expanded coupon is optional on the SDK list shape.
    const coupon = (promo as { coupon?: { valid?: boolean } }).coupon;
    if (coupon && coupon.valid === false) {
      return { valid: false, promotionCodeId: null };
    }
    return { valid: true, promotionCodeId: promo.id };
  }

  /**
   * Open a Stripe-hosted subscription checkout session (11b Slice 3). The tenant
   * (resolved SERVER-SIDE by the route from `authContext`) is stamped as both
   * `client_reference_id` and the subscription metadata `tenantId` — the exact
   * key the webhook reads back to grant Pro to the right tenant. No secret or
   * card data is logged; only the hosted URL is returned.
   */
  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: input.priceId, quantity: input.quantity ?? 1 }],
      client_reference_id: input.tenantId,
      subscription_data: { metadata: { tenantId: input.tenantId, cycle: input.cycle } },
      metadata: { tenantId: input.tenantId },
      // A validated promotion code is attached explicitly; otherwise the buyer
      // may still enter one on the hosted page.
      ...(input.promotionCodeId
        ? { discounts: [{ promotion_code: input.promotionCodeId }] }
        : { allow_promotion_codes: true }),
      // American spelling ("canceled") to match the rest of this module's
      // billing vocabulary (see STRIPE_SUBSCRIPTION_STATUSES's "canceled"
      // above) — the Slice-5 web client string-matches this query param, so a
      // British/American mismatch here would leave that UI state unreachable
      // (4R FIX 2, readability).
      success_url: `${this.returnUrl}/billing?checkout=success`,
      cancel_url: `${this.returnUrl}/billing?checkout=canceled`,
    });
    if (!session.url) {
      throw new Error("stripe checkout session did not return a url");
    }
    return { url: session.url };
  }

  /**
   * Open a Stripe-hosted Customer Portal session (11b Slice 4). The customer id
   * is resolved SERVER-SIDE by the route from `authContext` (our
   * `tenant_billing_states.stripe_customer_id`) and passed straight through — it
   * is NEVER accepted from client input. Card management / cancellation happen
   * only on the hosted portal; no card/PAN data ever reaches our API. No secret
   * is logged; only the hosted URL is returned.
   */
  async createPortalSession(stripeCustomerId: string): Promise<PortalSession> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${this.returnUrl}/billing`,
    });
    if (!session.url) {
      throw new Error("stripe portal session did not return a url");
    }
    return { url: session.url };
  }

  /**
   * List a customer's invoices LIVE from Stripe (11b Slice 4) — there is no
   * local invoice store. The customer id is resolved SERVER-SIDE by the route
   * (tenant-scoped) and never from client input. Each Stripe invoice is
   * projected to the privacy-safe {@link StripeInvoiceView}: only display-safe
   * fields (amounts, currency, dates, status, hosted/receipt URLs, and at most
   * the card brand + last four) — never a full PAN, CVC, or other member PII.
   */
  async listInvoices(stripeCustomerId: string): Promise<StripeInvoiceView[]> {
    const list = await this.stripe.invoices.list({
      customer: stripeCustomerId,
      limit: INVOICE_LIST_LIMIT,
      expand: ["data.charge"],
    });
    return list.data.map(toStripeInvoiceView);
  }

  /**
   * Retrieve a Stripe Price LIVE (#195) and project it to the SDK-free
   * {@link StripePrice}. This is the single source of truth for the DISPLAYED
   * amounts: they come from the SAME Price ids checkout charges, so the UI can
   * never show an amount that differs from what Stripe bills. Reads the unit
   * amount + currency + recurring interval defensively (optional across API
   * versions); a non-recurring or unrecognized interval maps to null. No secret
   * is logged.
   */
  async retrievePrice(priceId: string): Promise<StripePrice> {
    const price = await this.stripe.prices.retrieve(priceId);
    return {
      unitAmount: price.unit_amount ?? null,
      currency: price.currency ?? "",
      interval: normalizePriceInterval(price.recurring?.interval),
    };
  }

  /**
   * Set a subscription's seat quantity (16c v3 Slice A — pure Stripe infra;
   * no seat-count source or persistence wired here, that's later slices). The
   * Stripe SDK requires the SUBSCRIPTION ITEM id, not the subscription id, so
   * this retrieves the subscription first to read `items.data[0].id` before
   * updating. `proration_behavior: "create_prorations"` charges/credits the
   * difference immediately (design Q3). The caller-supplied `idempotencyKey`
   * makes a retried call safe; this method never generates its own.
   */
  async updateSubscriptionQuantity(
    subscriptionId: string,
    quantity: number,
    idempotencyKey: string,
  ): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error(`stripe subscription ${subscriptionId} has no items to update quantity on`);
    }
    await this.stripe.subscriptions.update(
      subscriptionId,
      { items: [{ id: item.id, quantity }], proration_behavior: "create_prorations" },
      { idempotencyKey },
    );
  }
}

/** Map a Stripe recurring interval to the intervals we surface (else null). */
function normalizePriceInterval(interval: string | undefined | null): StripePriceInterval | null {
  if (interval === "month") return "month";
  if (interval === "year") return "year";
  return null;
}

/**
 * Project a Stripe SDK invoice to the privacy-safe, SDK-free
 * {@link StripeInvoiceView}. Reads card display info DEFENSIVELY off the
 * expanded charge (its exact shape varies across Stripe API versions) and keeps
 * ONLY the brand + last four — the PAN, CVC, and any other PII are never read.
 */
function toStripeInvoiceView(invoice: Stripe.Invoice): StripeInvoiceView {
  const { brand, last4 } = readCardDisplay(invoice);
  return {
    id: invoice.id ?? "",
    amountDue: invoice.amount_due ?? 0,
    currency: invoice.currency ?? "",
    status: invoice.status ?? "",
    created: invoice.created ?? 0,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    // Deliberately the invoice PDF link (`invoice_pdf`), NOT the charge-level
    // `receipt_url` (11b Slice 4 4R FIX 3) — this is the downloadable invoice
    // document Stripe intends for invoice history, independent of whether the
    // underlying charge exposes its own receipt.
    receiptUrl: invoice.invoice_pdf ?? null,
    cardBrand: brand,
    cardLast4: last4,
  };
}

/**
 * Extract ONLY the card brand + last four from an invoice's expanded charge,
 * defensively (optional at every hop). Never reads a full card number.
 */
function readCardDisplay(invoice: Stripe.Invoice): { brand: string | null; last4: string | null } {
  const charge = (invoice as { charge?: unknown }).charge;
  if (!charge || typeof charge !== "object") {
    return { brand: null, last4: null };
  }
  const card = (
    charge as {
      payment_method_details?: { card?: { brand?: string | null; last4?: string | null } };
    }
  ).payment_method_details?.card;
  return { brand: card?.brand ?? null, last4: card?.last4 ?? null };
}

/**
 * Create the real gateway from env, or return null when the Stripe env is not
 * configured (so the API still boots cleanly, mirroring the optional AI stack).
 * A null gateway means the webhook route fails closed (every event → 400) and
 * the checkout route fails closed (→ 5xx) until Stripe is configured.
 *
 * Returns the CONCRETE {@link StripeApiGateway} (which implements BOTH the
 * webhook {@link StripeGateway} and the {@link CheckoutGateway} ports) so the
 * composition root can wire one adapter instance into both routes.
 */
export function createStripeGatewayFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StripeApiGateway | null {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) return null;
  const returnUrl = (env.WEB_PUBLIC_ORIGIN ?? "").trim();
  return new StripeApiGateway(secretKey, webhookSecret, returnUrl);
}

/**
 * A fail-closed gateway used when Stripe env is unconfigured. It NEVER grants
 * Pro from a webhook, but deliberately throws {@link StripeGatewayUnconfiguredError}
 * — NOT a {@link StripeSignatureError} — so the webhook use case propagates it
 * instead of mapping it to a permanent `invalid_signature` (400). The route
 * then returns 5xx and Stripe RETRIES the delivery until the deployment is
 * configured, rather than silently dropping real billing events for the whole
 * misconfiguration window (4R resilience fix — an unconfigured deploy is an
 * OPERATOR fault, not a spoofed/invalid signature). Never logs.
 */
export class UnconfiguredStripeGateway implements StripeGateway {
  verifyAndParseEvent(): StripeWebhookEvent {
    throw new StripeGatewayUnconfiguredError();
  }
}

/**
 * Fail-closed checkout gateway used when Stripe env is unconfigured (11b Slice
 * 3). Every checkout/coupon call throws {@link StripeGatewayUnconfiguredError}
 * so the route returns 5xx rather than silently opening (or pretending to open)
 * a checkout against a missing Stripe configuration. Never logs a secret.
 */
export class UnconfiguredCheckoutGateway implements CheckoutGateway {
  async validatePromotionCode(): Promise<PromotionCodeValidation> {
    throw new StripeGatewayUnconfiguredError();
  }
  async createCheckoutSession(): Promise<CheckoutSession> {
    throw new StripeGatewayUnconfiguredError();
  }
}

/**
 * Fail-closed portal/invoice gateway used when Stripe env is unconfigured (11b
 * Slice 4). Every portal/invoice call throws {@link StripeGatewayUnconfiguredError}
 * so the route returns 5xx rather than silently pretending to open a portal or
 * fabricating an invoice list against a missing Stripe configuration. Never logs
 * a secret. (The invoice USE CASE still short-circuits to `[]` for a
 * never-subscribed tenant BEFORE reaching any gateway, so this only fires when a
 * customer id exists but Stripe itself is not configured.)
 */
export class UnconfiguredPortalInvoiceGateway implements PortalGateway, InvoiceGateway {
  async createPortalSession(): Promise<PortalSession> {
    throw new StripeGatewayUnconfiguredError();
  }
  async listInvoices(): Promise<StripeInvoiceView[]> {
    throw new StripeGatewayUnconfiguredError();
  }
}

/**
 * Fail-closed Price gateway used when Stripe env is unconfigured (#195). Every
 * price lookup throws {@link StripeGatewayUnconfiguredError}; the pure
 * `ResolveBillingPricing` use case CATCHES it and falls back to the config/env
 * display amounts, so `GET /billing/pricing` still serves a price (from config)
 * on an unconfigured deploy rather than crashing. Never logs a secret.
 */
export class UnconfiguredPriceGateway implements PriceGateway {
  async retrievePrice(): Promise<StripePrice> {
    throw new StripeGatewayUnconfiguredError();
  }
}

const SUBSCRIPTION_EVENT_PREFIX = "customer.subscription.";

/** Normalize a verified Stripe event into the SDK-free domain projection. */
function normalizeEvent(event: Stripe.Event): StripeWebhookEvent {
  const base = {
    id: event.id,
    type: event.type,
    eventTs: new Date(event.created * 1000),
  };

  if (event.type.startsWith(SUBSCRIPTION_EVENT_PREFIX)) {
    const sub = event.data.object as Stripe.Subscription;
    return { ...base, subscription: normalizeSubscription(sub) };
  }

  // Other event types (e.g. invoice.payment_failed, checkout.session.completed)
  // carry no directly-mappable subscription snapshot in this slice → ignored.
  return { ...base, subscription: null };
}

function normalizeSubscription(sub: Stripe.Subscription): StripeSubscriptionSnapshot {
  const metadata = (sub.metadata ?? {}) as Record<string, string>;
  const tenantId = typeof metadata.tenantId === "string" && metadata.tenantId !== "" ? metadata.tenantId : null;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "";

  return {
    tenantId,
    stripeCustomerId: customer,
    stripeSubscriptionId: sub.id,
    status: normalizeStatus(sub.status),
    cycle: normalizeCycle(sub),
    currentPeriodEnd: normalizePeriodEnd(sub),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    seatQuantity: normalizeSeatQuantity(sub),
  };
}

/**
 * Parse the first subscription item's quantity (16c v3 Slice A). `null` when
 * there is no item or the quantity is not a finite number — the same
 * defensive-optional convention `normalizeCycle`/`normalizePeriodEnd` follow
 * for other item-derived fields on this snapshot.
 */
function normalizeSeatQuantity(sub: Stripe.Subscription): number | null {
  const quantity = sub.items?.data?.[0]?.quantity;
  return typeof quantity === "number" && Number.isFinite(quantity) ? quantity : null;
}

// Derived from the SAME canonical tuple `StripeSubscriptionStatus` is derived
// from (`billing/stripe-gateway.ts`) — a single source of truth, so a new
// Stripe status can never silently fall through to the fail-closed default
// below without also being a compile-time member of the type (4R readability
// fix: the previous hand-duplicated `Set` had no compile-time link to the union).
const KNOWN_STATUSES: ReadonlySet<string> = new Set<string>(STRIPE_SUBSCRIPTION_STATUSES);

function normalizeStatus(status: string): StripeSubscriptionStatus {
  // Fail-closed: an unrecognized status is treated as a terminal (non-Pro) one.
  return KNOWN_STATUSES.has(status) ? (status as StripeSubscriptionStatus) : "canceled";
}

function normalizeCycle(sub: Stripe.Subscription): BillingCycle | null {
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
  if (interval === "month") return "monthly";
  if (interval === "year") return "annual";
  return null;
}

function normalizePeriodEnd(sub: Stripe.Subscription): Date | null {
  // `current_period_end` moved onto the subscription item in newer Stripe API
  // versions; read the subscription-level field first, then fall back to the
  // first item so both shapes normalize correctly.
  const raw =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items?.data?.[0]?.current_period_end;
  return typeof raw === "number" ? new Date(raw * 1000) : null;
}
