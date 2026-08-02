import { and, eq, gt, ilike, lte, or } from "drizzle-orm";
import type { Database } from "../client.js";
import { tenantBillingOverrides, tenantBillingStates, tenants } from "../schema.js";
import type {
  AdminTenantsRouteRepo,
  TenantProvisioningState,
  TenantSearchQuery,
} from "../../routes/admin-tenants.js";

/**
 * Drizzle adapter for the read-only admin tenant directory (GH #307). Lives
 * under `db/` because `.dependency-cruiser.cjs` forbids importing drizzle/pg
 * outside the infra layer; the `admin-tenants` route depends only on the
 * `AdminTenantsRouteRepo` port.
 *
 * Both methods are strictly read-only. `searchTenants` projects id+name ONLY —
 * never email or any other column — so a superadmin directory search cannot
 * leak tenant PII.
 */
export class AdminTenantsRepository
  implements Pick<AdminTenantsRouteRepo, "searchTenants" | "loadProvisioningState">
{
  constructor(private readonly db: Database) {}

  /**
   * Case-insensitive `name` substring match (`ILIKE '%term%'`), OR-ed with an
   * exact `id` match when the caller resolved the query to a UUID. `term` is
   * already LIKE-escaped by `planTenantSearch`; the `%…%` wrap is applied here.
   * Capped by the pre-validated `limit`.
   */
  async searchTenants(query: TenantSearchQuery): Promise<{ id: string; name: string }[]> {
    const nameMatch = ilike(tenants.name, `%${query.term}%`);
    const where = query.matchId ? or(nameMatch, eq(tenants.id, query.matchId)) : nameMatch;

    return this.db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(where)
      .orderBy(tenants.name)
      .limit(query.limit);
  }

  /**
   * Read the current provisioning state for one tenant: its {id,name}, the
   * authoritative billing row (if any), and the active override whose
   * `[startsAt, endsAt)` window contains now (if any) — the same active-window
   * predicate the entitlement reader and `loadActiveOverride` use. Returns a
   * null `tenant` when no such tenant exists so the route can map it to 404.
   */
  async loadProvisioningState(tenantId: string): Promise<TenantProvisioningState> {
    const [tenant] = await this.db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    if (!tenant) {
      return { tenant: null, billing: null, activeOverride: null };
    }

    const [billing] = await this.db
      .select({
        tier: tenantBillingStates.tier,
        status: tenantBillingStates.status,
        source: tenantBillingStates.source,
        trialStartedAt: tenantBillingStates.trialStartedAt,
        trialEndsAt: tenantBillingStates.trialEndsAt,
      })
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, tenantId));

    const now = new Date();
    const [override] = await this.db
      .select({
        id: tenantBillingOverrides.id,
        tier: tenantBillingOverrides.tier,
        startsAt: tenantBillingOverrides.startsAt,
        endsAt: tenantBillingOverrides.endsAt,
      })
      .from(tenantBillingOverrides)
      .where(
        and(
          eq(tenantBillingOverrides.tenantId, tenantId),
          lte(tenantBillingOverrides.startsAt, now),
          gt(tenantBillingOverrides.endsAt, now),
        ),
      )
      .orderBy(tenantBillingOverrides.endsAt);

    return {
      tenant,
      billing: billing ?? null,
      activeOverride: override ?? null,
    };
  }
}
