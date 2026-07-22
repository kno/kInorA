import type { PlanGenerator } from "./port.js";
import type { WorkoutPlanRepository } from "../db/repositories/workout-plan.js";
import type { PlanSpecRepository } from "../db/repositories/plan-spec.js";
import type { VectorMemoryRecord } from "../db/repositories/vector-memory.js";
import type { WsRegistry } from "../ws/registry.js";
import { mask } from "./mask.js";
import { assertPlanSpecShape } from "../plan/boundary.js";
import {
  applyEquipmentSubstitutions,
  injectLimitationWarnings,
  assertNoDiagnosticLanguage,
  normalizeProgramReps,
} from "@kinora/domain";

/**
 * 404-class error: spec not found or belongs to a different tenant.
 * Used by the route layer to respond 404 without conflating with shape errors.
 */
export class PlanSpecNotFoundError extends Error {
  statusCode = 404;
  constructor(planSpecId: string) {
    super(`PlanSpec not found or unconfirmed: ${planSpecId}`);
    this.name = "PlanSpecNotFoundError";
  }
}

/**
 * 422-class error: spec shape is invalid (boundary guard failure).
 * This indicates a server-side data integrity issue (spec was persisted without
 * passing assertPlanSpecShape), not a client error.
 */
export class PlanSpecShapeError extends Error {
  statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = "PlanSpecShapeError";
  }
}

/**
 * Generation service — orchestrates the async workout plan creation pipeline.
 *
 * Lifecycle:
 * 1. Load the confirmed PlanSpec via PlanSpecRepository.findConfirmedById.
 *    If missing or unconfirmed → throws PlanSpecNotFoundError (404-class).
 * 2. Validate the spec shape via assertPlanSpecShape (boundary guard).
 *    If invalid → throws PlanSpecShapeError (422-class).
 * 3. Create a "generating" row in WorkoutPlanRepository and return { planId, status }
 *    IMMEDIATELY to the caller — the LLM call is fire-and-forget.
 * 4. Background task (unhandled rejection is caught → markFailed):
 *    generator.generate → normalizeProgramReps → applyEquipmentSubstitutions
 *    → injectLimitationWarnings → assertNoDiagnosticLanguage → markReady.
 *    On ANY error → markFailed.
 *
 * Stuck-generating strategy: MANUAL REGENERATE ONLY.
 * Stale "generating" rows (e.g. from a server restart mid-generation) are NOT
 * auto-swept. They remain visible for audit. The user must explicitly trigger
 * regenerate (POST /plan-specs/:id/regenerate), which creates a fresh
 * "generating" row. The stale row is retained — only the latest row is shown
 * in the UI via findLatestByPlanSpec ordering by createdAt DESC.
 */
export class PlanGenerationService {
  constructor(
    private generator: PlanGenerator,
    private specRepo: Pick<PlanSpecRepository, "findConfirmedById">,
    private planRepo: Pick<
      WorkoutPlanRepository,
      "createGenerating" | "markReady" | "markFailed"
    >,
    /** Optional WsRegistry. When provided, notifies the user after markReady/markFailed. */
    private wsRegistry?: WsRegistry,
    private memoryRetriever?: {
      retrieve(
        scope: { tenantId: string; userId: string },
        options: { query: string; limit?: number },
      ): Promise<VectorMemoryRecord[]>;
    }
  ) {}

  /**
   * Start generation for a confirmed plan spec.
   *
   * Returns { planId, status: "generating" } immediately.
   * The LLM pipeline runs in the background — caller must not await it.
   *
   * @param tenantId  Tenant from authContext (never from request body)
   * @param userId    User from authContext (never from request body)
   * @param planSpecId ID of the confirmed plan spec to generate from
   *
   * @throws PlanSpecNotFoundError (404) when the spec is missing or unconfirmed
   * @throws PlanSpecShapeError (422) when the spec fails assertPlanSpecShape
   */
  async startGeneration(
    tenantId: string,
    userId: string,
    planSpecId: string
  ): Promise<{ planId: string; status: "generating" }> {
    // Step 1: Load confirmed spec — throws 404 if missing or unconfirmed
    const specRow = await this.specRepo.findConfirmedById(tenantId, userId, planSpecId);
    if (!specRow) {
      throw new PlanSpecNotFoundError(planSpecId);
    }

    // Step 2: Validate spec shape — throws 422 if structurally invalid
    try {
      assertPlanSpecShape(specRow.specJson);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PlanSpecShapeError(message);
    }
    const spec = specRow.specJson;

    // Step 3: Create the "generating" row and return planId immediately.
    // #93: thread the user-supplied plan name carried on the confirmed spec into
    // the row. A blank submission is already normalized to null on promote, so we
    // pass `spec.name ?? null` verbatim — the blank→default rule is applied only
    // on read via defaultPlanName, never here.
    const { id: planId } = await this.planRepo.createGenerating(
      tenantId,
      userId,
      planSpecId,
      spec.name ?? null
    );

    // Step 4: Fire-and-forget background task.
    // Promise rejection is caught inside the task — no unhandledRejection.
    void this.runGenerationTask(tenantId, userId, planId, spec);

    return { planId, status: "generating" };
  }

