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
});
