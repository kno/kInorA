import type { Database } from "../db/client.js";
import { tenants, users, memberships, oauth_accounts, tenantBillingStates, userProfiles } from "../db/schema.js";
import { buildTrialBillingState } from "../db/repositories/billing-backfill.js";

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
 * Derive a default profile `name` from the email local part (10a-user-memory-structured
 * Slice 3). Mirrors {@link defaultNameFromEmail} in the user-profile route: the
 * registered user always lands with a profile row whose name matches what GET
 * /user-profile's lazy-provision path would have derived — so there is exactly one
 * "default name" rule across registration and first-read. Falls back to "user" when
 * the email has no local part.
 */
function defaultProfileNameFromEmail(email: string): string {
  const localPart = email.split("@")[0];
  return localPart && localPart.trim() !== "" ? localPart : "user";
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

    await tx.insert(tenantBillingStates).values(buildTrialBillingState(tenantRow.id, new Date()));

    // 10a-user-memory-structured Slice 3 — auto-provision a default
    // user_profiles row in the SAME transaction. name = email local part
    // (defaultProfileNameFromEmail); goal/experienceLevel are nullable and left
    // null so the user can set them later via PUT /user-profile. This makes the
    // lazy-provision branch in GET /user-profile a no-op for registered users:
    // the row already exists, so the first read returns the pre-provisioned
    // state without a second insert. Upsert semantics on userProfiles are not
    // needed here because provisionTenantForUser creates a brand-new user
    // (users_email_unique), so userId is fresh and cannot collide.
    await tx.insert(userProfiles).values({
      userId: userRow.id,
      name: defaultProfileNameFromEmail(input.userEmail),
      goal: null,
      experienceLevel: null,
    });

    return {
      tenantId: tenantRow.id,
      userId: userRow.id,
      membershipId: membershipRow.id,
    };
  });
}

/**
 * Link an existing user to an OAuth account.
 *
 * Unlike {@link provisionTenantForUser}, this does NOT create a user or
 * tenant — it only inserts an `oauth_accounts` row bound to an existing user.
 * Race-safety on concurrent callbacks relies on the
 * `(provider_id, provider_account_id)` and `(provider_id, email)` unique indexes;
 * a duplicate insert is rejected by the database and the caller treats it as
 * "already linked".
 *
 * @param db Database handle.
 * @param userId Existing user id to link the OAuth account to.
 * @param providerId OIDC provider id (e.g. `"google"`).
 * @param providerAccountId Provider-scoped account id (`sub` claim).
 * @param email The verified email returned by the provider.
 */
export async function linkOauthToExistingUser(
  db: Database,
  userId: string,
  providerId: string,
  providerAccountId: string,
  email: string
): Promise<void> {
  await db.insert(oauth_accounts).values({
    providerId,
    providerAccountId,
    email,
    userId,
  });
}
