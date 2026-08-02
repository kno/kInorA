import { and, eq, gt, gte, lte, sql } from "drizzle-orm";
import type { BillingTier } from "@kinora/contracts";
import type { Database } from "../client.js";
import {
  memberships,
  observabilityEvents,
  tenantBillingOverrides,
  tenantBillingStates,
  tenantQuotaCounters,
  tenants,
  users,
} from "../schema.js";
import type {
  AdminStatsRouteRepo,
  FeatureTally,
  PlatformStats,
  TierTally,
} from "../../routes/admin-stats.js";
import {
  type EntitlementContext,
  resolveEffectiveTier,
} from "../../billing/entitlement.js";
import { currentBillingPeriod } from "../../billing/plan-limits.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** A zero-filled per-tier tally (all four billing tiers present). */
function emptyTierTally(): TierTally {
  return { free: 0, pro: 0, trainer: 0, gym: 0 };
}

/** A zero-filled per-feature tally (all metered features present). */
function emptyFeatureTally(): FeatureTally {
  return { plan_generation: 0, plan_regeneration: 0, memory_write: 0, memory_retrieval: 0 };
}

/**
 * Drizzle adapter for the read-only platform-statistics port (#309). Lives
 * under `db/` because `.dependency-cruiser.cjs` forbids importing drizzle/pg
 * outside the infra layer; the `admin-stats` route depends only on the
 * `AdminStatsRouteRepo` port.
 *
 * Every method here is strictly read-only and projects ONLY scalar aggregates
 * / small enum-keyed tallies — never a per-tenant/per-user row — so a
 * superadmin stats view can never leak PII (AGENTS.md privacy rule).
 *
 * The EFFECTIVE-tier breakdown does NOT `GROUP BY tenant_billing_states.tier`
 * (the Stripe webhook hardcodes `pro`, so trainer/gym never appear there and an
 * active admin override is invisible). Instead it fetches each tenant's billing
 * row + its active override and routes both through the SAME
 * `resolveEffectiveTier` the entitlement path uses — the single source of
 * truth — then tallies in memory. One bounded scan per table, no N+1.
 */
