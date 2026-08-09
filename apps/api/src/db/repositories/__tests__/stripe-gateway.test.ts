import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  StripeApiGateway,
  UnconfiguredCheckoutGateway,
  UnconfiguredPortalInvoiceGateway,
  UnconfiguredPriceGateway,
} from "../stripe-gateway.js";
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
  it("retrieves the subscription's first item id and updates quantity with create_prorations + the idempotency key when the price IS a configured seat price", async () => {
    const { client, retrieve, update } = fakeSubscriptionStripeClient({
      id: "sub_seat_1",
      items: {
        object: "list",
        data: [{ id: "si_seat_1", price: { id: "price_seat_monthly" } }],
      } as unknown as Stripe.Subscription["items"],
    });
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    await gateway.updateSubscriptionQuantity("sub_seat_1", 3, "seat-sync:tenant_1:3", [
      "price_seat_monthly",
      "price_seat_annual",
    ]);

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
      gateway.updateSubscriptionQuantity("sub_no_items", 2, "seat-sync:tenant_2:2", ["price_seat_monthly"]),
    ).rejects.toThrow(/no items/);
  });
});

// ---------------------------------------------------------------------------
// SEAT-PRICE GUARD (fix/seat-sync-price-guard) — the confirmed bug: a tenant
// can hold a flat Pro subscription AND an independent trainer/gym admin
// override at the same time. `SEAT_BILLING_ENABLED` alone never proves the
// sponsor's subscription IS a per-seat Trainer Seat one, so the gateway MUST
// verify the retrieved subscription's first item price id against the
// caller-supplied `seatPriceIds` and skip the update ENTIRELY (never call
// `stripe.subscriptions.update`) when it does not match.
// ---------------------------------------------------------------------------
describe("StripeApiGateway.updateSubscriptionQuantity — SEAT-PRICE GUARD (fix/seat-sync-price-guard)", () => {
  it("does NOT call stripe.subscriptions.update when the subscription's price is NOT a configured seat price (e.g. a flat Pro subscription)", async () => {
    const { client, retrieve, update } = fakeSubscriptionStripeClient({
      id: "sub_pro_1",
      items: {
        object: "list",
        data: [{ id: "si_pro_1", price: { id: "price_pro_monthly" } }],
      } as unknown as Stripe.Subscription["items"],
    });
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    await gateway.updateSubscriptionQuantity("sub_pro_1", 5, "seat-sync:tenant_pro:5", [
      "price_seat_monthly",
      "price_seat_annual",
    ]);

    expect(retrieve).toHaveBeenCalledWith("sub_pro_1");
    expect(update).not.toHaveBeenCalled();
  });

  it("does NOT call stripe.subscriptions.update when seatPriceIds is empty (no seat price configured yet)", async () => {
    const { client, update } = fakeSubscriptionStripeClient({
      id: "sub_pro_2",
      items: {
        object: "list",
        data: [{ id: "si_pro_2", price: { id: "price_pro_annual" } }],
      } as unknown as Stripe.Subscription["items"],
    });
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    await gateway.updateSubscriptionQuantity("sub_pro_2", 2, "seat-sync:tenant_pro_2:2", []);

    expect(update).not.toHaveBeenCalled();
  });

  it("DOES call stripe.subscriptions.update when the price matches one of the configured seat prices", async () => {
    const { client, update } = fakeSubscriptionStripeClient({
      id: "sub_seat_2",
      items: {
        object: "list",
        data: [{ id: "si_seat_2", price: { id: "price_seat_annual" } }],
      } as unknown as Stripe.Subscription["items"],
    });
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    await gateway.updateSubscriptionQuantity("sub_seat_2", 4, "seat-sync:tenant_seat:4", [
      "price_seat_monthly",
      "price_seat_annual",
    ]);

    expect(update).toHaveBeenCalledWith(
      "sub_seat_2",
      { items: [{ id: "si_seat_2", quantity: 4 }], proration_behavior: "create_prorations" },
      { idempotencyKey: "seat-sync:tenant_seat:4" },
    );
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

describe("StripeApiGateway.createCheckoutSession — line_items quantity (16c v3 Slice E)", () => {
  function fakeCheckoutSessionsClient(): {
    client: Stripe;
    createSpy: ReturnType<typeof vi.fn>;
  } {
    const createSpy = vi.fn(async () => ({ url: "https://checkout.stripe.test/session/1" }));
    const client = {
      checkout: { sessions: { create: createSpy } },
    } as unknown as Stripe;
    return { client, createSpy };
  }

  it("defaults to quantity 1 when the input carries no quantity (Pro path — byte-identical to today)", async () => {
    const { client, createSpy } = fakeCheckoutSessionsClient();
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "https://app.test", client);

    await gateway.createCheckoutSession({
      tenantId: "tenant-1",
      cycle: "monthly",
      priceId: "price_pro_m",
      promotionCodeId: null,
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_pro_m", quantity: 1 }],
      }),
    );
  });

  it("uses the supplied quantity on the seat path", async () => {
    const { client, createSpy } = fakeCheckoutSessionsClient();
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "https://app.test", client);

    await gateway.createCheckoutSession({
      tenantId: "tenant-1",
      cycle: "monthly",
      priceId: "price_seat_m",
      promotionCodeId: null,
      quantity: 3,
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_seat_m", quantity: 3 }],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// StripeApiGateway.validatePromotionCode (11b Slice 3) — no test previously
// exercised the real implementation: it must accept an active promotion code
// whose coupon is still valid, and reject an absent/inactive code or one
// whose coupon has expired/hit its redemption cap.
// ---------------------------------------------------------------------------

function fakePromotionCodesClient(
  promos: Array<Partial<Stripe.PromotionCode> & { coupon?: { valid?: boolean } }>,
): { client: Stripe; list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async () => ({ data: promos }));
  return { client: { promotionCodes: { list } } as unknown as Stripe, list };
}

describe("StripeApiGateway.validatePromotionCode (11b Slice 3)", () => {
  it("returns valid: true with the promotion code id when an active code with a valid coupon is found", async () => {
    const { client, list } = fakePromotionCodesClient([
      { id: "promo_1", active: true, coupon: { valid: true } },
    ]);
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    const result = await gateway.validatePromotionCode("SAVE10");

    expect(list).toHaveBeenCalledWith({ code: "SAVE10", active: true, limit: 1 });
    expect(result).toEqual({ valid: true, promotionCodeId: "promo_1" });
  });

  it("returns valid: false when no promotion code matches", async () => {
    const { client } = fakePromotionCodesClient([]);
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    expect(await gateway.validatePromotionCode("MISSING")).toEqual({
      valid: false,
      promotionCodeId: null,
    });
  });

  it("returns valid: false when the matched code is not active", async () => {
    const { client } = fakePromotionCodesClient([{ id: "promo_2", active: false }]);
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    expect(await gateway.validatePromotionCode("INACTIVE")).toEqual({
      valid: false,
      promotionCodeId: null,
    });
  });

  it("returns valid: false when the code is active but its coupon has expired/hit its redemption cap", async () => {
    const { client } = fakePromotionCodesClient([
      { id: "promo_3", active: true, coupon: { valid: false } },
    ]);
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "", client);

    expect(await gateway.validatePromotionCode("EXPIRED")).toEqual({
      valid: false,
      promotionCodeId: null,
    });
  });
});

// ---------------------------------------------------------------------------
// StripeApiGateway.createPortalSession (11b Slice 4) — no test previously
// exercised the real implementation: it must pass the customer id and the
// configured return URL through to Stripe and surface the hosted URL.
// ---------------------------------------------------------------------------

describe("StripeApiGateway.createPortalSession (11b Slice 4)", () => {
  it("passes the customer id and return_url built from returnUrl to the Stripe SDK and returns the hosted url", async () => {
    const createSpy = vi.fn(async () => ({ url: "https://billing.stripe.test/portal/1" }));
    const client = { billingPortal: { sessions: { create: createSpy } } } as unknown as Stripe;
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "https://app.test", client);

    const session = await gateway.createPortalSession("cus_portal_1");

    expect(createSpy).toHaveBeenCalledWith({
      customer: "cus_portal_1",
      return_url: "https://app.test/billing",
    });
    expect(session).toEqual({ url: "https://billing.stripe.test/portal/1" });
  });

  it("throws when Stripe returns no url", async () => {
    const client = {
      billingPortal: { sessions: { create: vi.fn(async () => ({ url: null })) } },
    } as unknown as Stripe;
    const gateway = new StripeApiGateway("sk_test_unused", "whsec_test_unused", "https://app.test", client);

    await expect(gateway.createPortalSession("cus_portal_2")).rejects.toThrow(/did not return a url/);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed gateways used when Stripe env is unconfigured. Each method must
// throw StripeGatewayUnconfiguredError so the corresponding route fails
// closed (5xx) rather than silently pretending Stripe is reachable.
// ---------------------------------------------------------------------------

describe("UnconfiguredCheckoutGateway (11b Slice 3)", () => {
  it("validatePromotionCode throws StripeGatewayUnconfiguredError", async () => {
    const gateway = new UnconfiguredCheckoutGateway();
    await expect(gateway.validatePromotionCode()).rejects.toBeInstanceOf(
      StripeGatewayUnconfiguredError,
    );
  });

  it("createCheckoutSession throws StripeGatewayUnconfiguredError", async () => {
    const gateway = new UnconfiguredCheckoutGateway();
    await expect(gateway.createCheckoutSession()).rejects.toBeInstanceOf(
      StripeGatewayUnconfiguredError,
    );
  });
});

describe("UnconfiguredPortalInvoiceGateway (11b Slice 4)", () => {
  it("createPortalSession throws StripeGatewayUnconfiguredError", async () => {
    const gateway = new UnconfiguredPortalInvoiceGateway();
    await expect(gateway.createPortalSession()).rejects.toBeInstanceOf(
      StripeGatewayUnconfiguredError,
    );
  });

  it("listInvoices throws StripeGatewayUnconfiguredError", async () => {
    const gateway = new UnconfiguredPortalInvoiceGateway();
    await expect(gateway.listInvoices()).rejects.toBeInstanceOf(StripeGatewayUnconfiguredError);
  });
});
