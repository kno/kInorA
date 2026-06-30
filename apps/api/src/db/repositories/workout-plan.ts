import { and, desc, eq } from "drizzle-orm";
import { workoutPlans } from "../schema.js";
import type { Database } from "../client.js";
import type { WorkoutProgram } from "@kinora/contracts";

/**
 * Lightweight summary returned by findAllByUser.
 * Contains only the fields needed for the plan selector UI.
 */
export interface WorkoutPlanSummary {
  id: string;
  status: "generating" | "ready" | "failed";
  createdAt: Date;
}

/**
 * A workout plan record as returned by persistence.
 */
export interface WorkoutPlanRecord {
  id: string;
  tenantId: string;
  userId: string;
  planSpecId: string;
  status: "generating" | "ready" | "failed";
  programJson: WorkoutProgram | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Workout plan persistence repository.
 *
 * All read methods are tenant + user scoped: both tenantId and userId are always
 * included in SELECT WHERE clauses. Cross-tenant reads return undefined; same-tenant
 * cross-user reads also return undefined — both must match for the query to return rows.
 * Write methods (markReady, markFailed) use tenant-only scope by design (generation
 * service owns the write path and already holds the tenantId+planId binding).
 *
 * Stuck-generating strategy: manual regenerate only. Stale "generating" rows
 * remain visible for audit; a new row is created on each regenerate call.
 */
export class WorkoutPlanRepository {
  constructor(private db: Database) {}

  /**
   * Create a new plan row in the "generating" state.
   * Called immediately when a confirm/regenerate request is received, before
   * the background LLM generation task starts.
   * Returns the persisted { id, status }.
   */
  async createGenerating(
    tenantId: string,
    userId: string,
    planSpecId: string
  ): Promise<{ id: string; status: "generating" }> {
    const rows = await this.db
      .insert(workoutPlans)
      .values({ tenantId, userId, planSpecId, status: "generating" })
      .returning();
    const row = rows[0] as WorkoutPlanRecord;
    return { id: row.id, status: "generating" };
  }

  /**
   * Transition a plan to "ready" and persist the generated program JSON.
   * Called by the generation service after a successful LLM response that
   * has passed all post-processing guards.
   *
   * tenantId is REQUIRED in the WHERE clause to prevent cross-tenant writes:
   * a caller with a planId from another tenant must not be able to flip its status.
   * Returns undefined when 0 rows are updated (plan not found or tenant mismatch).
   */
  async markReady(
    tenantId: string,
    id: string,
    program: WorkoutProgram
  ): Promise<WorkoutPlanRecord | undefined> {
    const rows = await this.db
      .update(workoutPlans)
      .set({ status: "ready", programJson: program, updatedAt: new Date() })
      .where(and(eq(workoutPlans.tenantId, tenantId), eq(workoutPlans.id, id)))
      .returning();
    return rows[0] as WorkoutPlanRecord | undefined;
  }

  /**
   * Transition a plan to "failed" and persist the error message.
   * Called by the generation service on any unrecoverable error during
   * generation (LLM error, schema validation failure, diagnostic guard rejection).
   * The failed row is retained for audit; the user can trigger regenerate.
   *
   * tenantId is REQUIRED in the WHERE clause to prevent cross-tenant writes.
   * Returns undefined when 0 rows are updated (plan not found or tenant mismatch).
   */
  async markFailed(
    tenantId: string,
    id: string,
    errorMessage: string
  ): Promise<WorkoutPlanRecord | undefined> {
    const rows = await this.db
      .update(workoutPlans)
      .set({ status: "failed", errorMessage, updatedAt: new Date() })
      .where(and(eq(workoutPlans.tenantId, tenantId), eq(workoutPlans.id, id)))
      .returning();
    return rows[0] as WorkoutPlanRecord | undefined;
  }

  /**
   * Return the most recently created plan for a given tenant + user + planSpecId.
   * Ordered by createdAt DESC so the newest generation attempt is always first.
   * Multiple rows may exist (one per regenerate call); only the latest is returned.
   * Returns undefined when no plan exists for this tenant+user+spec combination.
   * Both tenantId and userId are required — same-tenant cross-user reads return undefined.
   */
  async findLatestByPlanSpec(
    tenantId: string,
    userId: string,
    planSpecId: string
  ): Promise<WorkoutPlanRecord | undefined> {
    const rows = await this.db
      .select()
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId),
          eq(workoutPlans.planSpecId, planSpecId)
        )
      )
      .orderBy(desc(workoutPlans.createdAt))
      .limit(1);
    return rows[0] as WorkoutPlanRecord | undefined;
  }

  /**
   * Return all plans for a given tenant + user, ordered newest-first (createdAt DESC).
   * Each row is mapped to a lightweight WorkoutPlanSummary { id, status, createdAt }.
   * Returns an empty array when no plans exist.
   * Both tenantId and userId are required in the WHERE clause for full isolation.
   */
  async findAllByUser(
    tenantId: string,
    userId: string
  ): Promise<WorkoutPlanSummary[]> {
    const rows = await this.db
      .select({
        id: workoutPlans.id,
        status: workoutPlans.status,
        createdAt: workoutPlans.createdAt,
      })
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId)
        )
      )
      .orderBy(desc(workoutPlans.createdAt));
    return rows as WorkoutPlanSummary[];
  }

  /**
   * Return a single plan by id, scoped to the requesting tenant AND user.
   * Returns undefined when the plan does not exist, belongs to a different tenant,
   * or belongs to a different user within the same tenant.
   * All three of tenant + user + id must match — cross-tenant and same-tenant
   * cross-user reads always return undefined.
   */
  async findById(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<WorkoutPlanRecord | undefined> {
    const rows = await this.db
      .select()
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId),
          eq(workoutPlans.id, id)
        )
      );
    return rows[0] as WorkoutPlanRecord | undefined;
  }
}
