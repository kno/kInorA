import type { Database } from "../db/client.js";
import { tenants, users, memberships } from "../db/schema.js";

/**
 * Input for the tenant provisioning primitive.
 * This is the lower-level function that `05a-v1-auth-core` will call
 * from Auth.js sign-up flows. It does NOT handle sessions or passwords.
 */
export interface ProvisionTenantInput {
  tenantName: string;
  userEmail: string;
}

/**
 * Result of tenant provisioning — stable IDs only, no auth session data.
 * Auth integration is explicitly deferred to `05a-v1-auth-core`.
 */
export interface ProvisionTenantResult {
  tenantId: string;
  userId: string;
  membershipId: string;
}

/**
 * Provision a new tenant, user, and owner membership in a single transaction.
 *
 * This is the lower-level tenant provisioning primitive required by the spec:
 * - Creates a tenant record
 * - Creates a user record
 * - Creates an owner membership linking them
 * - Returns stable IDs for downstream use
 *
 * Full Auth.js registration and session creation are out of scope (05a).
 */
export async function provisionTenantForUser(
  db: Database,
  input: ProvisionTenantInput
): Promise<ProvisionTenantResult> {
  return db.transaction(async (tx) => {
    // Create tenant
    const tenantRows = await tx
      .insert(tenants)
      .values({ name: input.tenantName })
      .returning({ id: tenants.id });

    const tenantRow = tenantRows[0];
    if (!tenantRow) {
      throw new Error("Failed to create tenant: no rows returned");
    }

    // Create user
    const userRows = await tx
      .insert(users)
      .values({ email: input.userEmail })
      .returning({ id: users.id });

    const userRow = userRows[0];
    if (!userRow) {
      throw new Error("Failed to create user: no rows returned");
    }

    // Create membership (owner role, active status)
    const membershipRows = await tx
      .insert(memberships)
      .values({
        tenantId: tenantRow.id,
        userId: userRow.id,
        role: "owner",
        status: "active",
      })
      .returning({ id: memberships.id });

    const membershipRow = membershipRows[0];
    if (!membershipRow) {
      throw new Error("Failed to create membership: no rows returned");
    }

    return {
      tenantId: tenantRow.id,
      userId: userRow.id,
      membershipId: membershipRow.id,
    };
  });
}