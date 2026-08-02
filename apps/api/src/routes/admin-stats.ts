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
