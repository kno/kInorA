/**
 * Unit tests for createPlanRouteRepo — specifically the atomicity contract of
 * promoteDraftToSpec.
 *
 * The former inline object-literal adapter in buildApp had NO direct coverage;
 * its db.transaction closure (spec insert + draft delete) is the ONLY place the
 * two writes are observable together, so its atomicity is a security-critical
 * invariant. These tests fail if someone rewrites the adapter as two sequential
 * non-transactional awaits (no database.transaction), or fails to thread the
 * SAME tx into both writes, or lets a create result leak when the delete rejects.
 */
import { describe, it, expect, vi } from "vitest";
import { createPlanRouteRepo } from "../plan-route-repo.js";
import type { Database } from "../db/client.js";
import type { PlanSpecRepository } from "../db/repositories/plan-spec.js";
import type { PlanDraftRepository } from "../db/repositories/plan-draft.js";
import type { WorkoutPlanRepository } from "../db/repositories/workout-plan.js";
import type { PlanSpec } from "@kinora/contracts";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";

const spec = {
  goal: "strength",
  location: "gym",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  equipment: ["barbell"],
  limitations: [],
  preferenceScores: { strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
  confirmed: true,
} as unknown as PlanSpec;

const createdSpec = { id: "spec-uuid-1", spec };

/**
 * A sentinel tx executor. The mocked database.transaction passes THIS object as
 * `tx` into the closure; the create/delete spies then assert they received the
 * exact same reference — proving both writes are threaded through one tx.
 */
const TX = { __sentinel: "tx" } as const;

/** Mock database whose transaction() runs the closure with the sentinel TX. */
function buildTxDatabase(): {
  database: Pick<Database, "transaction">;
  transaction: ReturnType<typeof vi.fn>;
} {
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    // Faithfully model db.transaction: invoke the closure with a tx executor and
    // return its result. A rejection inside the closure propagates (rollback).
    return cb(TX);
  });
  return {
    database: { transaction } as unknown as Pick<Database, "transaction">,
    transaction,
  };
}

function buildSpecRepo(create = vi.fn().mockResolvedValue(createdSpec)) {
  return { create } as unknown as Pick<PlanSpecRepository, "create"> & {
    create: ReturnType<typeof vi.fn>;
  };
}

function buildDraftRepo(deleteFn = vi.fn().mockResolvedValue(undefined)) {
  return {
    upsert: vi.fn(),
    commitWithVersion: vi.fn(),
    findCurrent: vi.fn(),
    delete: deleteFn,
  } as unknown as Pick<
    PlanDraftRepository,
    "upsert" | "commitWithVersion" | "findCurrent" | "delete"
  > & {
    delete: ReturnType<typeof vi.fn>;
  };
}

const workoutPlanRepo = {
  findById: vi.fn(),
  findLatestByPlanSpec: vi.fn(),
  findAllByUser: vi.fn(),
} as unknown as Pick<
  WorkoutPlanRepository,
  "findById" | "findLatestByPlanSpec" | "findAllByUser"
>;

