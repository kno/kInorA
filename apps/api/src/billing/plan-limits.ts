import type { BillingFeature, BillingTier } from "@kinora/contracts";

/**
 * Provisional Pro aggregate cap per feature/period. 11a is provider-independent
 * and does not model pricing tiers, so Pro is treated as a generous finite pool
 * (kept well within a 32-bit integer column). Exact Pro pricing/limits arrive in
 * 11b; the per-member `member_quota_allocations` still bound individual members.
 */
export const PRO_FEATURE_LIMIT = 1_000_000;

/**
 * Free tier limits per calendar month (see spec `Plan Tiers`):
 *   - 1 plan generation, 1 regeneration
 *   - 0 premium vector-memory writes/retrievals (premium-gated)
 * A limit of 0 means the feature is premium-blocked at this tier.
 */
const FREE_TIER_LIMITS: Record<BillingFeature, number> = {
  plan_generation: 1,
  plan_regeneration: 1,
  memory_write: 0,
  memory_retrieval: 0,
};

/**
 * The tenant aggregate limit for a `(tier, feature)` pair. Free uses the fixed
 * monthly allowances; Pro uses the provisional aggregate cap.
 */
export function resolveTenantFeatureLimit(tier: BillingTier, feature: BillingFeature): number {
  return tier === "pro" ? PRO_FEATURE_LIMIT : FREE_TIER_LIMITS[feature];
}

/**
 * The calendar-month billing period key (`YYYY-MM`, UTC) used to scope quota
 * counters and the idempotency ledger. Usage resets naturally each month by
 * writing to a new period row.
 */
export function currentBillingPeriod(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
