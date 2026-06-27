import { planSpecs } from "../schema.js";
import type { Database } from "../client.js";
import type { PlanSpec } from "@kinora/contracts";

/** A transaction executor compatible with Database — a subset of Database passed inside db.transaction(). */
type DbOrTx = Pick<Database, "insert">;

/**
 * Plan spec persistence repository.
 *
 * A plan_specs row is the confirmed wizard output — the user's training requirements.
 * It is NOT a workout program. The actual workout program (exercises, sets, schedule)
 * is owned by change 08 (ai-plan-generation) and will live in a separate table.
 */
export class PlanSpecRepository {
  constructor(private db: Database) {}

  /**
   * Insert a confirmed plan_specs row for a given tenant + user.
   * Accepts an optional transaction executor (tx) so callers can run this
   * inside a db.transaction() alongside other statements atomically.
   * Returns the persisted id and the confirmed PlanSpec.
   */
  async create(
    tenantId: string,
    userId: string,
    spec: PlanSpec,
    tx?: DbOrTx
  ): Promise<{ id: string; spec: PlanSpec }> {
    const executor = tx ?? this.db;
    const rows = await executor
      .insert(planSpecs)
      .values({ tenantId, userId, specJson: spec, confirmed: true })
      .returning();
    const row = rows[0] as {
      id: string;
      tenantId: string;
      userId: string;
      specJson: unknown;
      confirmed: boolean;
      createdAt: Date;
    };
    return { id: row.id, spec: row.specJson as PlanSpec };
  }
}