describe("createPlanRouteRepo.promoteDraftToSpec — atomicity", () => {
  it("wraps the two writes in exactly ONE database.transaction", async () => {
    const { database, transaction } = buildTxDatabase();
    const repo = createPlanRouteRepo({
      database,
      planSpecRepo: buildSpecRepo(),
      planDraftRepo: buildDraftRepo(),
      workoutPlanRepo,
    });

    await repo.promoteDraftToSpec(TENANT_A, USER_A, spec);

    // If someone rewrites the adapter as two sequential non-transactional awaits,
    // database.transaction is never called and this fails.
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("threads the SAME tx executor into BOTH create and delete", async () => {
    const { database } = buildTxDatabase();
    const specRepo = buildSpecRepo();
    const draftRepo = buildDraftRepo();
    const repo = createPlanRouteRepo({
      database,
      planSpecRepo: specRepo,
      planDraftRepo: draftRepo,
      workoutPlanRepo,
    });

    await repo.promoteDraftToSpec(TENANT_A, USER_A, spec);

    // create(tenantId, userId, spec, tx) — tx is the 4th arg.
    expect(specRepo.create).toHaveBeenCalledTimes(1);
    const createCall = specRepo.create.mock.calls[0];
    expect(createCall[0]).toBe(TENANT_A);
    expect(createCall[1]).toBe(USER_A);
    expect(createCall[2]).toBe(spec);
    const createTx = createCall[3];

    // delete(tenantId, userId, tx) — tx is the 3rd arg.
    expect(draftRepo.delete).toHaveBeenCalledTimes(1);
    const deleteCall = draftRepo.delete.mock.calls[0];
    expect(deleteCall[0]).toBe(TENANT_A);
    expect(deleteCall[1]).toBe(USER_A);
    const deleteTx = deleteCall[2];

    // The SAME executor object must reach both writes (the tx from transaction()).
    expect(createTx).toBe(TX);
    expect(deleteTx).toBe(TX);
    expect(createTx).toBe(deleteTx);
  });

  it("propagates the error and does NOT return create's result when delete rejects (rollback)", async () => {
    const { database, transaction } = buildTxDatabase();
    const specRepo = buildSpecRepo(vi.fn().mockResolvedValue(createdSpec));
    const deleteError = new Error("delete failed");
    const draftRepo = buildDraftRepo(vi.fn().mockRejectedValue(deleteError));
    const repo = createPlanRouteRepo({
      database,
      planSpecRepo: specRepo,
      planDraftRepo: draftRepo,
      workoutPlanRepo,
    });

    // The rejection must propagate to the caller (the transaction rolls back).
    await expect(
      repo.promoteDraftToSpec(TENANT_A, USER_A, spec)
    ).rejects.toBe(deleteError);

    // create ran inside the same transaction, but its result is NEVER surfaced —
    // the rejected delete aborts the closure before it can return the record.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(specRepo.create).toHaveBeenCalledTimes(1);
    expect(draftRepo.delete).toHaveBeenCalledTimes(1);
  });
});

describe("createPlanRouteRepo — plan name single-default layer (#93)", () => {
  const CREATED_AT = new Date("2026-06-29T10:00:00Z");

  function buildRepo(planRepoOverrides: Record<string, unknown>) {
    const { database } = buildTxDatabase();
    return createPlanRouteRepo({
      database,
      planSpecRepo: buildSpecRepo(),
      planDraftRepo: buildDraftRepo(),
      workoutPlanRepo: {
        findById: vi.fn(),
        findLatestByPlanSpec: vi.fn(),
        findAllByUser: vi.fn(),
        ...planRepoOverrides,
      } as unknown as Pick<
        WorkoutPlanRepository,
        "findById" | "findLatestByPlanSpec" | "findAllByUser"
      >,
    });
  }

  it("findPlanById passes a non-blank name through unchanged", async () => {
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue({
        id: "p1",
        status: "ready",
        planSpecId: "s1",
        name: "Summer Cut",
        programJson: null,
        createdAt: CREATED_AT,
      }),
    });

    const result = await repo.findPlanById(TENANT_A, USER_A, "p1");
    expect(result?.name).toBe("Summer Cut");
  });

  it("findPlanById resolves a null name to a non-empty default", async () => {
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue({
        id: "p1",
        status: "ready",
        planSpecId: "s1",
        name: null,
        programJson: null,
        createdAt: CREATED_AT,
      }),
    });

    const result = await repo.findPlanById(TENANT_A, USER_A, "p1");
    expect(result?.name).toBeTruthy();
    expect(result?.name).not.toBe("");
  });

  it("findPlanById returns undefined unchanged (no name resolution)", async () => {
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(undefined) });
    const result = await repo.findPlanById(TENANT_A, USER_A, "p1");
    expect(result).toBeUndefined();
  });

  it("findLatestPlanBySpec resolves a null name to a non-empty default", async () => {
    const repo = buildRepo({
      findLatestByPlanSpec: vi.fn().mockResolvedValue({
        id: "p1",
        status: "ready",
        planSpecId: "s1",
        name: null,
        programJson: null,
        createdAt: CREATED_AT,
      }),
    });

    const result = await repo.findLatestPlanBySpec(TENANT_A, USER_A, "s1");
    expect(result?.name).toBeTruthy();
  });

  it("findAllPlansByUser resolves each row's name (null → default, non-blank → passthrough)", async () => {
    const repo = buildRepo({
      findAllByUser: vi.fn().mockResolvedValue([
        { id: "p1", status: "ready", createdAt: CREATED_AT, name: "Summer Cut" },
        { id: "p2", status: "generating", createdAt: CREATED_AT, name: null },
      ]),
    });

    const result = await repo.findAllPlansByUser(TENANT_A, USER_A);
    expect(result[0].name).toBe("Summer Cut");
    expect(result[1].name).toBeTruthy();
    expect(result[1].name).not.toBe("");
  });
});

