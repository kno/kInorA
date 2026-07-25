import { describe, expect, it, vi } from "vitest";
import {
  BILLING_PRICING_ERROR_ISSUES,
  PRO_TIER_LIMITS,
  annualSavePercent,
  buildBillingPricing,
  collectBillingPricingIssues,
  loadStripeConfig,
  validateBillingPricingConfig,
} from "../pricing-config.js";

// A fully-consistent env: both price IDs present alongside their display
// amounts, positive, annual cheaper than 12x monthly.
const CONSISTENT_PRICING_ENV = {
  STRIPE_PRICE_MONTHLY: "price_monthly_1",
  STRIPE_PRICE_ANNUAL: "price_annual_1",
  STRIPE_PRICE_MONTHLY_AMOUNT: "999",
  STRIPE_PRICE_ANNUAL_AMOUNT: "799",
};

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

describe("collectBillingPricingIssues (FIX 2 — display/charge drift guard)", () => {
  it("returns no issues for a fully-consistent config", () => {
    expect(collectBillingPricingIssues(CONSISTENT_PRICING_ENV)).toEqual([]);
  });

  it("flags a monthly display amount set WITHOUT its price-id env", () => {
    const { STRIPE_PRICE_MONTHLY: _drop, ...env } = CONSISTENT_PRICING_ENV;
    expect(collectBillingPricingIssues(env)).toContain("monthly_amount_without_price_id");
  });

  it("flags a monthly price-id set WITHOUT its display amount env", () => {
    const { STRIPE_PRICE_MONTHLY_AMOUNT: _drop, ...env } = CONSISTENT_PRICING_ENV;
    expect(collectBillingPricingIssues(env)).toContain("monthly_price_id_without_amount");
  });

  it("flags an annual display amount set WITHOUT its price-id env", () => {
    const { STRIPE_PRICE_ANNUAL: _drop, ...env } = CONSISTENT_PRICING_ENV;
    expect(collectBillingPricingIssues(env)).toContain("annual_amount_without_price_id");
  });

  it("flags an annual price-id set WITHOUT its display amount env", () => {
    const { STRIPE_PRICE_ANNUAL_AMOUNT: _drop, ...env } = CONSISTENT_PRICING_ENV;
    expect(collectBillingPricingIssues(env)).toContain("annual_price_id_without_amount");
  });

  it("flags a non-positive monthly amount", () => {
    expect(
      collectBillingPricingIssues({ ...CONSISTENT_PRICING_ENV, STRIPE_PRICE_MONTHLY_AMOUNT: "0" }),
    ).toContain("non_positive_monthly_amount");
  });

  it("flags a non-positive annual amount", () => {
    expect(
      collectBillingPricingIssues({ ...CONSISTENT_PRICING_ENV, STRIPE_PRICE_ANNUAL_AMOUNT: "-5" }),
    ).toContain("non_positive_annual_amount");
  });

  it("flags an annual interval charge that is NOT cheaper than 12x monthly", () => {
    // annual per-month >= monthly per-month → annual once-a-year charge >=
    // monthly*12, which is nonsensical (annual should save money).
    expect(
      collectBillingPricingIssues({ ...CONSISTENT_PRICING_ENV, STRIPE_PRICE_ANNUAL_AMOUNT: "999" }),
    ).toContain("annual_not_cheaper_than_monthly");
  });
});

describe("BILLING_PRICING_ERROR_ISSUES (FIX 2 round-2 — severity split)", () => {
  it("classifies the genuinely-broken cases as error-level (throw-worthy)", () => {
    expect([...BILLING_PRICING_ERROR_ISSUES].sort()).toEqual(
      [
        "annual_amount_without_price_id",
        "annual_not_cheaper_than_monthly",
        "monthly_amount_without_price_id",
        "non_positive_annual_amount",
        "non_positive_monthly_amount",
      ].sort(),
    );
  });

  it("classifies 'price-id set but amount unset' as WARN-level, NOT error (defaults are valid)", () => {
    expect(BILLING_PRICING_ERROR_ISSUES).not.toContain("monthly_price_id_without_amount");
    expect(BILLING_PRICING_ERROR_ISSUES).not.toContain("annual_price_id_without_amount");
  });
});

describe("validateBillingPricingConfig (FIX 2 — fail-fast vs warn)", () => {
  // A realistic prod deploy: Stripe Price IDs are set (checkout needs them) but
  // the operator left the *_AMOUNT display envs unset → buildBillingPricing
  // uses the documented-valid defaults (999/799). This MUST boot (warn only).
  const PRICE_IDS_ONLY_ENV = {
    STRIPE_PRICE_MONTHLY: "price_monthly_1",
    STRIPE_PRICE_ANNUAL: "price_annual_1",
  };

  it("accepts a consistent config without throwing (production)", () => {
    expect(() =>
      validateBillingPricingConfig(CONSISTENT_PRICING_ENV, { production: true }),
    ).not.toThrow();
  });

  it("does NOT throw in production when only Price IDs are set (defaults valid) — warns instead", () => {
    const warn = vi.fn();
    expect(() =>
      validateBillingPricingConfig(PRICE_IDS_ONLY_ENV, { production: true, warn }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("monthly_price_id_without_amount");
    expect(message).toContain("annual_price_id_without_amount");
  });

  it("throws in production for an amount set WITHOUT its price id, naming the issue", () => {
    const { STRIPE_PRICE_MONTHLY: _drop, ...env } = CONSISTENT_PRICING_ENV;
    let error: unknown;
    try {
      validateBillingPricingConfig(env, { production: true });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("monthly_amount_without_price_id");
  });

  it("throws in production for a non-positive amount", () => {
    expect(() =>
      validateBillingPricingConfig(
        { ...CONSISTENT_PRICING_ENV, STRIPE_PRICE_MONTHLY_AMOUNT: "0" },
        { production: true },
      ),
    ).toThrow(/non_positive_monthly_amount/);
  });

  it("throws in production when annual is NOT cheaper than 12x monthly", () => {
    expect(() =>
      validateBillingPricingConfig(
        { ...CONSISTENT_PRICING_ENV, STRIPE_PRICE_ANNUAL_AMOUNT: "999" },
        { production: true },
      ),
    ).toThrow(/annual_not_cheaper_than_monthly/);
  });

  it("warns (does NOT throw) outside production when inconsistent", () => {
    const { STRIPE_PRICE_MONTHLY: _drop, ...env } = CONSISTENT_PRICING_ENV;
    const warn = vi.fn();
    expect(() =>
      validateBillingPricingConfig(env, { production: false, warn }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("monthly_amount_without_price_id");
  });

  it("outside production NEVER throws, even for error-level issues (dev/test warns)", () => {
    const warn = vi.fn();
    expect(() =>
      validateBillingPricingConfig(
        { ...CONSISTENT_PRICING_ENV, STRIPE_PRICE_MONTHLY_AMOUNT: "0" },
        { production: false, warn },
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("non_positive_monthly_amount");
  });

  it("neither throws nor warns for a consistent config outside production", () => {
    const warn = vi.fn();
    expect(() =>
      validateBillingPricingConfig(CONSISTENT_PRICING_ENV, { production: false, warn }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
