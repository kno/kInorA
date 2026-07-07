import type { Database } from "./db/client.js";
import type { PlanSpecRepository } from "./db/repositories/plan-spec.js";
import type { PlanDraftRepository } from "./db/repositories/plan-draft.js";
import type { WorkoutPlanRepository } from "./db/repositories/workout-plan.js";
import type { PlanRouteRepo } from "./routes/plan.js";
import type { PlanSpec } from "@kinora/contracts";
import { defaultPlanName } from "@kinora/domain";

/**
 * Composition-root factory for the plan route port.
 *
 * Lives OUTSIDE `routes/` so it may import the DB layer (`./db/**`) freely; the
 * `routes-no-db-layer` boundary only targets `apps/api/src/routes/**`. Extracted
 * from the former inline `app.ts` object literal so the cross-repo atomic promote
 * (`promoteDraftToSpec`) is independently unit-testable — the atomicity guarantee
 * is a security-critical invariant that must have direct coverage.
 *
 * `promoteDraftToSpec` wraps `planSpecRepo.create(..., tx)` + `planDraftRepo.delete(..., tx)`
 * in a SINGLE `database.transaction`, threading the same `tx` executor into both
 * writes so they commit or roll back together. If either write rejects the whole
 * transaction rolls back and the error propagates to the caller.
 */
export function createPlanRouteRepo(deps: {
  database: Pick<Database, "transaction">;
  planSpecRepo: Pick<PlanSpecRepository, "create">;
  planDraftRepo: Pick<PlanDraftRepository, "upsert" | "findCurrent" | "delete">;
  workoutPlanRepo: Pick<
    WorkoutPlanRepository,
    "findById" | "findLatestByPlanSpec" | "findAllByUser"
  >;
}): PlanRouteRepo {
  const { database, planSpecRepo, planDraftRepo, workoutPlanRepo } = deps;
  return {
    upsertDraft: (tenantId, userId, step, spec) =>
      planDraftRepo
        .upsert(tenantId, userId, step, spec)
        .then((d) => ({ step: d.step, specJson: d.specJson })),
    findCurrentDraft: (tenantId, userId) =>
      planDraftRepo
        .findCurrent(tenantId, userId)
        .then((d) => (d ? { step: d.step, specJson: d.specJson } : null)),
    promoteDraftToSpec: (tenantId, userId, spec: PlanSpec) =>
      database.transaction(async (tx) => {
        // BOTH writes MUST receive the SAME tx executor so they are atomic. The
        // draft delete runs AFTER the spec insert; if the delete rejects the
        // transaction rolls back and create's result is NOT returned.
        const result = await planSpecRepo.create(tenantId, userId, spec, tx);
        await planDraftRepo.delete(tenantId, userId, tx);
        return result;
      }),
    // #93: the plan name blank→default rule is resolved HERE, in the single
    // composition-root adapter layer, so list, detail, selector, and header all
    // render the SAME label. defaultPlanName(row.name, row.createdAt) returns the
    // trimmed name or a date-based fallback; clients never branch on null.
    findPlanById: (tenantId, userId, id) =>
      workoutPlanRepo.findById(tenantId, userId, id).then((row) =>
        row
          ? { ...row, name: defaultPlanName(row.name, row.createdAt) }
          : row
      ),
    findLatestPlanBySpec: (tenantId, userId, specId) =>
      workoutPlanRepo.findLatestByPlanSpec(tenantId, userId, specId).then((row) =>
        row
          ? { ...row, name: defaultPlanName(row.name, row.createdAt) }
          : row
      ),
    findAllPlansByUser: (tenantId, userId) =>
      workoutPlanRepo.findAllByUser(tenantId, userId).then((rows) =>
        rows.map((row) => ({
          ...row,
          name: defaultPlanName(row.name, row.createdAt),
        }))
      ),
  };
}
