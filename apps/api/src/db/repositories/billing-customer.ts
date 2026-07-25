import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { tenantBillingStates } from "../schema.js";
import type { BillingCustomerReaderPort } from "../../billing/create-portal-session.js";

/**
 * Drizzle adapter that resolves a tenant's Stripe customer id from OUR OWN
 * persistence (11b-v1-billing-stripe-integration, Slice 4). Lives under `db/`
 * so the pure portal/invoice use cases depend only on the
 * {@link BillingCustomerReaderPort} interface (the dependency-cruiser forbids
 * drizzle/pg outside the infra layer).
 *
 * SECURITY: the customer id is read from `tenant_billing_states` keyed by the
 * tenant the route resolved from `authContext` — it is NEVER accepted from
 * client input, so a caller can only ever reach their own tenant's Stripe
 * customer (no cross-tenant portal/invoice access). Returns null when the
 * tenant has no billing-state row or no customer id yet (never subscribed).
 */
export class BillingCustomerRepository implements BillingCustomerReaderPort {
  constructor(private readonly db: Database) {}

  async findStripeCustomerId(tenantId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ stripeCustomerId: tenantBillingStates.stripeCustomerId })
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, tenantId));
    return row?.stripeCustomerId ?? null;
  }
}
