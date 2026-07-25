import type { BillingFeature, BillingPricingDTO } from "@kinora/contracts";

/**
 * Config-driven Stripe pricing (11b-v1-billing-stripe-integration).
 *
 * Since Slice 3, `PRO_TIER_LIMITS` is imported by `plan-limits.ts` and governs
 * the REAL, per-feature Pro caps (the provisional `1_000_000` blanket cap was
 * dropped). Secrets are read from env and NEVER logged.
 */

/** Environment-shaped Stripe configuration, resolved from env/secret. */
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceMonthly: string;
  priceAnnual: string;
}

/** The env keys that back {@link StripeConfig}. Order-stable for error messages. */
const REQUIRED_ENV = {
  secretKey: "STRIPE_SECRET_KEY",
  webhookSecret: "STRIPE_WEBHOOK_SECRET",
  priceMonthly: "STRIPE_PRICE_MONTHLY",
  priceAnnual: "STRIPE_PRICE_ANNUAL",
} as const satisfies Record<keyof StripeConfig, string>;

/**
 * Read the Stripe configuration from an env bag (defaults to `process.env`).
 * Throws naming ONLY the missing env key — never any configured secret value —
 * to keep secrets out of logs and error output.
 */
export function loadStripeConfig(
  env: Record<string, string | undefined> = process.env,
): StripeConfig {
  const config = {} as StripeConfig;
  for (const [field, key] of Object.entries(REQUIRED_ENV) as Array<
    [keyof StripeConfig, string]
  >) {
    const value = env[key];
    if (value === undefined || value === "") {
      throw new Error(`Missing required Stripe env var: ${key}`);
    }
    config[field] = value;
  }
  return config;
}

/**
 * Finite, high per-feature monthly Pro caps that replaced the provisional
 * `1_000_000` placeholder (wired into `plan-limits.ts` in Slice 3). Values fit
 * the 32-bit `integer` counter columns and read as generous vs Free (1/1/0/0).
 */
export const PRO_TIER_LIMITS: Record<BillingFeature, number> = {
  plan_generation: 500,
  plan_regeneration: 1000,
  memory_write: 50000,
  memory_retrieval: 200000,
};

/**
 * Annual saving percentage DERIVED from the two configured amounts, so the
 * displayed "save N%" badge is never a hardcoded literal. Both amounts are the
 * per-month price in the same minor unit (e.g. cents): `round((1 - annual /
 * monthly) * 100)`.
 */
export function annualSavePercent(monthlyAmount: number, annualPerMonthAmount: number): number {
  if (monthlyAmount <= 0) return 0;
  return Math.round((1 - annualPerMonthAmount / monthlyAmount) * 100);
}

/**
 * Default per-month display amounts (minor units) + currency, matching the
 * spec's initial configured values (9,99 €/mo monthly, 7,99 €/mo annual). These
 * are backoffice-ready via env overrides — never hardcoded in the web bundle.
 */
const DEFAULT_MONTHLY_AMOUNT = 999;
const DEFAULT_ANNUAL_PER_MONTH_AMOUNT = 799;
const DEFAULT_CURRENCY = "eur";
const MONTHS_PER_YEAR = 12;

/** Parse a minor-unit amount env var, falling back to `fallback` when blank/non-numeric. */
function readAmount(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Build the config-driven display pricing surfaced to the web billing screen
 * (11b Slice 5). Amounts + currency come from env (`STRIPE_PRICE_MONTHLY_AMOUNT`,
 * `STRIPE_PRICE_ANNUAL_AMOUNT`, `STRIPE_PRICE_CURRENCY`), and the save badge is
 * DERIVED from the two amounts — so the web never hardcodes prices or the save %.
 */
export function buildBillingPricing(
  env: Record<string, string | undefined> = process.env,
): BillingPricingDTO {
  const monthlyPerMonth = readAmount(env.STRIPE_PRICE_MONTHLY_AMOUNT, DEFAULT_MONTHLY_AMOUNT);
  const annualPerMonth = readAmount(
    env.STRIPE_PRICE_ANNUAL_AMOUNT,
    DEFAULT_ANNUAL_PER_MONTH_AMOUNT,
  );
  const currency = (env.STRIPE_PRICE_CURRENCY ?? DEFAULT_CURRENCY).toLowerCase();

  return {
    currency,
    monthly: {
      cycle: "monthly",
      amountPerMonth: monthlyPerMonth,
      amountPerInterval: monthlyPerMonth,
    },
    annual: {
      cycle: "annual",
      amountPerMonth: annualPerMonth,
      amountPerInterval: annualPerMonth * MONTHS_PER_YEAR,
    },
    annualSavePercent: annualSavePercent(monthlyPerMonth, annualPerMonth),
  };
}
