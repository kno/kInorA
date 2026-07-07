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
    findCurrent: vi.fn(),
    delete: deleteFn,
  } as unknown as Pick<PlanDraftRepository, "upsert" | "findCurrent" | "delete"> & {
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
