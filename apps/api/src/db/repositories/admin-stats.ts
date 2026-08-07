import { and, desc, eq, gt, gte, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import type { BillingTier } from "@kinora/contracts";
import type { Database } from "../client.js";
import {
  memberships,
  observabilityEvents,
  tenantBillingOverrides,
  tenantBillingStates,
  tenantQuotaCounters,
  tenants,
  trainerClientAssignments,
  users,
  workoutPlans,
  workoutSessions,
} from "../schema.js";
import type {
  AdminStatsRouteRepo,
  FeatureTally,
  PlatformStats,
  RetentionFunnel,
  RetentionFunnelCohort,
  RetentionFunnelSteps,
  TierTally,
} from "../../routes/admin-stats.js";
import {
  type EntitlementContext,
  resolveEffectiveTier,
} from "../../billing/entitlement.js";
import { currentBillingPeriod } from "../../billing/plan-limits.js";
import {
  ABANDONED_SESSION_THRESHOLD_HOURS,
  abandonedSessionCutoff,
} from "../session-abandonment.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Re-exported from the shared `session-abandonment` module (17b) so this
 * file keeps publishing `abandonedSessionThresholdHours` on `PlatformStats`
 * unchanged, and so the existing integration-test import of this symbol at
 * this path keeps working. The session repository is the other consumer —
 * neither file computes the hours-to-ms arithmetic itself.
 */
export { ABANDONED_SESSION_THRESHOLD_HOURS };

/**
 * How many signup weeks the retention funnel reports (#353).
 *
 * Bounded because this runs against production data on an admin page render,
 * and because cohorts older than a quarter describe a product that no longer
 * exists. Note the trade-off the window forces: the newest cohorts have not
 * lived long enough to have week-2 or week-4 data yet, so their late-stage
 * counts are legitimately zero rather than a drop-off. The absolute counts make
 * that readable; a percentage would not.
 */
export const RETENTION_FUNNEL_WINDOW_WEEKS = 12;

/**
 * The Monday 00:00 UTC that starts `date`'s week — the same boundary Postgres
 * `date_trunc('week', ...)` uses (ISO weeks start Monday). Computed here rather
 * than in SQL so the window's oldest cohort is a WHOLE week: a mid-week lower
 * bound would silently truncate it and make the oldest bar look like a cliff.
 */
function startOfIsoWeekUtc(date: Date): Date {
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay(): 0 = Sunday. Shift so Monday = 0.
  monday.setUTCDate(monday.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return monday;
}

/** A zero-filled funnel step set, used as the seed of the totals reduce. */
function emptyRetentionSteps(): RetentionFunnelSteps {
  return {
    signups: 0,
    createdPlan: 0,
    completedFirstWorkout: 0,
    completedSecondWorkoutWithin7d: 0,
    activeWeek2: 0,
    activeWeek4: 0,
    trainerSponsoredSignups: 0,
  };
}

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
              // Not selected above: this admin stats tally only calls
              // resolveEffectiveTier (tier resolution), which never reads
              // seatCount — it exists purely to satisfy EntitlementContext's
              // shape (16c-v3 Slice D).
              seatCount: null,
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
      retention: await this.getRetentionFunnel(now),
    };
  }

  /**
   * The create-plan → second-workout retention funnel, cohorted by signup week
   * (#353).
   *
   * Computed entirely from tables the product already writes — no new
   * instrumentation — so it answers retroactively for every account that
   * already exists.
   *
   * SHAPE: two bounded queries, never N+1. The first flattens each qualifying
   * user into ONE row of booleans/timestamps (a subquery), then aggregates
   * those rows per cohort week with `count(*) filter (...)`. Doing the
   * per-user reduction in SQL is what keeps the result set to one row per
   * WEEK instead of one per user, which also means no user-identifying data
   * ever leaves the database — the same privacy invariant the rest of this
   * class holds.
   *
   * WHY THE SESSION JOIN IS THE ONLY JOIN: `has a plan` and `is
   * trainer-sponsored` are EXISTS subqueries rather than joins on purpose.
   * Left-joining `workout_plans` alongside `workout_sessions` would multiply
   * each session row by each plan row, and the duplicated timestamps would
   * corrupt the "second completed workout" ordinal — a user with two plans and
   * one workout would appear to have trained twice.
   */
  private async getRetentionFunnel(now: Date): Promise<RetentionFunnel> {
    const windowStart = new Date(
      startOfIsoWeekUtc(now).getTime() - (RETENTION_FUNNEL_WINDOW_WEEKS - 1) * 7 * DAY_MS,
    );
    const abandonedBefore = abandonedSessionCutoff(now);

    // One row per qualifying user. `array_agg(... order by ...)[2]` is the
    // second-oldest completion: Postgres has no nth-value aggregate, and a
    // window function would need a second pass over the same rows.
    const perUser = this.db
      .select({
        cohortWeek:
          sql<string>`to_char(date_trunc('week', ${users.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`.as(
            "cohort_week",
          ),
        trainerSponsored:
          sql<boolean>`exists (select 1 from ${trainerClientAssignments} tca where tca.client_user_id = ${users.id})`.as(
            "trainer_sponsored",
          ),
        hasPlan:
          sql<boolean>`exists (select 1 from ${workoutPlans} wp where wp.user_id = ${users.id})`.as(
            "has_plan",
          ),
        firstCompletedAt: sql<string | null>`min(${workoutSessions.completedAt})`.as(
          "first_completed_at",
        ),
        secondCompletedAt:
          sql<string | null>`(array_agg(${workoutSessions.completedAt} order by ${workoutSessions.completedAt}))[2]`.as(
            "second_completed_at",
          ),
        // "Still training in week N" is measured against SIGNUP, not against the
        // first workout: the question is whether the product held on to the
        // person, and a user who starts training three weeks late has already
        // been lost and recovered.
        trainedWeek2:
          sql<boolean>`bool_or(${workoutSessions.completedAt} >= ${users.createdAt} + interval '7 days' and ${workoutSessions.completedAt} < ${users.createdAt} + interval '14 days')`.as(
            "trained_week2",
          ),
        trainedWeek4:
          sql<boolean>`bool_or(${workoutSessions.completedAt} >= ${users.createdAt} + interval '21 days' and ${workoutSessions.completedAt} < ${users.createdAt} + interval '28 days')`.as(
            "trained_week4",
          ),
      })
      .from(users)
      // LEFT so a user with no workouts still contributes a cohort row — those
      // users are the drop-off this funnel exists to measure. `completed_at is
      // not null` is belt-and-braces next to `status = 'completed'`: a null
      // would sort last and never reach the [2] ordinal, but it would still
      // make `min()` lie about the first workout if the pair ever diverged.
      .leftJoin(
        workoutSessions,
        and(
          eq(workoutSessions.userId, users.id),
          eq(workoutSessions.status, "completed"),
          isNotNull(workoutSessions.completedAt),
        ),
      )
      .where(gte(users.createdAt, windowStart))
      .groupBy(users.id, users.createdAt)
      .as("per_user");

    // Each predicate EXTENDS the previous one, so the steps are structurally
    // nested and a later step can never out-count its own denominator.
    const isB2c = sql`not ${perUser.trainerSponsored}`;
    const reachedPlan = sql`${isB2c} and ${perUser.hasPlan}`;
    const reachedFirstWorkout = sql`${reachedPlan} and ${perUser.firstCompletedAt} is not null`;
    const reachedSecondWorkout = sql`${reachedFirstWorkout}
      and ${perUser.secondCompletedAt} is not null
      and ${perUser.secondCompletedAt} <= ${perUser.firstCompletedAt} + interval '7 days'`;

    const cohortRows = await this.db
      .select({
        weekStart: perUser.cohortWeek,
        signups: sql<number>`count(*) filter (where ${isB2c})::int`,
        createdPlan: sql<number>`count(*) filter (where ${reachedPlan})::int`,
        completedFirstWorkout: sql<number>`count(*) filter (where ${reachedFirstWorkout})::int`,
        completedSecondWorkoutWithin7d: sql<number>`count(*) filter (where ${reachedSecondWorkout})::int`,
        activeWeek2: sql<number>`count(*) filter (where ${reachedSecondWorkout} and ${perUser.trainedWeek2})::int`,
        activeWeek4: sql<number>`count(*) filter (where ${reachedSecondWorkout} and ${perUser.trainedWeek4})::int`,
        trainerSponsoredSignups: sql<number>`count(*) filter (where ${perUser.trainerSponsored})::int`,
      })
      .from(perUser)
      .groupBy(perUser.cohortWeek)
      .orderBy(desc(perUser.cohortWeek));

    // Two-arm predicate (17b), disjoint on `status` ALONE so mutual exclusion
    // is structural rather than argued:
    //   arm 1 — the stored fact. Deliberately NOT age-filtered: an explicitly
    //           discarded session is abandoned whatever its age.
    //   arm 2 — the legacy inference, for rows this change never touches
    //           (no backfill — decision 5).
    // No row can satisfy both: `status` is a single non-null column with
    // exactly one value per row, and arm 1 requires 'abandoned' while arm 2
    // requires 'active'.
    const [abandoned] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(workoutSessions)
      .innerJoin(users, eq(users.id, workoutSessions.userId))
      .where(
        and(
          gte(workoutSessions.startedAt, windowStart),
          or(
            eq(workoutSessions.status, "abandoned"),
            and(
              eq(workoutSessions.status, "active"),
              lt(workoutSessions.startedAt, abandonedBefore),
            ),
          ),
        ),
      );

    // Totals are summed in memory rather than re-queried with a second GROUP
    // BY: the cohort list is at most RETENTION_FUNNEL_WINDOW_WEEKS long, and a
    // separate query could disagree with the rows above under concurrent writes.
    const cohorts: RetentionFunnelCohort[] = cohortRows;
    const totals = cohorts.reduce<RetentionFunnelSteps>((acc, cohort) => {
      acc.signups += cohort.signups;
      acc.createdPlan += cohort.createdPlan;
      acc.completedFirstWorkout += cohort.completedFirstWorkout;
      acc.completedSecondWorkoutWithin7d += cohort.completedSecondWorkoutWithin7d;
      acc.activeWeek2 += cohort.activeWeek2;
      acc.activeWeek4 += cohort.activeWeek4;
      acc.trainerSponsoredSignups += cohort.trainerSponsoredSignups;
      return acc;
    }, emptyRetentionSteps());

    return {
      windowWeeks: RETENTION_FUNNEL_WINDOW_WEEKS,
      abandonedSessionThresholdHours: ABANDONED_SESSION_THRESHOLD_HOURS,
      abandonedSessions: abandoned?.total ?? 0,
      cohorts,
      totals,
    };
  }
}
