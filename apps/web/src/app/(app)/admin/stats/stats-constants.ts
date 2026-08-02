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