  /**
   * Background generation pipeline. All errors are caught and routed to markFailed.
   * This method never rejects — unhandledRejection is impossible.
   *
   * Notifies the user via WsRegistry after markReady / markFailed.
   * Payload is ONLY { planId, status } — NO program content, NO health data.
   * notify failure is swallowed (fire-and-forget-safe).
   *
   * Logs ONLY: planId, tenantId, planSpecId, error.name, error.message, error.stack.
   * NEVER logs: spec content, limitations, program content, exercise names, or any
   * health/plan data. This is a hard privacy invariant.
   */
  private async runGenerationTask(
    tenantId: string,
    userId: string,
    planId: string,
    spec: import("@kinora/contracts").PlanSpec
  ): Promise<void> {
    // Signal: task is starting (greppable prefix for log aggregators)
    console.info("[generation-service] generation started", { planId, tenantId });

    try {
      const generationInput = await this.attachMemoryContext(tenantId, userId, planId, spec);
      // generate → post-process → guard → persist
      const rawProgram = await this.generator.generate(generationInput);
      const normalized = normalizeProgramReps(rawProgram);
      const substituted = applyEquipmentSubstitutions(normalized, spec.equipment);
      const withWarnings = injectLimitationWarnings(substituted, spec.limitations);
      assertNoDiagnosticLanguage(withWarnings);

      const result = await this.planRepo.markReady(tenantId, planId, withWarnings);
      if (!result) {
        // markReady updated 0 rows (tenant mismatch or race — should not happen
        // normally, but log so stuck-generating is traceable).
        console.warn(
          `[generation-service] markReady returned undefined for planId=${planId} tenantId=${tenantId} — plan may be stuck in generating`
        );
        // Do NOT notify "ready" — the DB was not updated, so the plan is still
        // in "generating" state. Emitting a false-ready would contradict the DB.
        // The client stays in "generating" until the user triggers regenerate.
        return;
      }

      // Signal: generation pipeline completed successfully.
      // Log ONLY ids — never log the program or any health/plan content.
      console.info("[generation-service] generation ready", { planId, tenantId });

      // Notify the user via WebSocket — fire-and-forget-safe.
      // Payload: ONLY { planId, status } — no program content, no health data.
      try {
        this.wsRegistry?.notify(userId, { planId, status: "ready" });
      } catch {
        // Swallow notify failures — a broken WS must not abort the generation pipeline.
      }
    } catch (error) {
      // Log the failure BEFORE attempting markFailed so it is always visible even
      // if markFailed itself throws. Log ONLY ids + error metadata — NEVER log
      // spec content, limitations, program content, or any health/plan data.
      const name = error instanceof Error ? error.name : "UnknownError";
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error("[generation-service] generation failed", { planId, tenantId, name, message, stack });

      // markFailed errors are swallowed — the plan row is already persisted as "generating"
      // and the user can still trigger regenerate via POST /plan-specs/:id/regenerate.
      try {
        const result = await this.planRepo.markFailed(tenantId, planId, message);
        // Fix 8: warn if markFailed updated 0 rows — same stuck-generating concern.
        if (!result) {
          console.warn(
            `[generation-service] markFailed returned undefined for planId=${planId} tenantId=${tenantId} — plan may be stuck in generating`
          );
        }
      } catch {
        // Intentionally swallowed — do not let markFailed failure propagate
      }

      // Notify the user of failure — fire-and-forget-safe.
      try {
        this.wsRegistry?.notify(userId, { planId, status: "failed" });
      } catch {
        // Swallow notify failures — a broken WS must not abort error recovery.
      }
    }
  }

  private async attachMemoryContext(
    tenantId: string,
    userId: string,
    planId: string,
    spec: import("@kinora/contracts").PlanSpec
  ): Promise<import("@kinora/contracts").PlanSpec & { memoryContext?: string[] }> {
    if (!this.memoryRetriever) {
      return spec;
    }

    try {
      const memories = await this.memoryRetriever.retrieve(
        { tenantId, userId },
        {
          query: buildMemoryRetrievalQuery(spec),
          limit: 3,
        }
      );

      if (memories.length === 0) {
        return spec;
      }

      console.info("[generation-service] vector memory retrieved", {
        planId,
        tenantId,
        count: memories.length,
      });

      return {
        ...spec,
        memoryContext: memories.map((memory) => memory.summary),
      };
    } catch (error) {
      console.warn("[generation-service] vector memory retrieval failed", {
        planId,
        tenantId,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return spec;
    }
  }
}

function buildMemoryRetrievalQuery(spec: import("@kinora/contracts").PlanSpec): string {
  const limitationText = spec.limitations.map((item) => item.text);
  return mask([spec.goal, spec.location, ...spec.equipment, ...limitationText]
    .filter((value) => value.trim() !== "")
    .join(" "), limitationText);
}
