import { and, eq } from "drizzle-orm";
import { users, memberships, tenants } from "../schema.js";
import type { Database } from "../client.js";

/**
 * User record as read from persistence.
 */
export interface UserRecord {
  id: string;
  email: string;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class UserRepository {
  constructor(private db: Database) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email));
    return (rows[0] as UserRecord | undefined) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id));
    return (rows[0] as UserRecord | undefined) ?? null;
  }
}

/**
 * Membership record as read from persistence.
 */
export interface MembershipRecord {
  id: string;
  tenantId: string;
  userId: string;
  role: "owner" | "member";
  status: "invited" | "active" | "suspended";
  createdAt: Date;
}

export class MembershipRepository {
  constructor(private db: Database) {}

  /**
   * Find the first membership for a user across ANY tenant (any status).
   *
   * Use ONLY where the tenant is not yet known — e.g. the login flow picking a
   * tenant to scope a fresh session. Do NOT use this to authorize a request that
   * is already scoped to a specific tenant: a user can belong to multiple tenants
   * with different statuses, so a by-user-only lookup is nondeterministic and can
   * return an `active` row from a DIFFERENT tenant than the request. For that case
   * use `findByTenantAndUser`.
   */
  async findFirstByUserId(userId: string): Promise<MembershipRecord | null> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId));
    return (rows[0] as MembershipRecord | undefined) ?? null;
  }

  /**
   * Find the membership for a specific (tenantId, userId) pair.
   *
   * Matches the `memberships_tenant_id_user_id_unique` index, so this resolves to
   * at most one row deterministically. This is the correct lookup for authorizing
   * a request that is already scoped to a tenant (e.g. the auth plugin re-checking
   * that the session's tenant membership is still `active`): it validates the
   * membership FOR THE TENANT THE SESSION IS SCOPED TO, never leaking status from
   * another tenant the user also belongs to.
   */
  async findByTenantAndUser(
    tenantId: string,
    userId: string
  ): Promise<MembershipRecord | null> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.userId, userId)
        )
      );
    return (rows[0] as MembershipRecord | undefined) ?? null;
  }
}

/**
 * Tenant record as read from persistence.
 */
export interface TenantRecord {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export class TenantLookupRepository {
  constructor(private db: Database) {}

  async findById(id: string): Promise<TenantRecord | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.id, id));
    return (rows[0] as TenantRecord | undefined) ?? null;
  }
}