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
  planSpecRepo: Pick<
    PlanSpecRepository,
    | "create"
    | "updateSpecDaysPerWeek"
    | "updateSpecIntensityBias"
    | "findConfirmedById"
  >;
  planDraftRepo: Pick<
    PlanDraftRepository,
    "upsert" | "commitWithVersion" | "findCurrent" | "delete"
  >;
  workoutPlanRepo: Pick<
    WorkoutPlanRepository,
    | "findById"
    | "findLatestByPlanSpec"
    | "findAllByUser"
    | "listPlansWithProgress"
    | "setArchived"
    | "updateProgram"
  >;
}): PlanRouteRepo {
  const { database, planSpecRepo, planDraftRepo, workoutPlanRepo } = deps;
  return {
    upsertDraft: (tenantId, userId, step, spec) =>
      planDraftRepo
        .upsert(tenantId, userId, step, spec)
        .then((d) => ({ step: d.step, specJson: d.specJson })),
    // #215: version-guarded commit for the chat read-modify-write. Returns null
    // on a version conflict so the route can re-read + re-merge + retry once.
    commitDraft: (tenantId, userId, step, spec, expectedVersion) =>
      planDraftRepo
        .commitWithVersion(tenantId, userId, step, spec, expectedVersion)
        .then((d) =>
          d ? { step: d.step, specJson: d.specJson, version: d.version } : null,
        ),
    findCurrentDraft: (tenantId, userId) =>
      planDraftRepo
        .findCurrent(tenantId, userId)
        .then((d) =>
          d ? { step: d.step, specJson: d.specJson, version: d.version } : null,
        ),
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
    // 17d PR D: the program-edit write, wired straight through — the route
    // owns the ordering, the validation and the 404/409 disambiguation, so
    // there is nothing for this adapter to add beyond the delegation.
    // The same single default-name layer every other plan read goes through,
    // so the edit response labels the plan exactly as the list and detail do.
    updateProgram: (tenantId, userId, id, program, expectedUpdatedAt) =>
      workoutPlanRepo
        .updateProgram(tenantId, userId, id, program, expectedUpdatedAt)
        .then((row) =>
          row ? { ...row, name: defaultPlanName(row.name, row.createdAt) } : row
        ),
    // 17d PR D: the confirmed spec behind a plan, read ONLY for its equipment
    // list (the edit's catalog vocabulary). Reuses the exact same
    // `findConfirmedById` every other confirmed-spec read uses — including its
    // `confirmed: true` requirement and its tenant+user scoping.
    findConfirmedById: (tenantId, userId, id) =>
      planSpecRepo
        .findConfirmedById(tenantId, userId, id)
        .then((row) => (row ? { equipment: row.specJson?.equipment } : undefined)),
    // 17d PR B: the sole write path for archived_at, wired straight through.
    archivePlan: (tenantId, userId, id) => workoutPlanRepo.setArchived(tenantId, userId, id, true),
    unarchivePlan: (tenantId, userId, id) =>
      workoutPlanRepo.setArchived(tenantId, userId, id, false),
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
    // 17d PR A: the `/plans` list read, same single default-name layer as
    // findAllPlansByUser above — every list consumer renders the SAME label.
    listPlansWithProgress: (tenantId, userId, options) =>
      workoutPlanRepo.listPlansWithProgress(tenantId, userId, options).then((rows) =>
        rows.map((row) => ({
          ...row,
          name: defaultPlanName(row.name, row.createdAt),
        }))
      ),
    // 14a-v1.1 Slice B1 — the adherence-adaptation confirm write. Delegates
    // directly to the tenant/user-scoped in-place `spec_json.daysPerWeek` update.
    updateSpecDaysPerWeek: (tenantId, userId, specId, toDays) =>
      planSpecRepo.updateSpecDaysPerWeek(tenantId, userId, specId, toDays),
    // 14b-v1.1 — the RPE-adaptation confirm write (LOAD branch). Delegates
    // directly to the tenant/user-scoped in-place `spec_json.intensityBias` update.
    updateSpecIntensityBias: (tenantId, userId, specId, intensityBias) =>
      planSpecRepo.updateSpecIntensityBias(tenantId, userId, specId, intensityBias),
  };
}
