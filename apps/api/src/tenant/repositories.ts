import { eq } from "drizzle-orm";
import { tenants, memberships } from "../db/schema.js";
import type { Database } from "../db/client.js";
import {
  type TenantQueryContext,
  assertTenantContext,
  assertTenantIdMatchesContext,
} from "./tenant-context.js";

/**
 * Tenant-scoped repository methods.
 *
 * Every method that queries tenant-owned data enforces TenantQueryContext
 * BEFORE reaching persistence. This is the core spec requirement:
 * "Every repository query for tenant-owned data MUST receive tenant context
 * explicitly and MUST fail before reaching persistence when tenant context is missing."
 *
 * Queries are scoped to `ctx.tenantId`. A valid context MUST NOT be used to
 * fetch a different tenant's data — `assertTenantIdMatchesContext` rejects
 * any id that does not match the context's tenant scope.
 */
export class TenantRepository {
  constructor(private db: Database) {}

  /**
   * Find the tenant identified by the given id. Requires valid tenant context
   * AND that the requested `id` matches `ctx.tenantId` — the query is tenant-
   * scoped, so cross-tenant access fails before persistence.
   */
  async findTenantById(
    ctx: TenantQueryContext | null | undefined,
    id: string
  ) {
    assertTenantIdMatchesContext(ctx, id);
    const rows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    return rows[0] ?? null;
  }

  /**
   * Find all memberships for the tenant in the given context.
   * Requires valid tenant context — enforced before persistence.
   */
  async findMembershipsByTenant(ctx: TenantQueryContext | null | undefined) {
    assertTenantContext(ctx);
    return this.db
      .select()
      .from(memberships)
      .where(eq(memberships.tenantId, ctx.tenantId));
  }
}