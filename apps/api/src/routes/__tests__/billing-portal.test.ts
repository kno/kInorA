import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { billingRoutes } from "../billing.js";
import {
  SetMemberAllocation,
  GetTenantUsage,
  type QuotaAdminPort,
} from "../../billing/quota-admin.js";
import { GetBillingVisibility, type BillingVisibilityPort } from "../../billing/billing-visibility.js";
import { CreateCheckout } from "../../billing/create-checkout.js";
import type { CheckoutGateway } from "../../billing/stripe-gateway.js";
import { CreatePortalSession, type BillingCustomerReaderPort } from "../../billing/create-portal-session.js";
import { ListInvoices } from "../../billing/list-invoices.js";
import type { InvoiceGateway, PortalGateway, StripeInvoiceView } from "../../billing/stripe-gateway.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

// ---------------------------------------------------------------------------
// Slice 4 — POST /billing/portal + GET /billing/invoices (payments hot path).
//
// Both endpoints are authenticated. The tenant is read ONLY from authContext and
// the tenant's stripe_customer_id is resolved SERVER-SIDE from OUR DB — a
// customer id (or tenant id) in the request body/query is IGNORED, so a caller
// can never open another tenant's portal or read another tenant's invoices. A
// tenant with no stripe_customer_id gets a clean 409 on portal (cannot open a
// portal without a customer) and an empty [] on invoices — never a 500/crash.
// No live Stripe key is used (the gateways are fakes).
// ---------------------------------------------------------------------------

const OWNER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_A = "bbbbbbbb-0000-0000-0000-000000000001";
const CUSTOMER_A = "cus_tenantA";
const SPOOFED = "cus_someoneElse";

const auth = { authorization: `Bearer ${VALID_TOKEN}` };

function baseView(): StripeInvoiceView {
  return {
    id: "in_123",
    amountDue: 1999,
    currency: "usd",
    status: "paid",
    created: 1_700_000_000,
    hostedInvoiceUrl: "https://invoice.stripe.test/hosted/in_123",
    receiptUrl: "https://invoice.stripe.test/pdf/in_123",
    cardBrand: "visa",
    cardLast4: "4242",
  };
}

function unusedQuotaPort(): QuotaAdminPort {
  return {
    loadActorMembership: vi.fn(async () => ({ role: "owner", status: "active" })),
    loadSubjectMembership: vi.fn(async () => ({ role: "member", status: "active" })),
    loadTenantTier: vi.fn(async () => "pro"),
    writeMemberAllocation: vi.fn(async () => {}),
    readTenantUsage: vi.fn(async () => []),
    readMemberUsage: vi.fn(async () => []),
  };
}

function unusedVisibilityPort(): BillingVisibilityPort {
  return {
    loadContext: vi.fn(async () => ({
      membershipStatus: null,
      billing: null,
      activeOverrideTier: null,
      activeOverrideEndsAt: null,
    })),
    readTenantUsage: vi.fn(async () => []),
    readOwnMemberUsage: vi.fn(async () => []),
  };
}

function unusedCheckout(): CreateCheckout {
  const gateway: CheckoutGateway = {
    createCheckoutSession: vi.fn(async () => ({ url: "https://checkout.stripe.test/unused" })),
    validatePromotionCode: vi.fn(async () => ({ valid: true, promotionCodeId: "p" })),
  };
  return new CreateCheckout(gateway, { priceMonthly: "price_m", priceAnnual: "price_a" });
}

interface Fakes {
  customerId: string | null;
  invoices?: StripeInvoiceView[];
  /**
   * The ACTOR's role for the owner-only Portal/Invoice authorization check
   * (11b Slice 4 4R FIX 1). Defaults to "owner" so every pre-existing scenario
   * in this file (tenant-scoping, no-customer, spoofed-id) stays green
   * unchanged; the dedicated authorization describe block below overrides it
   * to "member" to prove the 403 denial.
   */
  actorRole?: "owner" | "member";
}

interface BuiltApp {
  app: FastifyInstance;
  readSpy: ReturnType<typeof vi.fn>;
  portalSpy: ReturnType<typeof vi.fn>;
  invoiceSpy: ReturnType<typeof vi.fn>;
  ownershipSpy: ReturnType<typeof vi.fn>;
}

