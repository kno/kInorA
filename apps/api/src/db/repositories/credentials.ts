import { eq } from "drizzle-orm";
import { credentials } from "../schema.js";
import type { Database } from "../client.js";

/**
 * Credential record as read from persistence.
 */
export interface CredentialRecord {
  userId: string;
  passwordHash: string;
  createdAt: Date;
}

/**
 * Data required to create a new credential row.
 */
export interface NewCredential {
  userId: string;
  passwordHash: string;
}

/**
 * Credentials persistence repository.
 * Stores password hashes for email/password auth users.
 */
export class CredentialsRepository {
  constructor(private db: Database) {}

  async findByUserId(userId: string): Promise<CredentialRecord | null> {
    const rows = await this.db
      .select()
      .from(credentials)
      .where(eq(credentials.userId, userId));
    return (rows[0] as CredentialRecord | undefined) ?? null;
  }

  async create(data: NewCredential): Promise<void> {
    await this.db.insert(credentials).values(data);
  }
}