import type { BillingFeature, BillingTier } from "@kinora/contracts";
import { PRO_TIER_LIMITS } from "./pricing-config.js";

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
 * Trainer tier limits (15a-v2-trainer-account-access, Slice 1). Set at or
 * above the Pro caps so a `trainer`-tier tenant is never silently downgraded
 * to Free limits once the `trainer` BillingTier value exists. This slice is
 * dark/additive: no route yet grants or checks the `trainer` tier — that
 * gating lands with the authorization seam in Slice 2. Values chosen as a
 * multiple of the Pro caps to leave headroom for a trainer's multi-client
 * usage; they are not yet config-driven (no pricing exists for this tier).
 */
const TRAINER_TIER_LIMITS: Record<BillingFeature, number> = {
  plan_generation: PRO_TIER_LIMITS.plan_generation * 2,
  plan_regeneration: PRO_TIER_LIMITS.plan_regeneration * 2,
  memory_write: PRO_TIER_LIMITS.memory_write * 2,
  memory_retrieval: PRO_TIER_LIMITS.memory_retrieval * 2,
};

/**
 * Gym tier limits (16a-v3-gym-white-label, Slice 1). Set at the Pro caps so a
 * `gym`-tier tenant is never silently downgraded to Free limits once the
 * `gym` BillingTier value exists. This slice is dark/additive: no route yet
 * grants or checks the `gym` tier for a feature limit — the
 * `assertGymEntitled` authorization seam lands in Slice 3. Mirrors the Pro
 * caps exactly (unlike `trainer`, a gym tenant is not a multi-client
 * aggregator, so no headroom multiplier is applied).
 */
const GYM_TIER_LIMITS: Record<BillingFeature, number> = {
  plan_generation: PRO_TIER_LIMITS.plan_generation,
  plan_regeneration: PRO_TIER_LIMITS.plan_regeneration,
  memory_write: PRO_TIER_LIMITS.memory_write,
  memory_retrieval: PRO_TIER_LIMITS.memory_retrieval,
};

/**
 * The tenant aggregate limit for a `(tier, feature)` pair (11b Slice 3). Free
 * uses the fixed monthly allowances; Pro uses the config-driven, per-feature
 * {@link PRO_TIER_LIMITS} from `pricing-config.ts`. This is the point Pro
 * becomes REALLY metered — the provisional `1_000_000` blanket cap is gone, so
 * an over-cap Pro consumption is denied with `tenant_quota_exhausted` exactly
 * like a Free tenant over its allowance. Entitlement/tier RESOLUTION
 * (`resolveEffectiveTier`) is untouched; only the LIMIT resolution changed.
 *
 * `trainer` (15a-v2, Slice 1) resolves to {@link TRAINER_TIER_LIMITS} so it
 * never silently falls back to Free — see that const's docstring. `gym`
 * (16a-v3, Slice 1) resolves to {@link GYM_TIER_LIMITS} for the same reason.
 */
export function resolveTenantFeatureLimit(tier: BillingTier, feature: BillingFeature): number {
  if (tier === "pro") return PRO_TIER_LIMITS[feature];
  if (tier === "trainer") return TRAINER_TIER_LIMITS[feature];
  if (tier === "gym") return GYM_TIER_LIMITS[feature];
  return FREE_TIER_LIMITS[feature];
}

/**
 * Canonical calendar-month period key pattern (`YYYY-MM`, UTC). The month
 * segment is constrained to `01`–`12` so an impossible month like `2026-13`
 * or `2026-00` is rejected — such a period can never match
 * {@link currentBillingPeriod} and would otherwise persist as dead allocation
 * data. This is the SINGLE source of truth: the routes and the quota-admin use
 * case both import it instead of redefining the regex.
 */
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * True when `period` is a well-formed, in-range `YYYY-MM` billing period key.
 */
export function isValidPeriod(period: string): boolean {
  return PERIOD_PATTERN.test(period);
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
