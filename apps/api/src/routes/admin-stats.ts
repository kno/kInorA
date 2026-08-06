import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { BillingFeature, BillingTier } from "@kinora/contracts";
import { requireAuth } from "../auth/plugin.js";
import { buildRequireAdmin } from "../auth/require-admin.js";

/**
 * Superadmin platform-statistics API (#309, read-only).
 *
 *   GET /admin/stats
 *   → 200 PlatformStats | 403 non-admin | 401 unauthenticated
 *
 * requireAuth() + requireAdmin gate it exactly like `admin-logs.ts`. The route
 * imports ZERO `db/*` (dep-cruiser `routes-no-db-layer`): it depends only on
 * the `AdminStatsRouteRepo` port, satisfied by the `AdminStatsRepository`
 * composed in app.ts.
 *
 * PRIVACY (AGENTS.md): the response is aggregates ONLY. It NEVER contains user
 * emails/names, tenant names/ids tied to a metric, override reasons, or any
 * per-tenant/per-user record — only scalar counts and small enum-keyed tallies.
 */

/** A per-tier tally (all four billing tiers, zero-filled). */
export type TierTally = Record<BillingTier, number>;

/** A per-feature usage tally (all metered features, zero-filled). */
export type FeatureTally = Record<BillingFeature, number>;

/**
 * One signup-week cohort's walk through the create-plan → second-workout funnel
 * (#353).
 *
 * Every step is an ABSOLUTE COUNT, and the count that is its denominator is
 * present on the same object — `signups` for `createdPlan`, `createdPlan` for
 * `completedFirstWorkout`, and so on down the chain. Nothing here is a ratio.
 * That is deliberate: a percentage on its own reads as a fact ("75% convert")
 * when the underlying reality may be three users out of four, and the whole
 * point of this funnel is to stop making product calls on numbers that sound
 * sturdier than they are. Any percentage is the renderer's job, next to its n.
 *
 * The counts NEST: each step is a subset of the one above it, so a step can
 * never exceed its denominator.
 */
export interface RetentionFunnelSteps {
  /**
   * B2C users who signed up in this week — the top of the funnel and the
   * denominator for `createdPlan`. Excludes synthetic accounts and
   * trainer-sponsored users (the latter are counted in
   * `trainerSponsoredSignups` instead).
   */
  signups: number;
  /** Of `signups`: how many have at least one `workout_plans` row. */
  createdPlan: number;
  /** Of `createdPlan`: how many completed at least one workout. */
  completedFirstWorkout: number;
  /** Of `completedFirstWorkout`: how many completed a SECOND within 7 days of the first. */
  completedSecondWorkoutWithin7d: number;
  /** Of `completedSecondWorkoutWithin7d`: how many completed a workout on days 7–14 after signup. */
  activeWeek2: number;
  /** Of `completedSecondWorkoutWithin7d`: how many completed a workout on days 21–28 after signup. */
  activeWeek4: number;
  /**
   * Users who signed up this week and are reachable through
   * `trainer_client_assignments`. Reported as a SEPARATE segment and never
   * included in `signups`: a trainer-sponsored client did not choose the
   * product the way a B2C signup did, and with essentially no B2B usage yet
   * even a handful of them would swing the B2C ratios.
   */
  trainerSponsoredSignups: number;
}

/** A `RetentionFunnelSteps` labelled with the signup week it covers. */
export interface RetentionFunnelCohort extends RetentionFunnelSteps {
  /** UTC ISO date of the Monday that starts this signup week. */
  weekStart: string;
}

/** The create-plan → second-workout retention funnel (#353). */
export interface RetentionFunnel {
  /** How many signup weeks the window covers (the newest cohorts cannot have week-4 data yet). */
  windowWeeks: number;
  /** Hours an `active` session may stay open before it is counted as abandoned. */
  abandonedSessionThresholdHours: number;
  /**
   * `active` sessions older than the threshold across the whole window: workouts
   * that were started and never closed. Counted apart from the funnel because
   * they are neither a completion nor a non-start.
   */
  abandonedSessions: number;
  /** Most recent signup week first. */
  cohorts: RetentionFunnelCohort[];
  /** The same steps summed across every cohort in the window. */
  totals: RetentionFunnelSteps;
}

/**
 * The platform-wide aggregate snapshot. Every field is a scalar count or a
 * small enum-keyed tally — never a per-row record.
 */
export interface PlatformStats {
  tenants: { total: number; signups7d: number; signups30d: number };
  users: { total: number; signups7d: number; signups30d: number };
  memberships: {
    /** Active memberships grouped by role. */
    activeByRole: { owner: number; member: number; trainer: number };
  };
  billing: {
    /** Tenants by EFFECTIVE tier (active override wins over the billing row). */
    effectiveTier: TierTally;
    /** `source='stripe' AND status='active'` billing states. */
    activeStripeSubscriptions: number;
    /** `status='trialing'` billing states. */
    trials: number;
    /** Overrides whose `[startsAt, endsAt)` window contains now, grouped by tier. */
    activeOverridesByTier: TierTally;
  };
  usage: {
    /** The current `YYYY-MM` billing period key the tallies are scoped to. */
    thisPeriod: string;
    byFeature: FeatureTally;
  };
  observability: { errors24h: number; events24h: number };
  /** Create-plan → second-workout retention, cohorted by signup week (#353). */
  retention: RetentionFunnel;
}

/**
 * Narrow route port. `findUserById` feeds `buildRequireAdmin`; `getPlatformStats`
 * is satisfied by the concrete `AdminStatsRepository` in app.ts.
 */
export interface AdminStatsRouteRepo {
  findUserById(id: string): Promise<{ id: string; isAdmin: boolean } | null>;
  getPlatformStats(): Promise<PlatformStats>;
}

export interface AdminStatsRoutesOptions {
  repo: AdminStatsRouteRepo;
}

export const adminStatsRoutes: FastifyPluginAsync<AdminStatsRoutesOptions> = async (
  fastify,
  options,
) => {
  const { repo } = options;
  if (!repo) {
    throw new Error("adminStatsRoutes requires a repo");
  }
  const requireAdmin = buildRequireAdmin({ findById: repo.findUserById });

  fastify.get(
    "/admin/stats",
    { preHandler: [requireAuth(), requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const stats = await repo.getPlatformStats();
      return reply.code(200).send(stats);
    },
  );
};
