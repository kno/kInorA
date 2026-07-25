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