/**
 * Wiring coverage for the remaining adapter closures.
 *
 * Every method below is a one-line delegation, which is exactly why it needs a
 * test: nothing type-checks the *semantics* of `updateSpecDaysPerWeek: (…) =>
 * planSpecRepo.updateSpecIntensityBias(…)`. Both spec writers take the same
 * `(tenantId, userId, specId, number)` shape, so a crossed wire compiles
 * cleanly and silently writes the wrong field. The draft adapters likewise
 * *project* the repository row down to the route's contract — dropping or
 * renaming a projected key is invisible to the compiler at the call site.
 */
describe("createPlanRouteRepo — draft adapters", () => {
  const DRAFT_SPEC = { goal: "strength" } as Partial<PlanSpec>;

  function buildDraftAdapters(draftOverrides: Record<string, unknown>) {
    const { database } = buildTxDatabase();
    const planDraftRepo = {
      upsert: vi.fn(),
      commitWithVersion: vi.fn(),
      findCurrent: vi.fn(),
      delete: vi.fn(),
      ...draftOverrides,
    };
    const repo = createPlanRouteRepo({
      database,
      planSpecRepo: buildSpecRepo(),
      planDraftRepo: planDraftRepo as unknown as Pick<
        PlanDraftRepository,
        "upsert" | "commitWithVersion" | "findCurrent" | "delete"
      >,
      workoutPlanRepo,
    });
    return { repo, planDraftRepo };
  }

  it("upsertDraft forwards every argument and projects the row to step + specJson only", async () => {
    const { repo, planDraftRepo } = buildDraftAdapters({
      // The persisted row carries fields (version, updatedAt) the route contract
      // does NOT expose; the adapter must strip them rather than spread the row.
      upsert: vi.fn().mockResolvedValue({
        step: 2,
        specJson: DRAFT_SPEC,
        version: 7,
        updatedAt: new Date(),
      }),
    });

    const result = await repo.upsertDraft(TENANT_A, USER_A, 2, DRAFT_SPEC);

    expect(planDraftRepo.upsert).toHaveBeenCalledWith(TENANT_A, USER_A, 2, DRAFT_SPEC);
    expect(result).toEqual({ step: 2, specJson: DRAFT_SPEC });
  });

  it("commitDraft forwards expectedVersion and returns the versioned row on success", async () => {
    const { repo, planDraftRepo } = buildDraftAdapters({
      commitWithVersion: vi.fn().mockResolvedValue({
        step: 3,
        specJson: DRAFT_SPEC,
        version: 8,
      }),
    });

    const result = await repo.commitDraft(TENANT_A, USER_A, 3, DRAFT_SPEC, 7);

    // expectedVersion is the 5th argument; dropping it would silently turn the
    // version-guarded commit into a last-write-wins clobber (#215).
    expect(planDraftRepo.commitWithVersion).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      3,
      DRAFT_SPEC,
      7
    );
    expect(result).toEqual({ step: 3, specJson: DRAFT_SPEC, version: 8 });
  });

  it("commitDraft returns null on a version conflict so the route can retry", async () => {
    const { repo } = buildDraftAdapters({
      commitWithVersion: vi.fn().mockResolvedValue(null),
    });

    // Null must survive the adapter untouched — a `{step: undefined, …}` object
    // here would make the route's conflict branch unreachable.
    await expect(repo.commitDraft(TENANT_A, USER_A, 3, DRAFT_SPEC, 7)).resolves.toBeNull();
  });

  it("commitDraft treats a null expectedVersion (no prior draft) as an insert", async () => {
    const { repo, planDraftRepo } = buildDraftAdapters({
      commitWithVersion: vi.fn().mockResolvedValue({
        step: 1,
        specJson: DRAFT_SPEC,
        version: 1,
      }),
    });

    await repo.commitDraft(TENANT_A, USER_A, 1, DRAFT_SPEC, null);

    expect(planDraftRepo.commitWithVersion).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      1,
      DRAFT_SPEC,
      null
    );
  });

  it("findCurrentDraft projects the persisted row to step + specJson + version", async () => {
    const { repo, planDraftRepo } = buildDraftAdapters({
      findCurrent: vi.fn().mockResolvedValue({
        step: 4,
        specJson: DRAFT_SPEC,
        version: 9,
        tenantId: TENANT_A,
      }),
    });

    const result = await repo.findCurrentDraft(TENANT_A, USER_A);

    expect(planDraftRepo.findCurrent).toHaveBeenCalledWith(TENANT_A, USER_A);
    // `tenantId` must NOT leak into the route contract.
    expect(result).toEqual({ step: 4, specJson: DRAFT_SPEC, version: 9 });
  });

  it("findCurrentDraft returns null when no draft exists", async () => {
    const { repo } = buildDraftAdapters({ findCurrent: vi.fn().mockResolvedValue(null) });

    await expect(repo.findCurrentDraft(TENANT_A, USER_A)).resolves.toBeNull();
  });
});

