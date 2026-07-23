import type { BillingFeature, BillingSource, BillingTier } from "@kinora/contracts";
import type { BillingScope, EntitlementDecision } from "./types.js";
import { resolveTenantFeatureLimit } from "./plan-limits.js";

export type MembershipStatus = "invited" | "active" | "suspended";

export type BillingStatus = "active" | "trialing" | "expired" | "overridden";

/**
 * Everything the entitlement decision needs, read atomically per request. The
 * adapter resolves membership status, the tenant billing row, and whether an
 * admin override is active right now.
 */
export interface EntitlementContext {
  /** Membership status of the actor in the tenant, or null when no membership. */
  membershipStatus: MembershipStatus | null;
  /** The authoritative tenant billing row, or null when none exists. */
  billing: {
    tier: BillingTier;
    status: BillingStatus;
    source: BillingSource;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
  } | null;
  /** Tier granted by an override whose `[startsAt, endsAt)` window contains now, else null. */
  activeOverrideTier: BillingTier | null;
}

export interface EntitlementReaderPort {
  loadContext(scope: BillingScope): Promise<EntitlementContext>;
}

export interface EffectiveTier {
  tier: BillingTier;
  source: BillingSource;
  /** True when the resolved-to-free state is the result of a lapsed trial. */
  trialExpired: boolean;
}

/**
 * Resolve the tier in force right now. Precedence: an active admin override wins;
 * otherwise the tenant billing status decides. A `trialing` state is Pro only
 * while `now < trialEndsAt` — at or past the boundary it lapses to Free and is
 * flagged `trialExpired` so callers can surface a subscribe-to-continue prompt.
 *
 * Callers MUST ensure `ctx.billing` is present OR `ctx.activeOverrideTier` is set
 * before calling (see {@link CheckEntitlement.check}).
 */
export function resolveEffectiveTier(ctx: EntitlementContext, now: Date): EffectiveTier {
  if (ctx.activeOverrideTier) {
    return { tier: ctx.activeOverrideTier, source: "admin_override", trialExpired: false };
  }

  const billing = ctx.billing;
  if (!billing) {
    // Defensive: unreachable via CheckEntitlement, which denies first.
    return { tier: "free", source: "backfill", trialExpired: false };
  }

  if (billing.status === "trialing") {
    const expired = !billing.trialEndsAt || now.getTime() >= billing.trialEndsAt.getTime();
    return expired
      ? { tier: "free", source: billing.source, trialExpired: true }
      : { tier: "pro", source: billing.source, trialExpired: false };
  }

  if (billing.status === "expired") {
    return { tier: "free", source: billing.source, trialExpired: true };
  }

  // active | overridden-without-active-override → the stored tier stands.
  return { tier: billing.tier, source: billing.source, trialExpired: false };
}

/**
 * Entitlement use case: decides whether the resolved tenant tier grants a feature
 * at all. It does NOT consume quota. A feature limit of 0 for the effective tier
 * means the feature is premium-blocked (`premium_required`, or `trial_expired`
 * when a trial just lapsed). Fail-closed: inactive membership or a missing
 * billing state deny before any tier resolution.
 */
export class CheckEntitlement {
  constructor(private readonly reader: EntitlementReaderPort) {}

  async check(
    scope: BillingScope,
    feature: BillingFeature,
    now: Date = new Date(),
  ): Promise<EntitlementDecision> {
    const ctx = await this.reader.loadContext(scope);

    if (ctx.membershipStatus !== "active") {
      return { allowed: false, reason: "inactive_membership" };
    }

    if (!ctx.billing && !ctx.activeOverrideTier) {
      return { allowed: false, reason: "billing_state_unavailable" };
    }

    const effective = resolveEffectiveTier(ctx, now);
    const limit = resolveTenantFeatureLimit(effective.tier, feature);

    if (limit <= 0) {
      return {
        allowed: false,
        reason: effective.trialExpired ? "trial_expired" : "premium_required",
      };
    }

    return { allowed: true, tier: effective.tier, source: effective.source };
  }
}
