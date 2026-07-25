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

/**
 * Why a previously-premium entitlement lapsed to Free, when it did. Drives the
 * denial reason a caller surfaces: a lapsed trial (`trial_expired`) vs a
 * canceled/ended paid subscription (`subscription_ended`). These are exactly
 * the two premium-lapse `BillingDenialReason` values (see `@kinora/contracts`).
 */
export type LapsedReason = "trial_expired" | "subscription_ended";

export interface EffectiveTier {
  tier: BillingTier;
  source: BillingSource;
  /**
   * Set when the resolved-to-Free state is the result of a LAPSED premium
   * entitlement, and says which kind: a lapsed trial vs a canceled paid
   * subscription. null when Free is not the result of a lapse (an always-Free
   * tenant, an active tier, or a still-active trial).
   */
  lapsedReason: LapsedReason | null;
}

/**
 * Resolve the tier in force right now. Precedence: an active admin override wins;
 * otherwise the tenant billing status decides. A `trialing` state is Pro only
 * while `now < trialEndsAt` — at or past the boundary it lapses to Free and is
 * flagged `trial_expired` so callers can surface a subscribe-to-continue prompt.
 *
 * A persisted `expired` status also lapses to Free, but the REASON depends on
 * `source`: a paid Stripe subscription that ended reports `subscription_ended`
 * (NOT `trial_expired`), while a system/backfill-provisioned trial that lapsed
 * reports `trial_expired`. The tier is Free in both cases — only the reason,
 * and thus the upgrade copy, differs (#196).
 *
 * Callers MUST ensure `ctx.billing` is present OR `ctx.activeOverrideTier` is set
 * before calling (see {@link CheckEntitlement.check}).
 */
export function resolveEffectiveTier(ctx: EntitlementContext, now: Date): EffectiveTier {
  if (ctx.activeOverrideTier) {
    return { tier: ctx.activeOverrideTier, source: "admin_override", lapsedReason: null };
  }

  const billing = ctx.billing;
  if (!billing) {
    // Defensive: unreachable via CheckEntitlement, which denies first.
    return { tier: "free", source: "backfill", lapsedReason: null };
  }

  if (billing.status === "trialing") {
    const expired = !billing.trialEndsAt || now.getTime() >= billing.trialEndsAt.getTime();
    return expired
      ? { tier: "free", source: billing.source, lapsedReason: "trial_expired" }
      : { tier: "pro", source: billing.source, lapsedReason: null };
  }

  if (billing.status === "expired") {
    // A paid Stripe subscription that lapsed is a canceled/ended SUBSCRIPTION,
    // not a trial — surface `subscription_ended` so the UI shows the right
    // "your subscription ended" copy instead of a misleading "trial ended".
    const lapsedReason: LapsedReason =
      billing.source === "stripe" ? "subscription_ended" : "trial_expired";
    return { tier: "free", source: billing.source, lapsedReason };
  }

  if (billing.status === "overridden") {
    // Reached only when NO active override is in effect (an active override is
    // resolved at the top of this function). A stored `overridden` status with a
    // lapsed window means the override tier can no longer be trusted — reconcile
    // to the Free baseline rather than granting a durable, never-expiring Pro.
    // Defensive: no code path currently writes `overridden`; this guards a future
    // override-write path from leaving a tenant permanently premium.
    return { tier: "free", source: billing.source, lapsedReason: null };
  }

  // active → the stored tier stands.
  return { tier: billing.tier, source: billing.source, lapsedReason: null };
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
      // A lapsed premium entitlement reports its specific reason (trial vs
      // ended subscription); an always-Free tenant reports `premium_required`.
      return {
        allowed: false,
        reason: effective.lapsedReason ?? "premium_required",
      };
    }

    return { allowed: true, tier: effective.tier, source: effective.source };
  }
}
