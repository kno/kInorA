/**
 * Tenant query context — the repository contract.
 *
 * Every repository method for tenant-owned data MUST receive a TenantQueryContext
 * and validate it before executing any persistence operation.
 * This guarantees unscoped queries never reach the database.
 */

export interface TenantQueryContext {
  tenantId: string;
  actorUserId?: string;
}

/**
 * Asserts that the given context has a valid, non-empty tenantId.
 * Throws before reaching persistence if tenant context is absent.
 *
 * Spec requirement: "Every repository query for tenant-owned data MUST receive
 * tenant context explicitly and MUST fail before reaching persistence when
 * tenant context is missing."
 */
export function assertTenantContext(
  ctx: TenantQueryContext | null | undefined
): asserts ctx is TenantQueryContext {
  if (ctx == null) {
    throw new Error("Tenant context is required: context was null or undefined");
  }

  if (!ctx.tenantId || ctx.tenantId.trim() === "") {
    throw new Error(
      "Tenant context is required: tenantId must be a non-empty string"
    );
  }
}

/**
 * Asserts that the requested tenant `id` matches the tenant scope in `ctx`.
 *
 * This is the runtime tenant-scoping contract for repository queries that take
 * a tenant id parameter: a valid `ctx.tenantId` MUST NOT be used to fetch a
 * different tenant's data. The check runs BEFORE reaching persistence so an
 * unscoped or cross-tenant query can never reach the database.
 *
 * Spec requirement: "Query with tenant context proceeds — the repository may
 * execute the tenant-scoped persistence operation" (i.e. scoped to
 * `ctx.tenantId`, not an arbitrary id).
 */
export function assertTenantIdMatchesContext(
  ctx: TenantQueryContext | null | undefined,
  id: string | null | undefined
): asserts ctx is TenantQueryContext {
  assertTenantContext(ctx);

  if (id !== ctx.tenantId) {
    const requested =
      id == null || id.trim() === "" ? "(missing or empty id)" : id;
    throw new Error(
      `Tenant context scope mismatch: ctx.tenantId=${ctx.tenantId} but requested id=${requested}`
    );
  }
}