async function buildTestApp(fakes: Fakes): Promise<BuiltApp> {
  const readSpy = vi.fn(async () => fakes.customerId);
  const reader: BillingCustomerReaderPort = { findStripeCustomerId: readSpy };

  const portalSpy = vi.fn(async (customerId: string) => ({
    url: `https://billing.stripe.test/portal?c=${customerId}`,
  }));
  const portalGateway: PortalGateway = {
    createPortalSession: portalSpy as PortalGateway["createPortalSession"],
  };

  const invoiceSpy = vi.fn(async () => fakes.invoices ?? []);
  const invoiceGateway: InvoiceGateway = {
    listInvoices: invoiceSpy as InvoiceGateway["listInvoices"],
  };

  // Owner-only authorization port (11b Slice 4 4R FIX 1) — INDEPENDENT of the
  // auth-plugin's DB membership re-check below (which only re-verifies
  // ACTIVE status). This fake proves the ROUTE resolves the actor's role via
  // `checkBillingOwnership.loadActorMembership` and denies a non-owner with
  // 403 BEFORE the customer reader or gateway is ever reached.
  const ownershipSpy = vi.fn(async () => ({ role: fakes.actorRole ?? "owner", status: "active" }));

  const db = createAuthMockDb({
    sessionRows: [buildSessionRow({ tenantId: TENANT_A, userId: OWNER_ID })],
    membershipRows: [
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: OWNER_ID, role: "owner" }),
    ],
  }).db as never;

  const app = Fastify();
  app.setErrorHandler((_error: unknown, _req, reply) =>
    reply.code(500).send({ error: "Internal Server Error" }),
  );
  await app.register(authPlugin, { db });
  await app.register(billingRoutes, {
    setMemberAllocation: new SetMemberAllocation(unusedQuotaPort()),
    getTenantUsage: new GetTenantUsage(unusedQuotaPort()),
    getBillingVisibility: new GetBillingVisibility(unusedVisibilityPort()),
    createCheckout: unusedCheckout(),
    createPortalSession: new CreatePortalSession(reader, portalGateway),
    listInvoices: new ListInvoices(reader, invoiceGateway),
    checkBillingOwnership: { loadActorMembership: ownershipSpy },
  });

  return { app, readSpy, portalSpy, invoiceSpy, ownershipSpy };
}

describe("POST /billing/portal (11b Slice 4)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("opens a portal session from the tenant's server-resolved customer and returns { url }", async () => {
    const built = await buildTestApp({ customerId: CUSTOMER_A });
    app = built.app;

    const res = await app.inject({ method: "POST", url: "/billing/portal", headers: auth });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: `https://billing.stripe.test/portal?c=${CUSTOMER_A}` });
    expect(built.readSpy).toHaveBeenCalledWith(TENANT_A);
    expect(built.portalSpy).toHaveBeenCalledWith(CUSTOMER_A);
  });

  it("IGNORES a spoofed customerId/tenantId in the body — identity comes only from authContext", async () => {
    const built = await buildTestApp({ customerId: CUSTOMER_A });
    app = built.app;

    const res = await app.inject({
      method: "POST",
      url: "/billing/portal",
      headers: auth,
      payload: { customerId: SPOOFED, tenantId: "ffffffff-0000-0000-0000-000000000009" },
    });

    expect(res.statusCode).toBe(200);
    // Resolved from the SESSION tenant, and the gateway got the resolved customer.
    expect(built.readSpy).toHaveBeenCalledWith(TENANT_A);
    expect(built.portalSpy).toHaveBeenCalledWith(CUSTOMER_A);
    expect(built.portalSpy).not.toHaveBeenCalledWith(SPOOFED);
  });

  it("returns a clean 409 (NOT a 500/crash) when the tenant has never subscribed (no stripe_customer_id)", async () => {
    const built = await buildTestApp({ customerId: null });
    app = built.app;

    const res = await app.inject({ method: "POST", url: "/billing/portal", headers: auth });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_stripe_customer" });
    expect(built.portalSpy).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated portal attempt → 401, no resolution", async () => {
    const built = await buildTestApp({ customerId: CUSTOMER_A });
    app = built.app;

    const res = await app.inject({ method: "POST", url: "/billing/portal" });

    expect(res.statusCode).toBe(401);
    expect(built.readSpy).not.toHaveBeenCalled();
    expect(built.portalSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 11b Slice 4, 4R FIX 1 (WARNING, authz/privacy) — owner-only.
  //
  // The Customer Portal lets the caller change the payment method AND CANCEL
  // THE SUBSCRIPTION — a non-owner active member must never be able to cancel
  // the tenant's plan. Gated with the SAME `isActiveOwner` check the
  // quota-admin use cases use (apps/api/src/billing/quota-admin.ts).
  // -------------------------------------------------------------------------

  it("rejects an active NON-owner member → 403 unauthorized_quota_admin, no customer resolution, no session created", async () => {
    const built = await buildTestApp({ customerId: CUSTOMER_A, actorRole: "member" });
    app = built.app;

    const res = await app.inject({ method: "POST", url: "/billing/portal", headers: auth });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "unauthorized_quota_admin" });
    expect(built.ownershipSpy).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: OWNER_ID });
    expect(built.readSpy).not.toHaveBeenCalled();
    expect(built.portalSpy).not.toHaveBeenCalled();
  });

  it("an active OWNER still gets 200 (owner-only check does not regress the happy path)", async () => {
    const built = await buildTestApp({ customerId: CUSTOMER_A, actorRole: "owner" });
    app = built.app;

    const res = await app.inject({ method: "POST", url: "/billing/portal", headers: auth });

    expect(res.statusCode).toBe(200);
    expect(built.ownershipSpy).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: OWNER_ID });
    expect(built.portalSpy).toHaveBeenCalledWith(CUSTOMER_A);
  });
});