describe("createPlanRouteRepo — list and spec-write adapters", () => {
  const CREATED_AT = new Date("2026-06-29T10:00:00Z");

  function buildAdapters(overrides: {
    planSpec?: Record<string, unknown>;
    workoutPlan?: Record<string, unknown>;
  }) {
    const { database } = buildTxDatabase();
    const planSpecRepo = {
      create: vi.fn(),
      updateSpecDaysPerWeek: vi.fn(),
      updateSpecIntensityBias: vi.fn(),
      ...overrides.planSpec,
    };
    const workoutPlanRepoLocal = {
      findById: vi.fn(),
      findLatestByPlanSpec: vi.fn(),
      findAllByUser: vi.fn(),
      listPlansWithProgress: vi.fn(),
      ...overrides.workoutPlan,
    };
    const repo = createPlanRouteRepo({
      database,
      planSpecRepo: planSpecRepo as unknown as Pick<
        PlanSpecRepository,
        "create" | "updateSpecDaysPerWeek" | "updateSpecIntensityBias"
      >,
      planDraftRepo: buildDraftRepo(),
      workoutPlanRepo: workoutPlanRepoLocal as unknown as Pick<
        WorkoutPlanRepository,
        "findById" | "findLatestByPlanSpec" | "findAllByUser" | "listPlansWithProgress"
      >,
    });
    return { repo, planSpecRepo, workoutPlanRepo: workoutPlanRepoLocal };
  }

  it("listPlansWithProgress resolves each row's name while preserving the progress fields", async () => {
    const { repo, workoutPlanRepo: planRepo } = buildAdapters({
      workoutPlan: {
        listPlansWithProgress: vi.fn().mockResolvedValue([
          {
            id: "p1",
            status: "ready",
            createdAt: CREATED_AT,
            name: "Summer Cut",
            daysPerWeek: 3,
            completedSessionCount: 4,
            lastTrainedAt: CREATED_AT,
          },
          {
            id: "p2",
            status: "ready",
            createdAt: CREATED_AT,
            name: null,
            daysPerWeek: 5,
            completedSessionCount: 0,
            lastTrainedAt: null,
          },
        ]),
      },
    });

    const result = await repo.listPlansWithProgress!(TENANT_A, USER_A);

    // 17d PR B added a third `PlanListOptions` parameter. The adapter forwards
    // whatever it is given, so calling without options forwards `undefined` —
    // safe, because the repository declares `options: PlanListOptions = {}`.
    expect(planRepo.listPlansWithProgress).toHaveBeenCalledWith(TENANT_A, USER_A, undefined);
    expect(result[0].name).toBe("Summer Cut");
    // The blank name is resolved by the SAME single default layer the detail and
    // list reads use, so every consumer renders one label.
    expect(result[1].name).toBeTruthy();
    expect(result[1].name).not.toBe("");
    // The progress columns must survive the name mapping untouched.
    expect(result[1].daysPerWeek).toBe(5);
    expect(result[0].completedSessionCount).toBe(4);
    expect(result[0].lastTrainedAt).toBe(CREATED_AT);
  });

  it("listPlansWithProgress forwards PlanListOptions, so the show-archived toggle reaches the query", async () => {
    // `includeArchived` is the whole mechanism behind "Show archived": the
    // repository appends `archived_at IS NULL` unless it is set. An adapter
    // that dropped this argument would silently hide archived plans from a
    // user who explicitly asked to see them, with nothing failing to type-check.
    const { repo, workoutPlanRepo: planRepo } = buildAdapters({
      workoutPlan: { listPlansWithProgress: vi.fn().mockResolvedValue([]) },
    });

    await repo.listPlansWithProgress!(TENANT_A, USER_A, { includeArchived: true });

    expect(planRepo.listPlansWithProgress).toHaveBeenCalledWith(TENANT_A, USER_A, {
      includeArchived: true,
    });
  });

  it("listPlansWithProgress returns an empty list unchanged", async () => {
    const { repo } = buildAdapters({
      workoutPlan: { listPlansWithProgress: vi.fn().mockResolvedValue([]) },
    });

    await expect(repo.listPlansWithProgress!(TENANT_A, USER_A)).resolves.toEqual([]);
  });

  it("updateSpecDaysPerWeek delegates to the days-per-week writer, never the intensity writer", async () => {
    const { repo, planSpecRepo } = buildAdapters({
      planSpec: { updateSpecDaysPerWeek: vi.fn().mockResolvedValue(undefined) },
    });

    await repo.updateSpecDaysPerWeek!(TENANT_A, USER_A, "spec-1", 3);

    expect(planSpecRepo.updateSpecDaysPerWeek).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      "spec-1",
      3
    );
    // Both writers share an identical signature, so a crossed wire type-checks.
    expect(planSpecRepo.updateSpecIntensityBias).not.toHaveBeenCalled();
  });

  it("updateSpecIntensityBias delegates to the intensity writer, never the days-per-week writer", async () => {
    const { repo, planSpecRepo } = buildAdapters({
      planSpec: { updateSpecIntensityBias: vi.fn().mockResolvedValue(undefined) },
    });

    await repo.updateSpecIntensityBias!(TENANT_A, USER_A, "spec-1", -0.1);

    expect(planSpecRepo.updateSpecIntensityBias).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      "spec-1",
      -0.1
    );
    expect(planSpecRepo.updateSpecDaysPerWeek).not.toHaveBeenCalled();
  });
});
