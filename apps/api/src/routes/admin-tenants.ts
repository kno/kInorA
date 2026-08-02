import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { BillingSource, BillingTier } from "@kinora/contracts";
import { requireAuth } from "../auth/plugin.js";
import { buildRequireAdmin } from "../auth/require-admin.js";
import { resolveEffectiveTier, type BillingStatus } from "../billing/entitlement.js";
import { planTenantSearch } from "./tenant-search.js";

/**
 * Plain 8-4-4-4-12 hex UUID shape — same rationale as `admin-tier-override.ts`:
 * reject a malformed `:tenantId` up front as 422 instead of letting an invalid
 * `uuid` literal reach Postgres and fall through to the 500 handler. Uses the
 * loose hex shape (not `z.string().uuid()`) so this codebase's non-RFC-4122
 * UUID fixtures are accepted, matching Postgres's own `uuid` acceptance.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tenantIdParamsSchema = z.object({
  tenantId: z.string().regex(UUID_SHAPE),
});

/** Tenant billing row shape, mirrors `EntitlementContext.billing`. */
export interface TenantBillingSnapshot {
  tier: BillingTier;
  status: BillingStatus;
  source: BillingSource;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  /**
   * Seat count backing seat-scaled `trainer` limits (16c-v3 Slice D, design
   * Q4). Not read by `resolveEffectiveTier` (used here for tier resolution
   * only) — present purely to satisfy `EntitlementContext.billing`'s shape.
   */
  seatCount: number | null;
}

/** Active override detail for the provisioning-state read. */
export interface ActiveOverrideSnapshot {
  id: string;
  tier: BillingTier;
  startsAt: Date;
  endsAt: Date;
}

export interface TenantProvisioningState {
  /** The target tenant, or null when no tenant with that id exists (→ 404). */
  tenant: { id: string; name: string } | null;
  billing: TenantBillingSnapshot | null;
  activeOverride: ActiveOverrideSnapshot | null;
}

export interface TenantSearchQuery {
  /** LIKE-escaped name substring (already wrapped by the repo with `%…%`). */
  term: string;
  /** Exact `tenants.id` to OR-match, or null when the query is not a UUID. */
  matchId: string | null;
  limit: number;
}

/**
 * Narrow route port for the read-only admin tenants endpoints. `findUserById`
 * feeds `buildRequireAdmin`; the two read methods are satisfied by the concrete
 * `AdminTenantsRepository` composed in app.ts — this file imports ZERO `db/*`
 * (dep-cruiser `routes-no-db-layer`).
 */
export interface AdminTenantsRouteRepo {
  findUserById(id: string): Promise<{ id: string; isAdmin: boolean } | null>;
  searchTenants(query: TenantSearchQuery): Promise<{ id: string; name: string }[]>;
  loadProvisioningState(tenantId: string): Promise<TenantProvisioningState>;
}

export interface AdminTenantsRoutesOptions {
  repo: AdminTenantsRouteRepo;
}

/**
 * Read-only superadmin tenant directory + provisioning-state routes
 * (GH #307, search-by-name). Both require requireAuth() + requireAdmin.
 *
 *   GET /admin/tenants?query=&limit=            → search (200/403/422)
 *   GET /admin/tenants/:tenantId/tier-override  → current state (200/403/404/422)
 *
 * The search response is deliberately id+name only — never email or any other
 * tenant column. Tier resolution reuses the shared `resolveEffectiveTier`
 * precedence (active override wins over billing status); this file never
 * reimplements it.
 */
export const adminTenantsRoutes: FastifyPluginAsync<AdminTenantsRoutesOptions> = async (
  fastify,
  options,
) => {
  const { repo } = options;
  const requireAdmin = buildRequireAdmin({ findById: repo.findUserById });

  fastify.get(
    "/admin/tenants",
    { preHandler: [requireAuth(), requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query ?? {}) as { query?: unknown; limit?: unknown };
      const plan = planTenantSearch(query.query, query.limit);
      if (!plan.ok) {
        return reply.code(422).send({ error: "Validation Error" });
      }

      const tenants = await repo.searchTenants({
        term: plan.term,
        matchId: plan.matchId,
        limit: plan.limit,
      });

      return reply.code(200).send({ tenants });
    },
  );

  fastify.get(
    "/admin/tenants/:tenantId/tier-override",
    { preHandler: [requireAuth(), requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsResult = tenantIdParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.code(422).send({ error: "Validation Error" });
      }
      const { tenantId } = paramsResult.data;

      const state = await repo.loadProvisioningState(tenantId);
      if (!state.tenant) {
        return reply.code(404).send({ error: "unknown_tenant" });
      }

      const effective = resolveEffectiveTier(
        {
          // Membership is irrelevant to tier resolution here (an admin views an
          // arbitrary tenant they need not belong to); resolveEffectiveTier
          // ignores membershipStatus and reads only billing + override.
          membershipStatus: null,
          billing: state.billing,
          activeOverrideTier: state.activeOverride?.tier ?? null,
        },
        new Date(),
      );

      return reply.code(200).send({
        tenant: state.tenant,
        effectiveTier: effective.tier,
        billingStatus: state.billing?.status ?? null,
        activeOverride: state.activeOverride
          ? {
              id: state.activeOverride.id,
              tier: state.activeOverride.tier,
              startsAt: state.activeOverride.startsAt.toISOString(),
              endsAt: state.activeOverride.endsAt.toISOString(),
            }
          : null,
      });
    },
  );
};
