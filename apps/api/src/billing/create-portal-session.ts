import {
  NoStripeCustomerError,
  type PortalGateway,
  type PortalSession,
} from "./stripe-gateway.js";

// Re-export so the route can map the controlled no-customer error without
// reaching into the port module directly (mirrors create-checkout.ts).
export { NoStripeCustomerError } from "./stripe-gateway.js";

/**
 * Pure Customer Portal use case (11b-v1-billing-stripe-integration, Slice 4).
 *
 * SDK-free: depends only on the {@link PortalGateway} port and a
 * {@link BillingCustomerReaderPort} that resolves the tenant's Stripe customer
 * id from OUR OWN DB (`tenant_billing_states.stripe_customer_id`). The tenant is
 * passed straight through — the ROUTE is the only place it is resolved (from
 * `authContext`), so a client-supplied tenant/customer can never reach the
 * gateway through this use case. A tenant with no `stripe_customer_id` (never
 * subscribed) yields a controlled {@link NoStripeCustomerError} and NO portal
 * session is opened — a portal cannot exist without a Stripe customer.
 */

/**
 * Resolves a tenant's Stripe customer id from OUR persistence, keyed by the
 * `authContext` tenant. Returns null when the tenant has never subscribed (no
 * customer). The Stripe customer id is therefore ALWAYS derived server-side and
 * NEVER accepted from client input.
 */
export interface BillingCustomerReaderPort {
  findStripeCustomerId(tenantId: string): Promise<string | null>;
}

export interface CreatePortalSessionInput {
  /** Resolved SERVER-SIDE from `authContext`; NEVER from the request body. */
  tenantId: string;
}

export class CreatePortalSession {
  constructor(
    private readonly customers: BillingCustomerReaderPort,
    private readonly gateway: PortalGateway,
  ) {}

  async execute(input: CreatePortalSessionInput): Promise<PortalSession> {
    const customerId = await this.customers.findStripeCustomerId(input.tenantId);
    if (!customerId) {
      // Fail-closed on the payments hot path: a portal cannot be opened without
      // a Stripe customer. The route maps this to a clean 409, not a 500.
      throw new NoStripeCustomerError();
    }
    return this.gateway.createPortalSession(customerId);
  }
}
