/**
 * Client-safe platform-statistics types and result envelope (GH #309).
 *
 * Intentionally free of `server-only`: imported by both the server-only
 * `stats-client.ts` and the `StatsView` component. Keeping the pure types here
 * mirrors `logs-constants.ts` / `tenant-provisioning-constants.ts`.
 *
 * Mirrors the API `GET /admin/stats` response (`PlatformStats` in
 * `apps/api/src/routes/admin-stats.ts`). The response is aggregates ONLY —
 * scalar counts / small enum-keyed tallies, never a per-tenant/per-user record.
 */

/** The four billing tiers (mirrors the API `BillingTier`). */
export const BILLING_TIERS = ["free", "pro", "trainer", "gym"] as const;
export type BillingTier = (typeof BILLING_TIERS)[number];

/** The metered features (mirrors the API `BILLING_FEATURES`). */
export const USAGE_FEATURES = [
  "plan_generation",
  "plan_regeneration",
  "memory_write",
  "memory_retrieval",
] as const;
export type UsageFeature = (typeof USAGE_FEATURES)[number];

export type TierTally = Record<BillingTier, number>;
export type FeatureTally = Record<UsageFeature, number>;

/**
 * One signup-week cohort of the create-plan → second-workout funnel (#353).
 * Mirrors `RetentionFunnelSteps` in `apps/api/src/routes/admin-stats.ts`.
 *
 * Every value is an ABSOLUTE COUNT and its denominator is the field above it
 * (`signups` → `createdPlan` → `completedFirstWorkout` →
 * `completedSecondWorkoutWithin7d` → `activeWeek2`/`activeWeek4`). The view
 * renders "3 of 4", never a bare "75%": a ratio without its n reads as a
 * finding when it may be four people.
 */
export interface RetentionFunnelSteps {
  signups: number;
  createdPlan: number;
  completedFirstWorkout: number;
  completedSecondWorkoutWithin7d: number;
  activeWeek2: number;
  activeWeek4: number;
  /** Counted apart from `signups` so the trainer cohort cannot skew B2C ratios. */
  trainerSponsoredSignups: number;
}

export interface RetentionFunnelCohort extends RetentionFunnelSteps {
  /** UTC ISO date of the Monday that starts this signup week. */
  weekStart: string;
}

export interface RetentionFunnel {
  windowWeeks: number;
  abandonedSessionThresholdHours: number;
  abandonedSessions: number;
  /** Most recent signup week first. */
  cohorts: RetentionFunnelCohort[];
  totals: RetentionFunnelSteps;
}

/** The platform-wide aggregate snapshot returned by `GET /admin/stats`. */
export interface PlatformStats {
  tenants: { total: number; signups7d: number; signups30d: number };
  users: { total: number; signups7d: number; signups30d: number };
  memberships: { activeByRole: { owner: number; member: number; trainer: number } };
  billing: {
    effectiveTier: TierTally;
    activeStripeSubscriptions: number;
    trials: number;
    activeOverridesByTier: TierTally;
  };
  usage: { thisPeriod: string; byFeature: FeatureTally };
  observability: { errors24h: number; events24h: number };
  retention: RetentionFunnel;
}

/**
 * Discriminated result envelope shared by the server-only `fetchStats` call and
 * the view — mirrors `logs-constants.ts`'s `kind` union so the view maps each
 * API status to a single human message.
 */
export type StatsResult =
  | { kind: "ok"; stats: PlatformStats }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };
