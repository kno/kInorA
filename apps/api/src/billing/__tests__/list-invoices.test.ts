import { describe, expect, it, vi } from "vitest";
import { ListInvoices, toInvoiceDTO } from "../list-invoices.js";
import type { BillingCustomerReaderPort } from "../create-portal-session.js";
import type { InvoiceGateway, StripeInvoiceView } from "../stripe-gateway.js";

// ---------------------------------------------------------------------------
// Slice 4 — Stripe invoice listing use case (payments hot path, privacy).
//
// The pure ListInvoices use case resolves the tenant's stripe_customer_id from
// OUR DB (server-side, never from client input), lists that customer's invoices
// through the gateway, and maps each to a privacy-safe InvoiceDTO. The DTO
// carries NO full card number (PAN) — only the display brand + last four, if
// present — plus amounts, currency, dates, status, and hosted/receipt URLs.
//
// Invariants proven:
//   - the customer id is resolved SERVER-SIDE from the tenant (tenant-scoped)
//   - a tenant with no stripe_customer_id → [] (empty state, NOT an error), and
//     the gateway is NEVER called
//   - a customer with zero invoices → []
//   - toInvoiceDTO is an ALLOWLIST mapper: rogue/PAN-ish fields on the source
//     are dropped; the DTO exposes only cardBrand/cardLast4 for card display
// ---------------------------------------------------------------------------

const TENANT_A = "11111111-0000-0000-0000-000000000001";
const CUSTOMER_A = "cus_tenantA";

const ALLOWED_DTO_KEYS = new Set([
  "id",
  "amountDue",
  "currency",
  "status",
  "createdAt",
  "hostedInvoiceUrl",
  "receiptUrl",
  "cardBrand",
  "cardLast4",
]);

function baseView(overrides: Partial<StripeInvoiceView> = {}): StripeInvoiceView {
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
    ...overrides,
  };
}

function fakeReader(customerId: string | null): BillingCustomerReaderPort {
  return { findStripeCustomerId: vi.fn(async () => customerId) };
}

function fakeGateway(views: StripeInvoiceView[]): {
  gateway: InvoiceGateway;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(async () => views);
  return { gateway: { listInvoices: spy as InvoiceGateway["listInvoices"] }, spy };
}

describe("toInvoiceDTO (privacy-safe mapping)", () => {
  it("maps the invoice view to the InvoiceDTO shape (amounts, currency, dates, status, urls)", () => {
    const dto = toInvoiceDTO(baseView());
    expect(dto).toEqual({
      id: "in_123",
      amountDue: 1999,
      currency: "usd",
      status: "paid",
      createdAt: new Date(1_700_000_000 * 1000).toISOString(),
      hostedInvoiceUrl: "https://invoice.stripe.test/hosted/in_123",
      receiptUrl: "https://invoice.stripe.test/pdf/in_123",
      cardBrand: "visa",
      cardLast4: "4242",
    });
  });

  it("exposes ONLY cardBrand/cardLast4 for card display — never a full PAN or other PII", () => {
    // A rogue source object carrying a full PAN and other member PII. toInvoiceDTO
    // must ALLOWLIST the safe fields and drop everything else (it must not spread).
    const rogue = {
      ...baseView(),
      cardNumber: "4242424242424242",
      pan: "4111111111111111",
      customerEmail: "victim@example.com",
      cvc: "573",
    } as unknown as StripeInvoiceView;

    const dto = toInvoiceDTO(rogue);

    // ALLOWLIST: every key of the DTO must be one of the sanctioned fields, and
    // the rogue PAN/CVC/email keys must be absent entirely.
    for (const key of Object.keys(dto)) {
      expect(ALLOWED_DTO_KEYS.has(key)).toBe(true);
    }
    expect(dto).not.toHaveProperty("cardNumber");
    expect(dto).not.toHaveProperty("pan");
    expect(dto).not.toHaveProperty("cvc");
    expect(dto).not.toHaveProperty("customerEmail");
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("4242424242424242"); // no PAN (raw)
    expect(serialized).not.toContain("4111111111111111"); // no PAN (alt)
    expect(serialized).not.toContain("victim@example.com"); // no other PII
    expect(serialized).not.toContain("573"); // no CVC leaked
    expect(dto.cardLast4).toBe("4242");
    expect(dto.cardBrand).toBe("visa");
  });

  it("omits cardBrand/cardLast4 entirely when the invoice has no card display info", () => {
    const dto = toInvoiceDTO(baseView({ cardBrand: null, cardLast4: null }));
    expect(dto).not.toHaveProperty("cardBrand");
    expect(dto).not.toHaveProperty("cardLast4");
  });
});

describe("ListInvoices (11b Slice 4)", () => {
  it("resolves the customer SERVER-SIDE from the tenant and lists that customer's invoices", async () => {
    const reader = fakeReader(CUSTOMER_A);
    const { gateway, spy } = fakeGateway([baseView()]);
    const uc = new ListInvoices(reader, gateway);

    const invoices = await uc.execute({ tenantId: TENANT_A });

    expect(reader.findStripeCustomerId).toHaveBeenCalledWith(TENANT_A);
    expect(spy).toHaveBeenCalledWith(CUSTOMER_A);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.id).toBe("in_123");
    expect(invoices[0]!.cardLast4).toBe("4242");
  });

  it("returns [] (empty state, NOT an error) when the tenant has no stripe_customer_id, and never calls the gateway", async () => {
    const reader = fakeReader(null);
    const { gateway, spy } = fakeGateway([baseView()]);
    const uc = new ListInvoices(reader, gateway);

    const invoices = await uc.execute({ tenantId: TENANT_A });

    expect(invoices).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns [] when the customer exists but has no invoices", async () => {
    const reader = fakeReader(CUSTOMER_A);
    const { gateway } = fakeGateway([]);
    const uc = new ListInvoices(reader, gateway);

    expect(await uc.execute({ tenantId: TENANT_A })).toEqual([]);
  });
});
