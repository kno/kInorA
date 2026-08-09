import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { planSpecs, workoutPlans, workoutSessions } from "../schema.js";
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
  /**
   * Raw user-supplied plan name (#93). Nullable: legacy rows and blank wizard
   * submissions are stored as NULL. The repo returns the raw column value; the
   * blank→default rule is applied once in the app.ts adapter via
   * `defaultPlanName(name, createdAt)` (single default layer).
   */
  name?: string | null;
  /**
   * 17d PR B. `null` when the plan is active. `undefined` on rows selected
   * before this column existed is never produced — every projection below
   * selects it explicitly once `includeArchived` is threaded through.
   */
  archivedAt?: Date | null;
}

/** Options accepted by `findAllByUser` and `listPlansWithProgress` (17d PR B). */
export interface PlanListOptions {
  /** Defaults to `false` — archived plans are hidden unless explicitly requested. */
  includeArchived?: boolean;
}

/**
 * `listPlansWithProgress`'s row shape (17d PR A) — `WorkoutPlanSummary` plus
 * the three progress fields the `/plans` list needs. `daysPerWeek` is
 * `undefined` — never 0 — when `plan_specs` has no usable number.
 * `completedSessions` is 0 for a plan never trained; `lastTrainedAt` is
 * `undefined` (not `null`) in that same case — there is no row to read a
 * date from.
 */
