import { describe, expect, it, vi } from "vitest";
import { ResolveBillingPricing } from "../billing-pricing.js";
import type { PriceGateway, StripePrice } from "../stripe-gateway.js";

// #195 — displayed billing prices must come from the REAL Stripe Price objects
// (the single source of truth Stripe actually charges), NOT from display-only
// env amounts that can silently drift from the charged Price IDs.

const PRICE_IDS = { monthly: "price_monthly_1", annual: "price_annual_1" };

// A realistic pair of Stripe Price objects: monthly recurs every month at 12,99;
// annual is charged once a year at 95,88 (= 7,99/mo). These are what Stripe
// actually charges, so the displayed amounts MUST equal them.
const MONTHLY_PRICE: StripePrice = { unitAmount: 1299, currency: "eur", interval: "month" };
const ANNUAL_PRICE: StripePrice = { unitAmount: 9588, currency: "eur", interval: "year" };

function buildGateway(
  prices: Record<string, StripePrice> = {
    [PRICE_IDS.monthly]: MONTHLY_PRICE,
    [PRICE_IDS.annual]: ANNUAL_PRICE,
  },
) {
  const retrieveSpy = vi.fn(async (priceId: string): Promise<StripePrice> => {
    const price = prices[priceId];
    if (!price) throw new Error(`no such price: ${priceId}`);
    return price;
  });
  const gateway: PriceGateway = { retrievePrice: retrieveSpy };
  return { gateway, retrieveSpy };
}

