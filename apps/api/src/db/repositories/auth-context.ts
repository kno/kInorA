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
  role: "owner" | "member" | "trainer";
  status: "invited" | "active" | "suspended";
  createdAt: Date;
}

export class MembershipRepository {
  constructor(private db: Database) {}

  /**
   * Find the first membership for a user across ANY tenant (any status).
   *
   * NOT for authorization. A user can belong to multiple tenants with different
   * statuses, so a by-user-only lookup is nondeterministic and can return an
   * `active` row from a DIFFERENT tenant than the request. To authorize a request
   * already scoped to a tenant, use `findByTenantAndUser`. For the login flow's
   * active-membership check, use `findActiveByUserId`.
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

  /**
   * Find the first active membership for a user (any tenant).
   *
   * Only returns a membership with status === "active". Used by the login flow to
   * enforce a fail-secure membership check before issuing a session. Like
   * `findFirstByUserId` it is not tenant-scoped, so it must not be used to
   * authorize a request already bound to a specific tenant — use
   * `findByTenantAndUser` for that.
   */
  async findActiveByUserId(userId: string): Promise<MembershipRecord | null> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
    return (rows[0] as MembershipRecord | undefined) ?? null;
  }

  /**
   * Find EVERY active membership for a user, across all tenants
   * (15a-v2-trainer-account-access, Slice 3, task 3.7 — the minimal
   * active-tenant-selection enabler). Once a client accepts a trainer's
   * invite they have TWO active memberships (their personal tenant + the
   * trainer's tenant); this is the primitive a caller CAN use to choose among
   * them. Not wired into the default login path yet — the client-facing
   * tenant switch UI is deferred to a follow-up (S5 scope), see
   * `auth/tenant-selection.ts`.
   */
  async findActiveMemberships(userId: string): Promise<MembershipRecord[]> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
    return rows as MembershipRecord[];
  }

  /**
   * Create a new membership row (15a-v2-trainer-account-access, Slice 3 —
   * invite flow). Used when the invited email has no prior membership in the
   * trainer's tenant; a re-invite of a previously-revoked membership should
   * use `upsertInvited` instead, which resets the existing row in place.
   */
  async create(
    tenantId: string,
    userId: string,
    role: MembershipRecord["role"],
    status: MembershipRecord["status"],
  ): Promise<MembershipRecord> {
    const rows = await this.db
      .insert(memberships)
      .values({ tenantId, userId, role, status })
      .returning();
    return rows[0] as MembershipRecord;
  }

  /**
   * Insert a fresh `invited` membership, or reset an EXISTING (tenantId,
   * userId) row back to `invited` (e.g. re-inviting a client whose prior
   * membership was revoked). Matches the
   * `memberships_tenant_id_user_id_unique` index used by `findByTenantAndUser`.
   */
  async upsertInvited(
    tenantId: string,
    userId: string,
    role: MembershipRecord["role"],
  ): Promise<MembershipRecord> {
    const rows = await this.db
      .insert(memberships)
      .values({ tenantId, userId, role, status: "invited" })
      .onConflictDoUpdate({
        target: [memberships.tenantId, memberships.userId],
        set: { role, status: "invited" },
      })
      .returning();
    return rows[0] as MembershipRecord;
  }

  /**
   * Transition the membership status for a (tenantId, userId) pair — used by
   * the Slice 3 invite-accept flow to move `invited -> active`. Scoped to
   * BOTH tenantId and userId so an accept can never touch a different
   * tenant's membership row for the same user id. Returns the number of rows
   * updated (0 = no membership for this exact tenant/user pair).
   */
  async updateStatusByTenantAndUser(
    tenantId: string,
    userId: string,
    status: MembershipRecord["status"],
  ): Promise<number> {
    const rows = await this.db
      .update(memberships)
      .set({ status })
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
      .returning();
    return rows.length;
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