import { planSpecs } from "../schema.js";
import type { Database } from "../client.js";
import type { PlanSpec } from "@kinora/contracts";

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
   * Returns the persisted id and the confirmed PlanSpec.
   */
  async create(
    tenantId: string,
    userId: string,
    spec: PlanSpec
  ): Promise<{ id: string; spec: PlanSpec }> {
    const rows = await this.db
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
