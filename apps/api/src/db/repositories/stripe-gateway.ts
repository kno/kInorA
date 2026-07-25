import Stripe from "stripe";
import type { BillingCycle } from "@kinora/contracts";
import {
  STRIPE_SUBSCRIPTION_STATUSES,
  StripeGatewayUnconfiguredError,
  StripeSignatureError,
  type StripeGateway,
  type StripeSubscriptionSnapshot,
  type StripeSubscriptionStatus,
  type StripeWebhookEvent,
} from "../../billing/stripe-gateway.js";

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
export class StripeApiGateway implements StripeGateway {
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    stripeClient?: Stripe,
  ) {
    // Injectable client for hermetic tests; production constructs from the key.
    this.stripe = stripeClient ?? new Stripe(secretKey);
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
}

/**
 * Create the real gateway from env, or return null when the Stripe env is not
 * configured (so the API still boots cleanly, mirroring the optional AI stack).
 * A null gateway means the webhook route fails closed (every event → 400).
 */
export function createStripeGatewayFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StripeGateway | null {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) return null;
  return new StripeApiGateway(secretKey, webhookSecret);
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
  };
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
