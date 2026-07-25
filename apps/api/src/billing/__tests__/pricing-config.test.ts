import { describe, expect, it } from "vitest";
import {
  PRO_TIER_LIMITS,
  annualSavePercent,
  buildBillingPricing,
  loadStripeConfig,
} from "../pricing-config.js";

const FULL_ENV = {
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_WEBHOOK_SECRET: "whsec_def456",
  STRIPE_PRICE_MONTHLY: "price_monthly_1",
  STRIPE_PRICE_ANNUAL: "price_annual_1",
};

describe("pricing-config env reads (11b Slice 1)", () => {
  it("reads the four Stripe env vars into a typed config", () => {
    const cfg = loadStripeConfig(FULL_ENV);
    expect(cfg).toEqual({
      secretKey: "sk_test_abc123",
      webhookSecret: "whsec_def456",
      priceMonthly: "price_monthly_1",
      priceAnnual: "price_annual_1",
    });
  });

  it("reads a DIFFERENT env set (config-driven, not hardcoded)", () => {
    const cfg = loadStripeConfig({
      STRIPE_SECRET_KEY: "sk_test_other",
      STRIPE_WEBHOOK_SECRET: "whsec_other",
      STRIPE_PRICE_MONTHLY: "price_m2",
      STRIPE_PRICE_ANNUAL: "price_a2",
    });
    expect(cfg.priceMonthly).toBe("price_m2");
    expect(cfg.priceAnnual).toBe("price_a2");
  });

  it("throws naming the MISSING key but never leaking any secret value", () => {
    const { STRIPE_WEBHOOK_SECRET: _omit, ...missing } = FULL_ENV;
    let error: unknown;
    try {
      loadStripeConfig(missing);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("STRIPE_WEBHOOK_SECRET");
    // Secret hygiene: no configured secret VALUE may appear in the error.
    expect(message).not.toContain("sk_test_abc123");
    expect(message).not.toContain("price_monthly_1");
  });
});

describe("PRO_TIER_LIMITS (11b Slice 1)", () => {
  it("exposes the confirmed finite Pro caps per feature", () => {
    expect(PRO_TIER_LIMITS).toEqual({
      plan_generation: 500,
      plan_regeneration: 1000,
      memory_write: 50000,
      memory_retrieval: 200000,
    });
  });

  it("keeps every Pro cap inside the 32-bit integer counter column range", () => {
    for (const limit of Object.values(PRO_TIER_LIMITS)) {
      expect(Number.isInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(2_147_483_647);
    }
  });
});

describe("annualSavePercent (11b Slice 1)", () => {
  it("derives the save % from the configured amounts (9,99 vs 7,99 → 20)", () => {
    // 1 - 799/999 = 0.2002 → 20% (rounded). NOT a hardcoded 20 constant.
    expect(annualSavePercent(999, 799)).toBe(20);
  });

  it("derives a DIFFERENT save % when the amounts change (forces real math)", () => {
    // 1 - 500/1000 = 0.5 → 50%
    expect(annualSavePercent(1000, 500)).toBe(50);
    // 1 - 900/1000 = 0.1 → 10%
    expect(annualSavePercent(1000, 900)).toBe(10);
  });

  it("returns 0 when annual per-month equals monthly (no saving)", () => {
    expect(annualSavePercent(999, 999)).toBe(0);
  });
});

describe("buildBillingPricing (11b Slice 5 — web display pricing)", () => {
  it("defaults to 9,99 €/mo monthly and 7,99 €/mo annual with a derived 20% save", () => {
    const pricing = buildBillingPricing({});
    expect(pricing).toEqual({
      currency: "eur",
      monthly: { cycle: "monthly", amountPerMonth: 999, amountPerInterval: 999 },
      annual: { cycle: "annual", amountPerMonth: 799, amountPerInterval: 799 * 12 },
      annualSavePercent: 20,
    });
  });

  it("reads amounts + currency from env (config-driven, not hardcoded)", () => {
    const pricing = buildBillingPricing({
      STRIPE_PRICE_MONTHLY_AMOUNT: "1200",
      STRIPE_PRICE_ANNUAL_AMOUNT: "600",
      STRIPE_PRICE_CURRENCY: "usd",
    });
    expect(pricing.currency).toBe("usd");
    expect(pricing.monthly.amountPerMonth).toBe(1200);
    expect(pricing.monthly.amountPerInterval).toBe(1200);
    expect(pricing.annual.amountPerMonth).toBe(600);
    // Annual is billed once for twelve months.
    expect(pricing.annual.amountPerInterval).toBe(7200);
    // 1 - 600/1200 = 0.5 → 50% (derived, forces real math).
    expect(pricing.annualSavePercent).toBe(50);
  });

  it("normalizes the currency to lowercase", () => {
    expect(buildBillingPricing({ STRIPE_PRICE_CURRENCY: "EUR" }).currency).toBe("eur");
  });

  it("falls back to defaults when an amount env var is blank or non-numeric", () => {
    const pricing = buildBillingPricing({
      STRIPE_PRICE_MONTHLY_AMOUNT: "",
      STRIPE_PRICE_ANNUAL_AMOUNT: "not-a-number",
    });
    expect(pricing.monthly.amountPerMonth).toBe(999);
    expect(pricing.annual.amountPerMonth).toBe(799);
  });
});