describe("GET /billing/invoices (11b Slice 4)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("lists the tenant's invoices as privacy-safe DTOs (no PAN)", async () => {
    const built = await buildTestApp({ customerId: CUSTOMER_A, invoices: [baseView()] });
    app = built.app;

    const res = await app.inject({ method: "GET", url: "/billing/invoices", headers: auth });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe("in_123");
    expect(body[0]!.cardLast4).toBe("4242");
    expect(built.readSpy).toHaveBeenCalledWith(TENANT_A);
    expect(built.invoiceSpy).toHaveBeenCalledWith(CUSTOMER_A);
    expect(JSON.stringify(body)).not.toContain("4242424242424242");
  });

  it("returns [] (not an error) when the tenant has never subscribed", async () => {
    const built = await buildTestApp({ customerId: null, invoices: [baseView()] });
    app = built.app;

    const res = await app.inject({ method: "GET", url: "/billing/invoices", headers: auth });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(built.invoiceSpy).not.toHaveBeenCalled();
  });

  it("IGNORES a spoofed customer id in the query — invoices are scoped to the authContext tenant only", async () => {
    const built = await buildTestApp({ customerId: CUSTOMER_A, invoices: [baseView()] });
    app = built.app;

    const res = await app.inject({
      method: "GET",
      url: `/billing/invoices?customerId=${SPOOFED}`,
      headers: auth,
    });

    expect(res.statusCode).toBe(200);
    expect(built.readSpy).toHaveBeenCalledWith(TENANT_A);
    expect(built.invoiceSpy).toHaveBeenCalledWith(CUSTOMER_A);
    expect(built.invoiceSpy).not.toHaveBeenCalledWith(SPOOFED);
  });

  it("rejects an unauthenticated invoice list → 401", async () => {
    const built = await buildTestApp({ customerId: CUSTOMER_A, invoices: [baseView()] });
    app = built.app;

    const res = await app.inject({ method: "GET", url: "/billing/invoices" });

    expect(res.statusCode).toBe(401);
    expect(built.invoiceSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 11b Slice 4, 4R FIX 1 (WARNING, authz/privacy) — owner-only.
  //
  // Invoices expose `hostedInvoiceUrl`/`receiptUrl` — long-lived Stripe links
  // whose PDFs carry the tenant's billing name/address (owner PII). A
  // non-owner active member must not be able to read them.
  // -------------------------------------------------------------------------

  it("rejects an active NON-owner member → 403 unauthorized_quota_admin, no customer resolution, no invoice list read", async () => {
    const built = await buildTestApp({
      customerId: CUSTOMER_A,
      invoices: [baseView()],
      actorRole: "member",
    });
    app = built.app;

    const res = await app.inject({ method: "GET", url: "/billing/invoices", headers: auth });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "unauthorized_quota_admin" });
    expect(built.ownershipSpy).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: OWNER_ID });
    expect(built.readSpy).not.toHaveBeenCalled();
    expect(built.invoiceSpy).not.toHaveBeenCalled();
  });

  it("an active OWNER still gets 200 with the invoice list (owner-only check does not regress the happy path)", async () => {
    const built = await buildTestApp({
      customerId: CUSTOMER_A,
      invoices: [baseView()],
      actorRole: "owner",
    });
    app = built.app;

    const res = await app.inject({ method: "GET", url: "/billing/invoices", headers: auth });

    expect(res.statusCode).toBe(200);
    expect(built.ownershipSpy).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: OWNER_ID });
    expect(built.invoiceSpy).toHaveBeenCalledWith(CUSTOMER_A);
  });
});
