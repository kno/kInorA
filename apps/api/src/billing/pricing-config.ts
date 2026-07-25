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
export const DEFAULT_CURRENCY = "eur";
export const MONTHS_PER_YEAR = 12;

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

/**
 * FIX 2 (display/charge drift guard). The DISPLAY amounts
 * (`STRIPE_PRICE_MONTHLY_AMOUNT` / `STRIPE_PRICE_ANNUAL_AMOUNT`) are read from
 * env INDEPENDENTLY of the Stripe Price IDs (`STRIPE_PRICE_MONTHLY` /
 * `STRIPE_PRICE_ANNUAL`) that `create-checkout` actually charges. If they
 * drift, the UI shows one price while Stripe charges another.
 *
 * This is a PURE, network-free config check (no boot-time Stripe call — that
 * would break hermetic tests / CI-without-Stripe and slow startup). It returns
 * a stable list of issue codes so an operator misconfiguration is caught at
 * config-load time:
 *   - a display amount env set without its corresponding Price-ID env (or
 *     a Price-ID env set without its display amount) — the strongest drift
 *     signal we can detect offline;
 *   - a non-positive display amount;
 *   - an annual once-a-year charge that is NOT cheaper than 12x the monthly
 *     price (nonsensical — annual is meant to save money).
 *
 * NOTE: display amounts MUST be kept in sync with the Stripe Price objects.
 * Sourcing them from the Stripe Price API is a possible future follow-up; this
 * guard deliberately stays offline and pure.
 */
/**
 * The subset of {@link collectBillingPricingIssues} codes that are genuinely
 * broken / nonsensical and therefore fail-fast (THROW) in production:
 *   - a display amount set WITHOUT its charged Price-ID (the display shows a
 *     price nothing charges);
 *   - a non-positive display amount;
 *   - an annual once-a-year charge NOT cheaper than 12x monthly.
 *
 * DELIBERATELY EXCLUDED: `*_price_id_without_amount`. A prod deploy MUST set
 * the Price IDs (checkout reads them); leaving the display `*_AMOUNT` envs
 * unset is valid — `buildBillingPricing` then uses the documented defaults
 * (999/799). Throwing there would crash a previously-healthy deploy, so it is
 * only a WARN.
 */
export const BILLING_PRICING_ERROR_ISSUES: readonly string[] = [
  "monthly_amount_without_price_id",
  "annual_amount_without_price_id",
  "non_positive_monthly_amount",
  "non_positive_annual_amount",
  "annual_not_cheaper_than_monthly",
];

export function collectBillingPricingIssues(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const issues: string[] = [];
  const isSet = (raw: string | undefined): boolean => raw !== undefined && raw.trim() !== "";

  const monthlyAmountSet = isSet(env.STRIPE_PRICE_MONTHLY_AMOUNT);
  const annualAmountSet = isSet(env.STRIPE_PRICE_ANNUAL_AMOUNT);
  const monthlyIdSet = isSet(env.STRIPE_PRICE_MONTHLY);
  const annualIdSet = isSet(env.STRIPE_PRICE_ANNUAL);

  if (monthlyAmountSet && !monthlyIdSet) issues.push("monthly_amount_without_price_id");
  if (monthlyIdSet && !monthlyAmountSet) issues.push("monthly_price_id_without_amount");
  if (annualAmountSet && !annualIdSet) issues.push("annual_amount_without_price_id");
  if (annualIdSet && !annualAmountSet) issues.push("annual_price_id_without_amount");

  const pricing = buildBillingPricing(env);
  if (pricing.monthly.amountPerMonth <= 0) issues.push("non_positive_monthly_amount");
  if (pricing.annual.amountPerMonth <= 0) issues.push("non_positive_annual_amount");
  // Annual once-a-year charge must be strictly cheaper than paying monthly for
  // twelve months; otherwise the "annual saves N%" story is broken/misleading.
  if (pricing.annual.amountPerInterval >= pricing.monthly.amountPerMonth * MONTHS_PER_YEAR) {
    issues.push("annual_not_cheaper_than_monthly");
  }

  return issues;
}

/** Options for {@link validateBillingPricingConfig}. */
export interface ValidateBillingPricingOptions {
  /** Fail-fast (throw) when true; otherwise emit a structured warning. */
  production?: boolean;
  /** Warning sink (defaults to `console.warn`) — injectable for tests. */
  warn?: (message: string) => void;
}

/**
 * Surface pricing-config drift at config-load time. In production an
 * ERROR-level issue (see {@link BILLING_PRICING_ERROR_ISSUES}) THROWS
 * (fail-fast) so a genuinely-broken misconfiguration is caught at boot; a
 * WARN-level issue (Price ID set but display `*_AMOUNT` unset → valid defaults)
 * only warns so a healthy deploy still boots. Outside production ALL issues
 * warn and NOTHING throws. A consistent config is a no-op. Pure + network-free
 * (see {@link collectBillingPricingIssues}).
 */
export function validateBillingPricingConfig(
  env: Record<string, string | undefined> = process.env,
  options: ValidateBillingPricingOptions = {},
): void {
  const issues = collectBillingPricingIssues(env);
  if (issues.length === 0) return;

  const message = `Inconsistent billing pricing config: ${issues.join(", ")}. Display amounts (STRIPE_PRICE_*_AMOUNT) MUST be kept in sync with the charged Stripe Price IDs (STRIPE_PRICE_*).`;

  const hasErrorLevel = issues.some((code) => BILLING_PRICING_ERROR_ISSUES.includes(code));

  if (options.production && hasErrorLevel) {
    throw new Error(message);
  }
  (options.warn ?? console.warn)(message);
}
