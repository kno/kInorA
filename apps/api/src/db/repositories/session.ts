import { eq } from "drizzle-orm";
import { sessions } from "../schema.js";
import type { Database } from "../client.js";

/**
 * Session identity record as read from persistence.
 */
export interface SessionRecord {
  tokenHash: string;
  userId: string;
  tenantId: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Data required to create a new session row.
 * `tokenHash` is the scrypt hash of the opaque bearer token, never the raw token.
 */
export interface NewSession {
  tokenHash: string;
  userId: string;
  tenantId: string;
  expiresAt: Date;
}

/**
 * Session persistence repository.
 *
 * The session table is keyed by `tokenHash` (the unique index), so the session
 * "id" used by repository operations is the token hash rather than a separate
 * numeric primary key. User + membership enrichment is added by the auth
 * plugin in a later change; this repository owns session-table CRUD only.
 */
export class SessionRepository {
  constructor(private db: Database) {}

  /**
   * Look up a session by its token hash.
   * Returns `null` when no matching session exists.
   */
  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash));
    return (rows[0] as SessionRecord | undefined) ?? null;
  }

  /**
   * Insert a new session row and return the persisted record.
   */
  async create(data: NewSession): Promise<SessionRecord> {
    const rows = await this.db.insert(sessions).values(data).returning();
    return rows[0] as SessionRecord;
  }

  /**
   * Delete the session identified by its token hash (logout).
   */
  async delete(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  /**
   * Delete every session for a user (revoke all sessions, e.g. on password change).
   */
  async deleteByUserId(userId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }
}