describe("ResolveBillingPricing — display amounts sourced from Stripe (#195)", () => {
  it("sources the displayed amounts + currency from the real Stripe Price objects", async () => {
    const { gateway, retrieveSpy } = buildGateway();
    const useCase = new ResolveBillingPricing(gateway, PRICE_IDS);

    const pricing = await useCase.execute();

    // Displayed amounts EQUAL what Stripe charges (per the retrieved Price ids).
    expect(retrieveSpy).toHaveBeenCalledWith(PRICE_IDS.monthly);
    expect(retrieveSpy).toHaveBeenCalledWith(PRICE_IDS.annual);
    expect(pricing).toEqual({
      currency: "eur",
      monthly: { cycle: "monthly", amountPerMonth: 1299, amountPerInterval: 1299 },
      // Annual is charged once a year (9588); per-month is derived (9588/12 = 799).
      annual: { cycle: "annual", amountPerMonth: 799, amountPerInterval: 9588 },
      // Derived from the SOURCED amounts: round((1 - 799/1299) * 100) = 38.
      annualSavePercent: 38,
    });
  });

  it("normalizes the sourced currency to lowercase", async () => {
    const { gateway } = buildGateway({
      [PRICE_IDS.monthly]: { ...MONTHLY_PRICE, currency: "USD" },
      [PRICE_IDS.annual]: { ...ANNUAL_PRICE, currency: "USD" },
    });
    const useCase = new ResolveBillingPricing(gateway, PRICE_IDS);

    expect((await useCase.execute()).currency).toBe("usd");
  });

  it("caches the sourced pricing so GET /billing/pricing does not call Stripe on every request", async () => {
    const { gateway, retrieveSpy } = buildGateway();
    const useCase = new ResolveBillingPricing(gateway, PRICE_IDS, { cacheTtlMs: 60_000, now: () => 0 });

    await useCase.execute();
    await useCase.execute();
    await useCase.execute();

    // Two retrievals total (monthly + annual) for the FIRST call only; the
    // subsequent calls are served from the in-process cache.
    expect(retrieveSpy).toHaveBeenCalledTimes(2);
  });

  it("re-sources from Stripe once the cache TTL has elapsed", async () => {
    const { gateway, retrieveSpy } = buildGateway();
    let clock = 0;
    const useCase = new ResolveBillingPricing(gateway, PRICE_IDS, {
      cacheTtlMs: 60_000,
      now: () => clock,
    });

    await useCase.execute();
    clock = 60_001; // past the TTL
    await useCase.execute();

    // Two retrievals per resolution → four after the cache expired and refilled.
    expect(retrieveSpy).toHaveBeenCalledTimes(4);
  });

  it("falls back to the env/config amounts and WARNS when a live retrieval fails", async () => {
    const retrieveSpy = vi.fn(async (): Promise<StripePrice> => {
      throw new Error("stripe unreachable");
    });
    const warn = vi.fn();
    const useCase = new ResolveBillingPricing(
      { retrievePrice: retrieveSpy },
      PRICE_IDS,
      { fallbackEnv: { STRIPE_PRICE_MONTHLY_AMOUNT: "999", STRIPE_PRICE_ANNUAL_AMOUNT: "799" }, warn },
    );

    const pricing = await useCase.execute();

    // Endpoint does NOT hard-crash: it serves the configured fallback amounts.
    expect(pricing.monthly.amountPerMonth).toBe(999);
    expect(pricing.annual.amountPerMonth).toBe(799);
    expect(pricing.annualSavePercent).toBe(20);
    // The inconsistency/outage is surfaced (never a leaked secret in the message).
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("price_monthly_1");
  });

  it("falls back + warns when the sourced Price intervals are inconsistent (misconfigured Price IDs)", async () => {
    // Monthly Price id points at a YEARLY price (swapped/misconfigured) — the
    // exact display/charge inconsistency the offline validator models.
    const { gateway } = buildGateway({
      [PRICE_IDS.monthly]: { ...MONTHLY_PRICE, interval: "year" },
      [PRICE_IDS.annual]: ANNUAL_PRICE,
    });
    const warn = vi.fn();
    const useCase = new ResolveBillingPricing(gateway, PRICE_IDS, {
      fallbackEnv: { STRIPE_PRICE_MONTHLY_AMOUNT: "999", STRIPE_PRICE_ANNUAL_AMOUNT: "799" },
      warn,
    });

    const pricing = await useCase.execute();

    expect(pricing.monthly.amountPerMonth).toBe(999);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back + warns when a sourced amount is missing/non-positive", async () => {
    const { gateway } = buildGateway({
      [PRICE_IDS.monthly]: { ...MONTHLY_PRICE, unitAmount: null },
      [PRICE_IDS.annual]: ANNUAL_PRICE,
    });
    const warn = vi.fn();
    const useCase = new ResolveBillingPricing(gateway, PRICE_IDS, {
      fallbackEnv: { STRIPE_PRICE_MONTHLY_AMOUNT: "999", STRIPE_PRICE_ANNUAL_AMOUNT: "799" },
      warn,
    });

    const pricing = await useCase.execute();

    expect(pricing.monthly.amountPerMonth).toBe(999);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back + warns when the monthly and annual Prices are in DIFFERENT currencies (review #1)", async () => {
    // Monthly charges EUR, annual charges USD — silently picking one would show
    // e.g. 95,88 EUR/yr while Stripe charges 95,88 USD/yr: the exact
    // display/charge drift #195 must prevent.
    const { gateway } = buildGateway({
      [PRICE_IDS.monthly]: { ...MONTHLY_PRICE, currency: "eur" },
      [PRICE_IDS.annual]: { ...ANNUAL_PRICE, currency: "usd" },
    });
    const warn = vi.fn();
    const useCase = new ResolveBillingPricing(gateway, PRICE_IDS, {
      fallbackEnv: {
        STRIPE_PRICE_MONTHLY_AMOUNT: "999",
        STRIPE_PRICE_ANNUAL_AMOUNT: "799",
        STRIPE_PRICE_CURRENCY: "eur",
      },
      warn,
    });

    const pricing = await useCase.execute();

    // Falls back to the config amounts rather than silently mixing currencies.
    expect(pricing.currency).toBe("eur");
    expect(pricing.monthly.amountPerMonth).toBe(999);
    expect(pricing.annual.amountPerMonth).toBe(799);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back + warns when the annual Price is NOT cheaper per month than monthly (review #2)", async () => {
    // monthly 799/mo, annual 12000/yr → 1000/mo → a NEGATIVE save % (-25). The
    // offline validator models this as `annual_not_cheaper_than_monthly`; the
    // live path must too instead of shipping a "save -25%" badge.
    const { gateway } = buildGateway({
      [PRICE_IDS.monthly]: { unitAmount: 799, currency: "eur", interval: "month" },
      [PRICE_IDS.annual]: { unitAmount: 12000, currency: "eur", interval: "year" },
    });
    const warn = vi.fn();
    const useCase = new ResolveBillingPricing(gateway, PRICE_IDS, {
      fallbackEnv: { STRIPE_PRICE_MONTHLY_AMOUNT: "999", STRIPE_PRICE_ANNUAL_AMOUNT: "799" },
      warn,
    });

    const pricing = await useCase.execute();

    expect(pricing.monthly.amountPerMonth).toBe(999);
    expect(pricing.annualSavePercent).toBe(20); // from the sane fallback, never -25
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("coalesces a concurrent burst on a cold cache into a SINGLE resolve (review #3)", async () => {
    // A gateway that only settles after a tick, so all concurrent calls observe
    // an empty cache and would each fire their own retrievals without coalescing.
    const retrieveSpy = vi.fn(
      (priceId: string): Promise<StripePrice> =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(priceId === PRICE_IDS.monthly ? MONTHLY_PRICE : ANNUAL_PRICE),
            0,
          ),
        ),
    );
    const useCase = new ResolveBillingPricing({ retrievePrice: retrieveSpy }, PRICE_IDS);

    // Fire five concurrent requests against the cold cache.
    const results = await Promise.all(Array.from({ length: 5 }, () => useCase.execute()));

    // Exactly ONE resolve → two retrievals total (monthly + annual), not 5 × 2.
    expect(retrieveSpy).toHaveBeenCalledTimes(2);
    for (const pricing of results) {
      expect(pricing.monthly.amountPerMonth).toBe(1299);
    }
  });
});
