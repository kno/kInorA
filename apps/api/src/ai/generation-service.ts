import type { PlanGenerator } from "./port.js";
import type { WorkoutPlanRepository } from "../db/repositories/workout-plan.js";
import type { PlanSpecRepository } from "../db/repositories/plan-spec.js";
import { assertPlanSpecShape } from "../plan/boundary.js";
import { buildPlanPrompt } from "./prompt.js";
import {
  applyEquipmentSubstitutions,
  injectLimitationWarnings,
  assertNoDiagnosticLanguage,
} from "@kinora/domain";

/**
 * Generation service — orchestrates the async workout plan creation pipeline.
 *
 * Lifecycle:
 * 1. Load the confirmed PlanSpec via PlanSpecRepository.findConfirmedById.
 *    If missing or unconfirmed → throws a 422-class error BEFORE any LLM call.
 * 2. Validate the spec shape via assertPlanSpecShape (boundary guard).
 * 3. Create a "generating" row in WorkoutPlanRepository and return { planId, status }
 *    IMMEDIATELY to the caller — the LLM call is fire-and-forget.
 * 4. Background task (unhandled rejection is caught → markFailed):
 *    buildPlanPrompt → generator.generate → applyEquipmentSubstitutions
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
    >
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
   * @throws Error (422-class) when the spec is missing, unconfirmed, or fails shape validation
   */
  async startGeneration(
    tenantId: string,
    userId: string,
    planSpecId: string
  ): Promise<{ planId: string; status: "generating" }> {
    // Step 1: Load confirmed spec — throws if missing or unconfirmed
    const specRow = await this.specRepo.findConfirmedById(tenantId, planSpecId);
    if (!specRow) {
      throw new Error("PlanSpec not found or unconfirmed");
    }

    // Step 2: Validate spec shape — throws if structurally invalid (server bug defense)
    assertPlanSpecShape(specRow.specJson);
    const spec = specRow.specJson;

    // Step 3: Create the "generating" row and return planId immediately
    const { id: planId } = await this.planRepo.createGenerating(tenantId, userId, planSpecId);

    // Step 4: Fire-and-forget background task.
    // Promise rejection is caught inside the task — no unhandledRejection.
    void this.runGenerationTask(tenantId, planId, spec);

    return { planId, status: "generating" };
  }

  /**
   * Background generation pipeline. All errors are caught and routed to markFailed.
   * This method never rejects — unhandledRejection is impossible.
   */
  private async runGenerationTask(
    tenantId: string,
    planId: string,
    spec: import("@kinora/contracts").PlanSpec
  ): Promise<void> {
    try {
      // Build prompt → generate → post-process → guard → persist
      buildPlanPrompt(spec); // validate prompt builds cleanly (pure function, no-op result used by generator internally)
      const rawProgram = await this.generator.generate(spec);
      const substituted = applyEquipmentSubstitutions(rawProgram, spec.equipment);
      const withWarnings = injectLimitationWarnings(substituted, spec.limitations);
      assertNoDiagnosticLanguage(withWarnings);

      await this.planRepo.markReady(tenantId, planId, withWarnings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // markFailed errors are swallowed — the plan row is already persisted as "generating"
      // and the user can still trigger regenerate. Logging to stderr is acceptable.
      try {
        await this.planRepo.markFailed(tenantId, planId, message);
      } catch {
        // Intentionally swallowed — do not let markFailed failure propagate
      }
    }
  }
}