export class AdminStatsRepository
  implements Pick<AdminStatsRouteRepo, "getPlatformStats">
{
  constructor(private readonly db: Database) {}

  async getPlatformStats(now: Date = new Date()): Promise<PlatformStats> {
    const period = currentBillingPeriod(now);
    const since7d = new Date(now.getTime() - 7 * DAY_MS);
    const since30d = new Date(now.getTime() - 30 * DAY_MS);
    const since24h = new Date(now.getTime() - 24 * HOUR_MS);

    const [tenantCounts] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        signups7d: sql<number>`count(*) filter (where ${tenants.createdAt} >= ${since7d})::int`,
        signups30d: sql<number>`count(*) filter (where ${tenants.createdAt} >= ${since30d})::int`,
      })
      .from(tenants);

    const [userCounts] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        signups7d: sql<number>`count(*) filter (where ${users.createdAt} >= ${since7d})::int`,
        signups30d: sql<number>`count(*) filter (where ${users.createdAt} >= ${since30d})::int`,
      })
      .from(users);

    const roleRows = await this.db
      .select({
        role: memberships.role,
        c: sql<number>`count(*)::int`,
      })
      .from(memberships)
      .where(eq(memberships.status, "active"))
      .groupBy(memberships.role);

    const activeByRole = { owner: 0, member: 0, trainer: 0 };
    for (const row of roleRows) {
      activeByRole[row.role] = row.c;
    }

    // Scalar billing-state tallies: active Stripe subscriptions + trials. The
    // effective-tier breakdown is computed separately (below) via resolveEffectiveTier.
    const [billingScalars] = await this.db
      .select({
        activeStripeSubscriptions: sql<number>`count(*) filter (where ${tenantBillingStates.source} = 'stripe' and ${tenantBillingStates.status} = 'active')::int`,
        trials: sql<number>`count(*) filter (where ${tenantBillingStates.status} = 'trialing')::int`,
      })
      .from(tenantBillingStates);

    // Active overrides (window contains now): grouped tally + a per-tenant map
    // used by the effective-tier reduce.
    const activeOverrideRows = await this.db
      .select({
        tenantId: tenantBillingOverrides.tenantId,
        tier: tenantBillingOverrides.tier,
      })
      .from(tenantBillingOverrides)
      .where(and(lte(tenantBillingOverrides.startsAt, now), gt(tenantBillingOverrides.endsAt, now)));

    const activeOverridesByTier = emptyTierTally();
    const overrideByTenant = new Map<string, BillingTier>();
    for (const row of activeOverrideRows) {
      activeOverridesByTier[row.tier] += 1;
      // At most one active override per tenant is expected (grants are
      // serialized); defensively keep the first if two ever overlap.
      if (!overrideByTenant.has(row.tenantId)) overrideByTenant.set(row.tenantId, row.tier);
    }

    // Every tenant + its billing row (LEFT JOIN so billing-less tenants count as
    // free). One bounded scan; the active-override tier is joined in-memory.
    const tenantBillingRows = await this.db
      .select({
        tenantId: tenants.id,
        tier: tenantBillingStates.tier,
        status: tenantBillingStates.status,
        source: tenantBillingStates.source,
        trialStartedAt: tenantBillingStates.trialStartedAt,
        trialEndsAt: tenantBillingStates.trialEndsAt,
      })
      .from(tenants)
      .leftJoin(tenantBillingStates, eq(tenantBillingStates.tenantId, tenants.id));

    const effectiveTier = emptyTierTally();
    for (const row of tenantBillingRows) {
      const activeOverrideTier = overrideByTenant.get(row.tenantId) ?? null;
      const ctx: EntitlementContext = {
        membershipStatus: "active",
        billing: row.tier
          ? {
              tier: row.tier,
              status: row.status!,
              source: row.source!,
              trialStartedAt: row.trialStartedAt,
              trialEndsAt: row.trialEndsAt,
            }
          : null,
        activeOverrideTier,
      };
      const { tier } = resolveEffectiveTier(ctx, now);
      effectiveTier[tier] += 1;
    }

    const usageRows = await this.db
      .select({
        feature: tenantQuotaCounters.feature,
        total: sql<number>`coalesce(sum(${tenantQuotaCounters.used}), 0)::int`,
      })
      .from(tenantQuotaCounters)
      .where(eq(tenantQuotaCounters.period, period))
      .groupBy(tenantQuotaCounters.feature);

    const byFeature = emptyFeatureTally();
    for (const row of usageRows) {
      byFeature[row.feature] = row.total;
    }

    const [obsCounts] = await this.db
      .select({
        events24h: sql<number>`count(*)::int`,
        errors24h: sql<number>`count(*) filter (where ${observabilityEvents.level} = 'error')::int`,
      })
      .from(observabilityEvents)
      .where(gte(observabilityEvents.createdAt, since24h));

    return {
      tenants: {
        total: tenantCounts?.total ?? 0,
        signups7d: tenantCounts?.signups7d ?? 0,
        signups30d: tenantCounts?.signups30d ?? 0,
      },
      users: {
        total: userCounts?.total ?? 0,
        signups7d: userCounts?.signups7d ?? 0,
        signups30d: userCounts?.signups30d ?? 0,
      },
      memberships: { activeByRole },
      billing: {
        effectiveTier,
        activeStripeSubscriptions: billingScalars?.activeStripeSubscriptions ?? 0,
        trials: billingScalars?.trials ?? 0,
        activeOverridesByTier,
      },
      usage: { thisPeriod: period, byFeature },
      observability: {
        errors24h: obsCounts?.errors24h ?? 0,
        events24h: obsCounts?.events24h ?? 0,
      },
    };
  }
}
