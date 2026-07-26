import { and, eq, sql } from "drizzle-orm";
import { planDrafts } from "../schema.js";
import type { Database } from "../client.js";
import type { PlanSpec } from "@kinora/contracts";

/** A transaction executor compatible with Database — a subset of Database passed inside db.transaction(). */
type DbOrTx = Pick<Database, "delete">;

/**
 * A plan draft record as returned by persistence.
 */
export interface PlanDraftRecord {
  id: string;
  tenantId: string;
  userId: string;
  step: number;
  specJson: unknown;
  /**
   * Optimistic-concurrency version (#215). Bumped on every write; a guarded
   * commit applies only when the stored value still matches the value read at
   * the start of the read-modify-write cycle.
   */
  version: number;
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
        // Bump `version` on every replace so a concurrent version-guarded chat
        // commit (#215) observes this write and re-reads instead of clobbering.
        set: {
          step,
          specJson: spec,
          updatedAt: new Date(),
          version: sql`${planDrafts.version} + 1`,
        },
      })
      .returning();
    return rows[0] as PlanDraftRecord;
  }

  /**
   * Optimistic-concurrency commit for the shared chat draft (#215).
   *
   * Applies `step` + `spec` ONLY if the row's `version` still matches
   * `expectedVersion` (the value read at the start of the turn). Returns the
   * updated record on success, or `null` on a version conflict — a concurrent
   * turn wrote in between — so the caller can re-read, re-merge, and retry
   * rather than silently drop the other turn's fields.
   *
   * `expectedVersion === null` means "no draft existed when this turn started":
   * the commit INSERTs a fresh row. A concurrent insert (unique-index
   * violation) surfaces as a conflict (`null`) too, via `onConflictDoNothing`,
   * so the retry re-reads the now-existing row instead of throwing.
   */
  async commitWithVersion(
    tenantId: string,
    userId: string,
    step: number,
    spec: Partial<PlanSpec>,
    expectedVersion: number | null
  ): Promise<PlanDraftRecord | null> {
    if (expectedVersion === null) {
      const rows = await this.db
        .insert(planDrafts)
        .values({ tenantId, userId, step, specJson: spec })
        // A row already exists (another turn inserted first) → no-op, empty
        // returning → treat as a conflict so the caller re-reads and retries.
        .onConflictDoNothing({
          target: [planDrafts.tenantId, planDrafts.userId],
        })
        .returning();
      return (rows[0] as PlanDraftRecord | undefined) ?? null;
    }

    const rows = await this.db
      .update(planDrafts)
      .set({
        step,
        specJson: spec,
        updatedAt: new Date(),
        version: expectedVersion + 1,
      })
      .where(
        and(
          eq(planDrafts.tenantId, tenantId),
          eq(planDrafts.userId, userId),
          eq(planDrafts.version, expectedVersion)
        )
      )
      .returning();
    // Empty returning → the version moved under us (concurrent commit) → conflict.
    return (rows[0] as PlanDraftRecord | undefined) ?? null;
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
   * Accepts an optional transaction executor (tx) so callers can run this
   * inside a db.transaction() alongside other statements atomically.
   */
  async delete(tenantId: string, userId: string, tx?: DbOrTx): Promise<void> {
    const executor = tx ?? this.db;
    await executor
      .delete(planDrafts)
      .where(
        and(
          eq(planDrafts.tenantId, tenantId),
          eq(planDrafts.userId, userId)
        )
      );
  }
}
