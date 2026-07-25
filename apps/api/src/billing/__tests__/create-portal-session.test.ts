import { describe, expect, it, vi } from "vitest";
import { CreatePortalSession } from "../create-portal-session.js";
import type { BillingCustomerReaderPort } from "../create-portal-session.js";
import { NoStripeCustomerError, type PortalGateway } from "../stripe-gateway.js";

// ---------------------------------------------------------------------------
// Slice 4 — Stripe Customer Portal use case (payments hot path).
//
// The pure CreatePortalSession use case resolves the tenant's stripe_customer_id
// from OUR DB (via the BillingCustomerReaderPort) keyed by the tenant it is
// handed — the ROUTE is the only place that tenant is resolved (from
// authContext), so a client-supplied tenant/customer can never reach the
// gateway through this use case. It then opens a Stripe-hosted portal session
// for that customer and returns the hosted URL.
//
// Invariants proven:
//   - the customer id is resolved SERVER-SIDE from the tenant, never taken as input
//   - the resolved customer id is the one passed to the gateway (tenant-scoped)
//   - a tenant with no stripe_customer_id → NoStripeCustomerError (clean), and
//     NO portal session is created (cannot open a portal without a customer)
//   - the Stripe-hosted URL is returned verbatim
// ---------------------------------------------------------------------------

const TENANT_A = "11111111-0000-0000-0000-000000000001";
const TENANT_B = "22222222-0000-0000-0000-000000000002";
const CUSTOMER_A = "cus_tenantA";

function fakeReader(byTenant: Record<string, string | null>): {
  reader: BillingCustomerReaderPort;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(async (tenantId: string) => byTenant[tenantId] ?? null);
  return { reader: { findStripeCustomerId: spy }, spy };
}

function fakeGateway(): { gateway: PortalGateway; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(async (customerId: string) => ({
    url: `https://billing.stripe.test/portal?c=${customerId}`,
  }));
  return { gateway: { createPortalSession: spy as PortalGateway["createPortalSession"] }, spy };
}

describe("CreatePortalSession (11b Slice 4)", () => {
  it("resolves the customer id SERVER-SIDE from the tenant and opens a portal for it", async () => {
    const { reader, spy: readSpy } = fakeReader({ [TENANT_A]: CUSTOMER_A });
    const { gateway, spy: gwSpy } = fakeGateway();
    const uc = new CreatePortalSession(reader, gateway);

    const result = await uc.execute({ tenantId: TENANT_A });

    expect(readSpy).toHaveBeenCalledWith(TENANT_A);
    expect(gwSpy).toHaveBeenCalledTimes(1);
    expect(gwSpy).toHaveBeenCalledWith(CUSTOMER_A);
    expect(result).toEqual({ url: `https://billing.stripe.test/portal?c=${CUSTOMER_A}` });
  });

  it("is tenant-scoped: it only ever resolves the customer for the tenant it is handed", async () => {
    // Only TENANT_A has a customer; a caller acting as TENANT_B cannot reach A's portal.
    const { reader } = fakeReader({ [TENANT_A]: CUSTOMER_A });
    const { gateway, spy: gwSpy } = fakeGateway();
    const uc = new CreatePortalSession(reader, gateway);

    await expect(uc.execute({ tenantId: TENANT_B })).rejects.toBeInstanceOf(NoStripeCustomerError);
    expect(gwSpy).not.toHaveBeenCalled();
  });

  it("throws a clean NoStripeCustomerError (NOT a crash) when the tenant has no stripe_customer_id, and creates NO session", async () => {
    const { reader } = fakeReader({ [TENANT_A]: null });
    const { gateway, spy: gwSpy } = fakeGateway();
    const uc = new CreatePortalSession(reader, gateway);

    await expect(uc.execute({ tenantId: TENANT_A })).rejects.toBeInstanceOf(NoStripeCustomerError);
    expect(new NoStripeCustomerError()).toBeInstanceOf(Error);
    expect(gwSpy).not.toHaveBeenCalled();
  });
});