export interface WorkoutPlanProgressSummary extends WorkoutPlanSummary {
  daysPerWeek?: number;
  completedSessions: number;
  lastTrainedAt?: Date;
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
  /** Raw user-supplied plan name (#93). See WorkoutPlanSummary.name. */
  name: string | null;
  programJson: WorkoutProgram | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * #421: monotonic optimistic-concurrency token. Advances by exactly one on
   * every guarded `updateProgram`; see the column comment in `schema.ts` for
   * why this is not `updatedAt`.
   */
  version: number;
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
   *
   * `name` (#93) is the optional user-supplied plan name carried on the confirmed
   * PlanSpec (spec_json) and threaded here by the generation service. It is
   * written verbatim to `workout_plans.name`. A blank submission arrives as null
   * and is stored as null — the blank→default rule is applied ONLY on read via
   * `defaultPlanName`, never at write time, so the date-based default stays dynamic.
   */
  async createGenerating(
    tenantId: string,
    userId: string,
    planSpecId: string,
    name?: string | null
  ): Promise<{ id: string; status: "generating" }> {
    const rows = await this.db
      .insert(workoutPlans)
      .values({ tenantId, userId, planSpecId, status: "generating", name: name ?? null })
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
    userId: string,
    options: PlanListOptions = {}
  ): Promise<WorkoutPlanSummary[]> {
    const conditions = [eq(workoutPlans.tenantId, tenantId), eq(workoutPlans.userId, userId)];
    if (!options.includeArchived) {
      conditions.push(isNull(workoutPlans.archivedAt));
    }
    const rows = await this.db
      .select({
        id: workoutPlans.id,
        status: workoutPlans.status,
        createdAt: workoutPlans.createdAt,
        name: workoutPlans.name,
        archivedAt: workoutPlans.archivedAt,
      })
      .from(workoutPlans)
      .where(and(...conditions))
      .orderBy(desc(workoutPlans.createdAt));
    return rows as WorkoutPlanSummary[];
  }

  /**
   * `/plans` list read (17d PR A) — the plan summary plus days-per-week,
   * completed-session-count, and last-trained-date, produced in EXACTLY
   * three queries regardless of plan count (the anti-N+1 acceptance
   * criterion), mirroring `WorkoutSessionRepository.listSessionHistory`'s
   * batching shape.
   *
   * Q1: the same select/where/orderBy as `findAllByUser`, plus `planSpecId`.
   * Short-circuits with NO further query when `[]` — same guard
   * `listSessionHistory` uses.
   *
   * Q2: one batched `plan_specs` read keyed by the `planSpecId`s from Q1
   * (already tenant+user scoped, so this cannot reach another user's spec).
   * `daysPerWeek` is read in TS, not via a jsonb SQL operator, so a
   * malformed/legacy value degrades to "unknown" (`undefined`) instead of
   * `NaN` — `spec_json` is untyped `jsonb`.
   *
   * Q3: one `GROUP BY workout_plan_id` aggregate over `workout_sessions`,
   * gated on `status = 'completed'`. `COALESCE(completed_at, started_at)`
   * for `lastTrainedAt` matches `listSessionHistory`'s ordering expression,
   * so "last trained" and the history page cannot disagree about a date. A
   * plan with zero sessions is simply absent from this result — the merge
   * below defaults to `completedSessions: 0` and omits `lastTrainedAt`,
   * never a `null` masquerading as a date.
   *
   * 17d PR B: `includeArchived` defaults to `false`, hiding archived plans —
   * the SAME `archived_at IS NULL` condition `findAllByUser` appends.
   */
  async listPlansWithProgress(
    tenantId: string,
    userId: string,
    options: PlanListOptions = {}
  ): Promise<WorkoutPlanProgressSummary[]> {
    const conditions = [eq(workoutPlans.tenantId, tenantId), eq(workoutPlans.userId, userId)];
    if (!options.includeArchived) {
      conditions.push(isNull(workoutPlans.archivedAt));
    }
    const planRows = (await this.db
      .select({
        id: workoutPlans.id,
        status: workoutPlans.status,
        createdAt: workoutPlans.createdAt,
        name: workoutPlans.name,
        planSpecId: workoutPlans.planSpecId,
        archivedAt: workoutPlans.archivedAt,
      })
      .from(workoutPlans)
      .where(and(...conditions))
      .orderBy(desc(workoutPlans.createdAt))) as Array<{
      id: string;
      status: "generating" | "ready" | "failed";
      createdAt: Date;
      name: string | null;
      planSpecId: string;
      archivedAt: Date | null;
    }>;

    if (planRows.length === 0) {
      return [];
    }

    const specIds = [...new Set(planRows.map((row) => row.planSpecId))];
    const specRows = (await this.db
      .select({ id: planSpecs.id, specJson: planSpecs.specJson })
      .from(planSpecs)
      .where(inArray(planSpecs.id, specIds))) as Array<{ id: string; specJson: unknown }>;

    const daysPerWeekBySpec = new Map<string, number>();
    for (const specRow of specRows) {
      const raw = (specRow.specJson as { daysPerWeek?: unknown } | null)?.daysPerWeek;
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        daysPerWeekBySpec.set(specRow.id, raw);
      }
    }

    const planIds = planRows.map((row) => row.id);
    const progressRows = (await this.db
      .select({
        workoutPlanId: workoutSessions.workoutPlanId,
        completed: sql<number>`count(*) filter (where ${workoutSessions.status} = 'completed')`,
        lastTrained: sql<Date | null>`max(coalesce(${workoutSessions.completedAt}, ${workoutSessions.startedAt})) filter (where ${workoutSessions.status} = 'completed')`,
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          inArray(workoutSessions.workoutPlanId, planIds)
        )
      )
      .groupBy(workoutSessions.workoutPlanId)) as Array<{
      workoutPlanId: string;
      completed: number | string;
      lastTrained: Date | string | null;
    }>;

    const progressByPlan = new Map<string, { completed: number; lastTrained?: Date }>();
    for (const row of progressRows) {
      progressByPlan.set(row.workoutPlanId, {
        completed: Number(row.completed),
        lastTrained: row.lastTrained ? new Date(row.lastTrained) : undefined,
      });
    }

    return planRows.map((row) => {
      const progress = progressByPlan.get(row.id);
      const daysPerWeek = daysPerWeekBySpec.get(row.planSpecId);
      const lastTrainedAt = progress?.lastTrained;
      return {
        id: row.id,
        status: row.status,
        createdAt: row.createdAt,
        name: row.name,
        archivedAt: row.archivedAt,
        ...(daysPerWeek !== undefined ? { daysPerWeek } : {}),
        completedSessions: progress?.completed ?? 0,
        ...(lastTrainedAt !== undefined ? { lastTrainedAt } : {}),
      };
    });
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

  /**
   * Return the most recently created "ready" plan for a given tenant + owner
   * userId (15b-v2-trainer-dashboard-branding, Phase S2 — #283 client→
   * trainer-tenant read). Ordered by createdAt DESC so the latest ready plan
   * wins when multiple exist (one per confirm/regenerate call).
   *
   * Callers MUST supply `tenantId` from a resolved, deny-by-default source
   * (`resolveClientTrainerTenant` for the client-plan read; never a
   * caller-supplied tenant) and MUST supply `userId` as the resolved owner —
   * this method itself does not authorize anything, it is a plain
   * tenant+user-scoped read exactly like `findAllByUser`/`findById` above.
   * Both tenantId and userId are required in the WHERE clause: a
   * cross-tenant or same-tenant cross-user query always returns undefined,
   * and a "generating"/"failed" plan is never returned even if it is the
   * newest row for the owner.
   */
  async findLatestReadyByOwner(
    tenantId: string,
    userId: string
  ): Promise<WorkoutPlanRecord | undefined> {
    const rows = await this.db
      .select()
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId),
          eq(workoutPlans.status, "ready")
        )
      )
      .orderBy(desc(workoutPlans.createdAt))
      .limit(1);
    return rows[0] as WorkoutPlanRecord | undefined;
  }

  /**
   * Set or clear `archived_at` for one plan owned by the caller (17d PR B).
   *
   * Idempotent by construction: `archived_at` is written to `now()` only
   * when it is currently NULL (`COALESCE(archived_at, now())` on the archive
   * path), so a repeated archive cannot move the timestamp. Scoped by tenant
   * AND user; 0 rows updated resolves to `undefined` (the route maps this to
   * 404, indistinguishable from another user's plan — no IDOR leak).
   *
   * This is the ONLY write path for the column, and there is deliberately no
   * delete counterpart: `workout_sessions` cascades from a plan DELETE
   * (`schema.ts:708-710`), which would erase the training history archive
   * exists to preserve.
   */
  async setArchived(
    tenantId: string,
    userId: string,
    id: string,
    archived: boolean
  ): Promise<{ id: string; archivedAt: Date | null } | undefined> {
    const rows = await this.db
      .update(workoutPlans)
      .set({
        archivedAt: archived
          ? sql`coalesce(${workoutPlans.archivedAt}, now())`
          : null,
      })
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId),
          eq(workoutPlans.id, id)
        )
      )
      .returning({ id: workoutPlans.id, archivedAt: workoutPlans.archivedAt });
    return rows[0] as { id: string; archivedAt: Date | null } | undefined;
  }

  /**
   * 17d PR D: replace `program_json` for one plan owned by the caller.
   *
   * The SECOND write path for this column, and deliberately narrower than
   * `markReady`: scoped by tenant AND user (the id is client-supplied), guarded
   * on `status = 'ready'` so it can never race an in-flight generation's
   * `markReady`, and guarded on `expectedVersion` so it can never silently
   * overwrite a concurrent edit (Judgment Day finding 1) — the caller's version
   * of the row must still be current.
   *
   * This does NOT touch training history. `session_exercises` snapshots each
   * exercise at the moment a session starts, so an edit changes what the NEXT
   * session will be built from and nothing that already happened.
   *
   * Returns undefined on 0 rows updated. That is ambiguous between three
   * causes — not found, not ready, stale version — and this layer deliberately
   * does not disambiguate: the route re-reads the scoped row and maps it to
   * 404 / 409 `plan_not_ready` / 409 `edit_conflict`.
   *
   * ## Why the version token is an integer and not `updated_at` (#421)
   *
   * This guard was built on `updated_at` and broke twice, both times for the
   * same reason: a timestamp is a clock reading, so making it a version makes
   * CLOCK PRECISION a correctness property.
   *
   * 1. Postgres stores `timestamptz` to microseconds, while a JS `Date` and an
   *    ISO-8601 string carry milliseconds. The caller could never send back the
   *    exact stored value, so `updated_at = $expected` matched zero rows and
   *    every edit answered `409 edit_conflict` forever — a false negative.
   * 2. Comparing both sides truncated to milliseconds fixed that and opened the
   *    mirror defect: an update landing in the SAME millisecond as the token
   *    left `date_trunc('milliseconds', updated_at)` still equal to it, so a
   *    stale token matched and overwrote a fresh edit with no `409` and no
   *    error — a silent lost update, which is worse than no guard at all,
   *    because the UI promises protection it is not delivering.
   *
   * `version` has no such window. It is not derived from a clock: the update
   * sets it to `expectedVersion + 1` under a `version = expectedVersion`
   * predicate, so the row's token strictly advances on every successful write
   * and a replay of a consumed token matches zero rows NO MATTER how fast the
   * two writes arrive — even within the same microsecond, even if `updated_at`
   * were identical before and after. This is the pattern `plan_drafts.version`
   * / `commitWithVersion` already uses (#215).
   *
   * `updated_at` still moves on every edit, but it is now purely an audit
   * timestamp with no role in correctness. The `id` predicate keeps this a
   * primary key lookup.
   */
  async updateProgram(
    tenantId: string,
    userId: string,
    id: string,
    program: WorkoutProgram,
    expectedVersion: number
  ): Promise<WorkoutPlanRecord | undefined> {
    const rows = await this.db
      .update(workoutPlans)
      .set({
        programJson: program,
        updatedAt: new Date(),
        version: expectedVersion + 1,
      })
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId),
          eq(workoutPlans.id, id),
          eq(workoutPlans.status, "ready"),
          eq(workoutPlans.version, expectedVersion)
        )
      )
      .returning();
    return rows[0] as WorkoutPlanRecord | undefined;
  }
}
