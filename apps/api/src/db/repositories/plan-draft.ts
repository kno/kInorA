import { and, eq } from "drizzle-orm";
import { planDrafts } from "../schema.js";
import type { Database } from "../client.js";
import type { PlanSpec } from "@kinora/contracts";

/**
 * A plan draft record as returned by persistence.
 */
export interface PlanDraftRecord {
  id: string;
  tenantId: string;
  userId: string;
  step: number;
  specJson: unknown;
  updatedAt: Date;
}

/**
 * Plan draft persistence repository.
 *
 * Enforces one active draft per (tenant_id, user_id) pair via the unique index.
 * The upsert method uses ON CONFLICT DO UPDATE to replace the existing draft
 * atomically, preserving the single-active invariant without a separate read.
 */
export class PlanDraftRepository {
  constructor(private db: Database) {}

  /**
   * Insert or replace the draft for a given tenant + user.
   * If a draft already exists for (tenantId, userId), it is updated in place.
   * Returns the persisted draft record.
   */
  async upsert(
    tenantId: string,
    userId: string,
    step: number,
    spec: Partial<PlanSpec>
  ): Promise<PlanDraftRecord> {
    const rows = await this.db
      .insert(planDrafts)
      .values({ tenantId, userId, step, specJson: spec })
      .onConflictDoUpdate({
        target: [planDrafts.tenantId, planDrafts.userId],
        set: { step, specJson: spec, updatedAt: new Date() },
      })
      .returning();
    return rows[0] as PlanDraftRecord;
  }

  /**
   * Return the current draft for a given tenant + user, or null if none exists.
   */
  async findCurrent(
    tenantId: string,
    userId: string
  ): Promise<PlanDraftRecord | null> {
    const rows = await this.db
      .select()
      .from(planDrafts)
      .where(
        and(
          eq(planDrafts.tenantId, tenantId),
          eq(planDrafts.userId, userId)
        )
      );
    return (rows[0] as PlanDraftRecord | undefined) ?? null;
  }

  /**
   * Delete the draft for a given tenant + user (called after promotion to plan_specs).
   */
  async delete(tenantId: string, userId: string): Promise<void> {
    await this.db
      .delete(planDrafts)
      .where(
        and(
          eq(planDrafts.tenantId, tenantId),
          eq(planDrafts.userId, userId)
        )
      );
  }
}
