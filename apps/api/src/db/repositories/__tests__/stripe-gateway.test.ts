import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { StripeApiGateway } from "../stripe-gateway.js";

// ---------------------------------------------------------------------------
// 11b Slice 4, 4R FIX 2 (SUGGESTION, reliability) — the `listInvoices` →
// `toStripeInvoiceView`/`readCardDisplay` mapping layer had NO test: every
// other invoice test (list-invoices.test.ts, billing-portal.test.ts) feeds an
// already-shaped `StripeInvoiceView` fixture and never exercises the adapter's
// own null-coalescing (`?? 0` / `?? null` / optional chaining) against a
// partial/malformed raw Stripe SDK invoice. This suite injects a FAKE Stripe
// client (the adapter's constructor accepts one for hermetic tests — no live
// Stripe key) returning PARTIAL invoices and proves the mapping never throws
// and always yields a fully-formed StripeInvoiceView with null card fields
// when card data is absent.
// ---------------------------------------------------------------------------

function fakeStripeClient(invoices: Partial<Stripe.Invoice>[]): Stripe {
  return {
    invoices: { list: vi.fn(async () => ({ data: invoices })) },
  } as unknown as Stripe;
}

function buildGateway(invoices: Partial<Stripe.Invoice>[]): StripeApiGateway {
  return new StripeApiGateway(
    "sk_test_unused",
    "whsec_test_unused",
    "https://app.test",
    fakeStripeClient(invoices),
  );
}

describe("StripeApiGateway.listInvoices — partial/malformed invoice mapping (11b Slice 4 4R FIX 2)", () => {
  it("maps an invoice with NO `charge` field at all to null card fields, without throwing", async () => {
    const gateway = buildGateway([
      {
        id: "in_no_charge",
        amount_due: 500,
        currency: "usd",
        status: "paid",
        created: 1_700_000_000,
        hosted_invoice_url: "https://invoice.stripe.test/hosted/in_no_charge",
        invoice_pdf: "https://invoice.stripe.test/pdf/in_no_charge",
        // `charge` intentionally absent.
      },
    ]);

    const views = await gateway.listInvoices("cus_test");

    expect(views).toHaveLength(1);
    expect(views[0]).toEqual({
      id: "in_no_charge",
      amountDue: 500,
      currency: "usd",
      status: "paid",
      created: 1_700_000_000,
      hostedInvoiceUrl: "https://invoice.stripe.test/hosted/in_no_charge",
      receiptUrl: "https://invoice.stripe.test/pdf/in_no_charge",
      cardBrand: null,
      cardLast4: null,
    });
  });

  it("maps a maximally-missing invoice (no amount_due/created/id/currency/status/urls) to safe defaults, without throwing", async () => {
    const gateway = buildGateway([{}]);

    const views = await gateway.listInvoices("cus_test");

    expect(views).toHaveLength(1);
    expect(views[0]).toEqual({
      id: "",
      amountDue: 0,
      currency: "",
      status: "",
      created: 0,
      hostedInvoiceUrl: null,
      receiptUrl: null,
      cardBrand: null,
      cardLast4: null,
    });
  });

  it("maps an invoice whose expanded charge has NO payment_method_details.card to null card fields", async () => {
    const gateway = buildGateway([
      {
        id: "in_no_card",
        amount_due: 1200,
        currency: "eur",
        status: "open",
        created: 1_700_000_500,
        hosted_invoice_url: null,
        invoice_pdf: null,
        // Charge is present but carries no card display info (e.g. a
        // non-card payment method, or an unexpanded/partial charge object).
        charge: { id: "ch_test", payment_method_details: {} } as unknown as Stripe.Invoice["charge"],
      },
    ]);

    const views = await gateway.listInvoices("cus_test");

    expect(views).toHaveLength(1);
    expect(views[0]).toEqual({
      id: "in_no_card",
      amountDue: 1200,
      currency: "eur",
      status: "open",
      created: 1_700_000_500,
      hostedInvoiceUrl: null,
      receiptUrl: null,
      cardBrand: null,
      cardLast4: null,
    });
  });

  it("maps a fully-shaped invoice with card display info correctly (regression guard alongside the partial cases)", async () => {
    const gateway = buildGateway([
      {
        id: "in_full",
        amount_due: 999,
        currency: "usd",
        status: "paid",
        created: 1_700_001_000,
        hosted_invoice_url: "https://invoice.stripe.test/hosted/in_full",
        invoice_pdf: "https://invoice.stripe.test/pdf/in_full",
        charge: {
          id: "ch_full",
          payment_method_details: { card: { brand: "visa", last4: "4242" } },
        } as unknown as Stripe.Invoice["charge"],
      },
    ]);

    const views = await gateway.listInvoices("cus_test");

    expect(views[0]).toEqual({
      id: "in_full",
      amountDue: 999,
      currency: "usd",
      status: "paid",
      created: 1_700_001_000,
      hostedInvoiceUrl: "https://invoice.stripe.test/hosted/in_full",
      receiptUrl: "https://invoice.stripe.test/pdf/in_full",
      cardBrand: "visa",
      cardLast4: "4242",
    });
  });

  it("passes the resolved customer id and the configured INVOICE_LIST_LIMIT to the Stripe SDK call", async () => {
    const client = fakeStripeClient([]);
    const gateway = new StripeApiGateway("sk_test", "whsec_test", "", client);

    await gateway.listInvoices("cus_scoped");

    expect(client.invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_scoped", limit: 24 }),
    );
  });
});
