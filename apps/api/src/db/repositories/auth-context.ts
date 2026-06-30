import { eq } from "drizzle-orm";
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
   * Find the first membership for a user (any status).
   * V1 assumes one tenant per user; future work should filter by status.
   */
  async findFirstByUserId(userId: string): Promise<MembershipRecord | null> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId));
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