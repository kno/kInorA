import { eq } from "drizzle-orm";
import { users, memberships, tenants } from "../schema.js";
import type { Database } from "../client.js";

/**
 * Minimal user/membership/tenant lookup context for the social login flow.
 *
 * A dedicated repository keeps the social flow cohesive and avoids coupling to
 * PR2's auth-context repository shape (PR3 and PR2 land on independent
 * branches; the two can be unified in a follow-up refactor once both merge).
 */
export class SocialContextRepository {
  constructor(private db: Database) {}

  async findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
    const rows = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email));
    return (rows[0] as { id: string; email: string } | undefined) ?? null;
  }

  async findMembershipByUserId(
    userId: string
  ): Promise<{ tenantId: string } | null> {
    const rows = await this.db
      .select({ tenantId: memberships.tenantId })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    return (rows[0] as { tenantId: string } | undefined) ?? null;
  }

  async findTenantById(id: string): Promise<{ id: string; name: string } | null> {
    const rows = await this.db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, id));
    return (rows[0] as { id: string; name: string } | undefined) ?? null;
  }
}