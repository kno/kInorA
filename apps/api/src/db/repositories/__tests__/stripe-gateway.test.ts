import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { StripeApiGateway, UnconfiguredPriceGateway } from "../stripe-gateway.js";
import { StripeGatewayUnconfiguredError } from "../../../billing/stripe-gateway.js";

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

// ---------------------------------------------------------------------------
// #195 — the adapter sources display prices from the Stripe Price API. A stub
// Stripe client is injected so the test stays hermetic (NO live Stripe call).
// ---------------------------------------------------------------------------

function fakePriceStripeClient(prices: Record<string, Partial<Stripe.Price>>): Stripe {
  const retrieve = vi.fn(async (priceId: string) => {
    const price = prices[priceId];
    if (!price) throw new Error(`no such price: ${priceId}`);
    return price as Stripe.Price;
  });
  return { prices: { retrieve } } as unknown as Stripe;
}

function buildPriceGateway(prices: Record<string, Partial<Stripe.Price>>): {
  gateway: StripeApiGateway;
  client: Stripe;
} {
  const client = fakePriceStripeClient(prices);
  return { gateway: new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client), client };
}

describe("StripeApiGateway.retrievePrice (#195)", () => {
  it("maps a recurring monthly Price to the SDK-free projection", async () => {
    const { gateway, client } = buildPriceGateway({
      price_monthly_1: {
        unit_amount: 1299,
        currency: "eur",
        recurring: { interval: "month" } as Stripe.Price.Recurring,
      },
    });

    const price = await gateway.retrievePrice("price_monthly_1");

    expect(client.prices.retrieve).toHaveBeenCalledWith("price_monthly_1");
    expect(price).toEqual({ unitAmount: 1299, currency: "eur", interval: "month" });
  });

  it("maps a recurring yearly Price (interval year)", async () => {
    const { gateway } = buildPriceGateway({
      price_annual_1: {
        unit_amount: 9588,
        currency: "eur",
        recurring: { interval: "year" } as Stripe.Price.Recurring,
      },
    });

    expect(await gateway.retrievePrice("price_annual_1")).toEqual({
      unitAmount: 9588,
      currency: "eur",
      interval: "year",
    });
  });

  it("maps a Price with no fixed unit amount / non-recurring interval to nulls, without throwing", async () => {
    const { gateway } = buildPriceGateway({
      price_weird: { unit_amount: null, currency: "eur", recurring: null },
    });

    expect(await gateway.retrievePrice("price_weird")).toEqual({
      unitAmount: null,
      currency: "eur",
      interval: null,
    });
  });

  it("normalizes an unrecognized recurring interval (e.g. week) to null", async () => {
    const { gateway } = buildPriceGateway({
      price_weekly: {
        unit_amount: 100,
        currency: "eur",
        recurring: { interval: "week" } as unknown as Stripe.Price.Recurring,
      },
    });

    expect((await gateway.retrievePrice("price_weekly")).interval).toBeNull();
  });
});

describe("UnconfiguredPriceGateway (#195)", () => {
  it("throws StripeGatewayUnconfiguredError so the pricing use case falls back to config", async () => {
    const gateway = new UnconfiguredPriceGateway();
    await expect(gateway.retrievePrice("price_monthly_1")).rejects.toBeInstanceOf(
      StripeGatewayUnconfiguredError,
    );
  });
});

// ---------------------------------------------------------------------------
// 16c v3 B2B seat-based billing, Slice A — pure Stripe infra (gateway method +
// snapshot quantity parsing). NO seat-count source, persistence, or limit
// scaling in this slice; those are later slices (B-D). A fake Stripe client is
// injected so these stay hermetic (no live Stripe call).
// ---------------------------------------------------------------------------

function fakeSubscriptionStripeClient(
  subscription: Partial<Stripe.Subscription>,
): { client: Stripe; retrieve: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const retrieve = vi.fn(async () => subscription as Stripe.Subscription);
  const update = vi.fn(async () => subscription as Stripe.Subscription);
  return {
    client: { subscriptions: { retrieve, update } } as unknown as Stripe,
    retrieve,
    update,
  };
}

describe("StripeApiGateway.updateSubscriptionQuantity (16c v3 Slice A)", () => {
  it("retrieves the subscription's first item id and updates quantity with create_prorations + the idempotency key", async () => {
    const { client, retrieve, update } = fakeSubscriptionStripeClient({
      id: "sub_seat_1",
      items: { object: "list", data: [{ id: "si_seat_1" }] } as unknown as Stripe.Subscription["items"],
    });
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    await gateway.updateSubscriptionQuantity("sub_seat_1", 3, "seat-sync:tenant_1:3");

    expect(retrieve).toHaveBeenCalledWith("sub_seat_1");
    expect(update).toHaveBeenCalledWith(
      "sub_seat_1",
      { items: [{ id: "si_seat_1", quantity: 3 }], proration_behavior: "create_prorations" },
      { idempotencyKey: "seat-sync:tenant_1:3" },
    );
  });

  it("throws when the subscription has no items to update quantity on", async () => {
    const { client } = fakeSubscriptionStripeClient({
      id: "sub_no_items",
      items: { object: "list", data: [] } as unknown as Stripe.Subscription["items"],
    });
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    await expect(
      gateway.updateSubscriptionQuantity("sub_no_items", 2, "seat-sync:tenant_2:2"),
    ).rejects.toThrow(/no items/);
  });
});

describe("StripeApiGateway normalizeSubscription — seatQuantity parsing (16c v3 Slice A)", () => {
  function fakeConstructEventClient(sub: Partial<Stripe.Subscription>): Stripe {
    const event = {
      id: "evt_seat_1",
      type: "customer.subscription.updated",
      created: 1_700_000_000,
      data: { object: sub },
    } as unknown as Stripe.Event;
    return {
      webhooks: { constructEvent: vi.fn(() => event) },
    } as unknown as Stripe;
  }

  function subscriptionWithQuantity(quantity: unknown): Partial<Stripe.Subscription> {
    return {
      id: "sub_seat_2",
      status: "active",
      customer: "cus_seat_2",
      cancel_at_period_end: false,
      metadata: {},
      items: {
        object: "list",
        data: [{ price: { recurring: { interval: "month" } }, quantity }],
      } as unknown as Stripe.Subscription["items"],
    };
  }

  it("parses seatQuantity from the first subscription item's quantity", () => {
    const client = fakeConstructEventClient(subscriptionWithQuantity(4));
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    const parsed = gateway.verifyAndParseEvent("raw-body", "sig");

    expect(parsed.subscription?.seatQuantity).toBe(4);
  });

  it("maps a missing/non-numeric quantity to null", () => {
    const client = fakeConstructEventClient(subscriptionWithQuantity(undefined));
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    const parsed = gateway.verifyAndParseEvent("raw-body", "sig");

    expect(parsed.subscription?.seatQuantity).toBeNull();
  });

  it("maps a subscription with no items at all to a null seatQuantity, without throwing", () => {
    const client = fakeConstructEventClient({
      id: "sub_seat_3",
      status: "active",
      customer: "cus_seat_3",
      cancel_at_period_end: false,
      metadata: {},
      items: { object: "list", data: [] } as unknown as Stripe.Subscription["items"],
    });
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    const parsed = gateway.verifyAndParseEvent("raw-body", "sig");

    expect(parsed.subscription?.seatQuantity).toBeNull();
  });
});
