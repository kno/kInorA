import type { BillingPricingDTO } from "@kinora/contracts";
import type { PriceGateway, StripePrice } from "./stripe-gateway.js";
import {
  DEFAULT_CURRENCY,
  MONTHS_PER_YEAR,
  annualSavePercent,
  buildBillingPricing,
} from "./pricing-config.js";

/**
 * Pure billing-pricing use case (#195).
 *
 * SDK-free: depends only on the {@link PriceGateway} port. It sources the
 * DISPLAYED monthly/annual amounts (and currency) from the REAL Stripe Price
 * objects — the same `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` ids checkout
 * actually charges — so the displayed price can never drift from the charged
 * price (11b shipped only an offline validator, which cannot catch an
 * internally-consistent-but-wrong display amount).
 *
 * Resilience: a small in-process TTL cache means `GET /billing/pricing` does not
 * call Stripe on every request. If a live retrieval fails (or returns an
 * inconsistent Price — a non-positive amount or a swapped interval), the use
 * case DOES NOT hard-crash the endpoint: it falls back to the config/env display
 * amounts (`buildBillingPricing`) and surfaces the inconsistency via `warn` (the
 * same drift the offline validator models). No Price id or secret is ever put in
 * the warning message.
 */

/** The config-driven Stripe Price ids, one per billing cycle (#195). */
export interface BillingPriceIds {
  monthly: string;
  annual: string;
}

/** Options for {@link ResolveBillingPricing}. */
export interface ResolveBillingPricingOptions {
  /**
   * Env bag used ONLY for the safe fallback when live sourcing fails/degrades.
   * Defaults to `process.env`.
   */
  fallbackEnv?: Record<string, string | undefined>;
  /** In-process cache TTL in ms (defaults to 5 minutes). */
  cacheTtlMs?: number;
  /** Monotonic-ish clock in ms (defaults to `Date.now`) — injectable for tests. */
  now?: () => number;
  /** Warning sink for a sourcing failure/inconsistency (defaults to `console.warn`). */
  warn?: (message: string) => void;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  pricing: BillingPricingDTO;
  expiresAt: number;
}

/**
 * Thrown internally when the sourced Prices are inconsistent (a swapped/absent
 * recurring interval or a non-positive amount) so the single fallback path
 * handles both a live retrieval error and a live-but-wrong Price uniformly.
 */
class InconsistentStripePriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InconsistentStripePriceError";
  }
}

export class ResolveBillingPricing {
  private readonly fallbackEnv: Record<string, string | undefined>;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private cache: CacheEntry | null = null;
  /**
   * The in-flight resolution shared by a concurrent burst on a cold/expired
   * cache (review #3). Without it, N simultaneous `GET /billing/pricing` each
   * run `resolve()` and fire their own Stripe retrievals, bypassing the TTL
   * cache. Stored on first miss, awaited by the rest, and cleared on settle.
   */
  private pending: Promise<BillingPricingDTO> | null = null;

  constructor(
    private readonly gateway: PriceGateway,
    private readonly priceIds: BillingPriceIds,
    options: ResolveBillingPricingOptions = {},
  ) {
    this.fallbackEnv = options.fallbackEnv ?? process.env;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  async execute(): Promise<BillingPricingDTO> {
    if (this.cache && this.now() < this.cache.expiresAt) {
      return this.cache.pricing;
    }
    // Coalesce a concurrent burst: the first miss starts one resolution; every
    // other caller awaits the SAME promise instead of firing its own retrievals.
    if (this.pending) {
      return this.pending;
    }

    this.pending = this.resolve()
      .then((pricing) => {
        // Cache whatever we resolved (sourced OR fallback): caching the fallback
        // too bounds Stripe calls during a brownout instead of hammering it per
        // request; the next request after the TTL retries live sourcing.
        this.cache = { pricing, expiresAt: this.now() + this.cacheTtlMs };
        return pricing;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  private async resolve(): Promise<BillingPricingDTO> {
    try {
      const [monthly, annual] = await Promise.all([
        this.gateway.retrievePrice(this.priceIds.monthly),
        this.gateway.retrievePrice(this.priceIds.annual),
      ]);
      return pricingFromStripePrices(monthly, annual);
    } catch (error) {
      // Fail SAFE, never hard-crash the pricing endpoint. Surface the drift the
      // offline validator models — with NO Price id or secret in the message.
      this.warn(
        `Falling back to config billing pricing: live Stripe Price sourcing failed or was inconsistent (${
          error instanceof Error ? error.name : "unknown_error"
        }). Displayed amounts may not reflect the charged Stripe Prices until this is resolved.`,
      );
      return buildBillingPricing(this.fallbackEnv);
    }
  }
}

/**
 * Build the display pricing DTO from the two sourced Stripe Prices. The monthly
 * Price recurs monthly (its unit amount IS the per-month amount); the annual
 * Price is charged once a year (its unit amount is the per-interval amount, and
 * the per-month figure is derived from it). Throws
 * {@link InconsistentStripePriceError} — so the caller falls back safely — when
 * the intervals are swapped/absent, an amount is non-positive, the two Prices
 * are in different currencies (review #1), or the annual charge is not cheaper
 * per month than monthly (review #2 — the offline validator's
 * `annual_not_cheaper_than_monthly` case, replicated on the live path).
 */
function pricingFromStripePrices(monthly: StripePrice, annual: StripePrice): BillingPricingDTO {
  if (monthly.interval !== "month" || annual.interval !== "year") {
    throw new InconsistentStripePriceError("stripe price intervals do not match the billing cycles");
  }
  const monthlyPerMonth = monthly.unitAmount ?? 0;
  const annualPerInterval = annual.unitAmount ?? 0;
  if (monthlyPerMonth <= 0 || annualPerInterval <= 0) {
    throw new InconsistentStripePriceError("stripe price unit amount is missing or non-positive");
  }
  // Both Prices MUST bill the same currency; silently keeping one would show a
  // price in a currency Stripe does not charge for the other cycle (review #1).
  const monthlyCurrency = (monthly.currency || DEFAULT_CURRENCY).toLowerCase();
  const annualCurrency = (annual.currency || DEFAULT_CURRENCY).toLowerCase();
  if (monthlyCurrency !== annualCurrency) {
    throw new InconsistentStripePriceError("stripe monthly and annual prices use different currencies");
  }
  // Replicate the offline `annual_not_cheaper_than_monthly` guard on the live
  // path (review #2): the yearly charge MUST be strictly cheaper than paying
  // monthly for twelve months, else the "annual saves N%" story is broken.
  if (annualPerInterval >= monthlyPerMonth * MONTHS_PER_YEAR) {
    throw new InconsistentStripePriceError("stripe annual price is not cheaper than 12x monthly");
  }
  const annualPerMonth = Math.round(annualPerInterval / MONTHS_PER_YEAR);
  const currency = monthlyCurrency;

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
      amountPerInterval: annualPerInterval,
    },
    annualSavePercent: annualSavePercent(monthlyPerMonth, annualPerMonth),
  };
}
