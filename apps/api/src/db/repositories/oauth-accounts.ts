import { and, eq } from "drizzle-orm";
import { oauth_accounts } from "../schema.js";
import type { Database } from "../client.js";

/**
 * OAuth account record as read from persistence (the link between an external
 * OIDC provider identity and a kInorA user).
 */
export interface OauthAccountRecord {
  providerId: string;
  providerAccountId: string;
  email: string;
  userId: string | null;
  createdAt: Date;
}

/**
 * Data required to create a new oauth_account row.
 */
export interface NewOauthAccount {
  providerId: string;
  providerAccountId: string;
  email: string;
  userId: string;
}

/**
 * OAuth accounts persistence repository.
 *
 * Owns the `oauth_accounts` table CRUD. Race-safe linking relies on the unique
 * indexes defined on the table; duplicate inserts are rejected by the database.
 */
export class OauthAccountRepository {
  constructor(private db: Database) {}

  /**
   * Find an existing OAuth account by its (providerId, providerAccountId) pair.
   * The pair is unique-indexed, so at most one row is returned.
   */
  async findByProviderAccount(
    providerId: string,
    providerAccountId: string
  ): Promise<OauthAccountRecord | null> {
    const rows = await this.db
      .select()
      .from(oauth_accounts)
      .where(
        and(
          eq(oauth_accounts.providerId, providerId),
          eq(oauth_accounts.providerAccountId, providerAccountId)
        )
      );
    return (rows[0] as OauthAccountRecord | undefined) ?? null;
  }

  /**
   * Insert a new oauth_account row linking a provider identity to a user.
   * Duplicate inserts (same provider + account, or same provider + email) are
   * rejected by the unique indexes — callers should treat conflicts as
   * "already linked".
   */
  async create(data: NewOauthAccount): Promise<void> {
    await this.db.insert(oauth_accounts).values(data);
  }
}