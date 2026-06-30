import { eq } from "drizzle-orm";
import { aiProviderConfig } from "../schema.js";
import type { Database } from "../client.js";

/**
 * Active config record as returned by persistence.
 */
export interface AiProviderConfigRecord {
  provider: string;
  model: string;
  updatedAt: Date;
}

/**
 * Repository for the singleton ai_provider_config table.
 *
 * At most one row exists at all times. `upsert` implements this invariant:
 * it deletes any existing row then inserts the new one, ensuring no stale
 * rows accumulate (table has no unique anchor key for ON CONFLICT DO UPDATE,
 * so delete+insert is the simplest correct pattern).
 *
 * `getActive` returns null when no row exists — callers should fall back to
 * the OPENROUTER_API_KEY env var (retrocompatible behavior).
 */
export class AiProviderConfigRepository {
  constructor(private db: Database) {}

  /**
   * Return the active provider config, or null if no row exists.
   */
  async getActive(): Promise<AiProviderConfigRecord | null> {
    const rows = await this.db
      .select()
      .from(aiProviderConfig)
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      provider: row.provider as string,
      model: row.model,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Upsert the active config: delete existing row(s), then insert the new one.
   * Returns the persisted record.
   */
  async upsert(provider: string, model: string): Promise<AiProviderConfigRecord> {
    // Delete any existing rows (singleton invariant)
    await this.db.delete(aiProviderConfig).returning();

    const rows = await this.db
      .insert(aiProviderConfig)
      .values({ provider: provider as "openrouter" | "openai" | "anthropic" | "google" | "opencode-go", model })
      .returning();

    const row = rows[0] as { provider: string; model: string; updatedAt: Date };
    return {
      provider: row.provider,
      model: row.model,
      updatedAt: row.updatedAt,
    };
  }
}
