import type { BillingFeature } from "@kinora/contracts";

/**
 * Config-driven Stripe pricing (11b-v1-billing-stripe-integration, Slice 1).
 *
 * EXPORT-ONLY in this slice: nothing here is wired into `plan-limits.ts` yet
 * (that swap is Slice 3), so the provisional `PRO_FEATURE_LIMIT = 1_000_000`
 * still governs live Pro caps and this slice keeps a provable zero-behavior
 * change. Secrets are read from env and NEVER logged.
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
 * Finite, high per-feature monthly Pro caps that replace the provisional
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
