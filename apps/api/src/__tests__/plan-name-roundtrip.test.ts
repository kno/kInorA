/**
 * Plan name persistence round-trip (#93).
 *
 * This is the test that would have caught the Slice 2 gap: the wizard captured
 * a plan name and the read path resolved/displayed it, but the captured name was
 * NEVER written to `workout_plans.name` — `createGenerating` inserted the row
 * with no `name`, so a user-entered name was silently dropped and the UI always
 * fell back to the date-based default.
 *
 * It exercises the REAL write and read code paths against a shared in-memory
 * `workout_plans` store:
 *   1. WorkoutPlanRepository.createGenerating(..., name) INSERTs the row.
 *   2. createPlanRouteRepo (the composition-root adapter) reads it back via
 *      findPlanById / findAllPlansByUser and applies defaultPlanName ONCE on read.
 *
 * Proves the full round-trip:
 *   - a user-entered name is persisted and surfaces as that EXACT name; and
 *   - a blank name is persisted as null and surfaces as the defaultPlanName default.
 */
import { describe, it, expect } from "vitest";
import { WorkoutPlanRepository } from "../db/repositories/workout-plan.js";
import { createPlanRouteRepo } from "../plan-route-repo.js";
import { defaultPlanName } from "@kinora/domain";
import type { Database } from "../db/client.js";
import type { PlanSpecRepository } from "../db/repositories/plan-spec.js";
import type { PlanDraftRepository } from "../db/repositories/plan-draft.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const SPEC_A = "aaaaaaaa-0000-0000-0000-000000000003";
const CREATED_AT = new Date("2026-06-29T10:00:00Z");

/** A persisted workout_plans row as the in-memory store holds it. */
interface StoredPlan {
  id: string;
  tenantId: string;
  userId: string;
  planSpecId: string;
  status: "generating" | "ready" | "failed";
  name: string | null;
  programJson: unknown;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A tiny in-memory Database double backing only the workout_plans table.
 * It faithfully models the two chains the repo uses:
 *   - insert().values(v).returning()  → append a row (with a fixed createdAt so
 *                                        the default label is deterministic)
 *   - select(proj?).from().where().orderBy()[.limit()] → scan the store
 * The store is closed over so a write in step 1 is visible to the read in step 2
 * (the whole point of a round-trip).
 */
function buildInMemoryDb(store: StoredPlan[]): Database {
  let seq = 0;

  const insert = () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        const row: StoredPlan = {
          id: `plan-${++seq}`,
          tenantId: v.tenantId as string,
          userId: v.userId as string,
          planSpecId: v.planSpecId as string,
          status: v.status as StoredPlan["status"],
          // The column key the write MUST populate. If createGenerating stops
          // threading name, this is null and the round-trip assertion fails.
          name: (v.name as string | null | undefined) ?? null,
          programJson: null,
          errorMessage: null,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        };
        store.push(row);
        return [row];
      },
    }),
  });

  // The select chain ignores the (drizzle) predicate objects and applies the
  // real scoping in JS via the closure below, keyed off the most recent query's
  // intent. We differentiate the three read shapes the adapter needs:
  //   - findById:            select() → from().where()                     (thenable)
  //   - findLatestByPlanSpec: select() → from().where().orderBy().limit(1)
  //   - findAllByUser:        select({proj}) → from().where().orderBy()
  // Scoping (tenant+user) is modeled directly.
  const scan = (predicate: (r: StoredPlan) => boolean) =>
    store.filter(predicate);

  const select = (projection?: Record<string, unknown>) => {
    // findAllByUser passes an explicit projection object; findById/findLatest
    // call select() with no args (SELECT *). We use this to pick the scope shape.
    const isSummaryProjection = projection !== undefined;
    return {
      from: () => ({
        where: (...whereArgs: unknown[]) => {
          void whereArgs;
          // For the round-trip we only ever hold rows for TENANT_A/USER_A, so a
          // tenant+user scan is exact (the repo's real WHERE narrows further).
          const scoped = scan(
            (r) => r.tenantId === TENANT_A && r.userId === USER_A
          );
          const newestFirst = () =>
            scoped
              .slice()
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          if (!isSummaryProjection) {
            // SELECT * path shared by findById and findLatestByPlanSpec.
            // findById terminates at .where() → the result must be awaitable and
            // yield the matching rows (repo maps rows[0]). findLatestByPlanSpec
            // continues .orderBy(desc(createdAt)).limit(1). We return a thenable
            // that ALSO exposes .orderBy().limit() so BOTH paths work.
            const thenable = {
              then: (
                resolve: (rows: StoredPlan[]) => unknown,
                reject?: (e: unknown) => unknown
              ) => Promise.resolve(scoped).then(resolve, reject),
              orderBy: () => ({
                limit: async (n: number) => newestFirst().slice(0, n),
              }),
            };
            return thenable;
          }
          // Summary projection path continues to orderBy (findAllByUser).
          return {
            orderBy: async () =>
              newestFirst().map((r) => ({
                id: r.id,
                status: r.status,
                createdAt: r.createdAt,
                name: r.name,
              })),
          };
        },
      }),
    };
  };

  return { insert, select } as unknown as Database;
}

/** Stubs for the promote-only collaborators the adapter also depends on. */
const planSpecRepoStub = {
  create: () => Promise.reject(new Error("not used in round-trip")),
} as unknown as Pick<PlanSpecRepository, "create">;

const planDraftRepoStub = {
  upsert: () => Promise.reject(new Error("not used")),
  findCurrent: () => Promise.reject(new Error("not used")),
  delete: () => Promise.reject(new Error("not used")),
} as unknown as Pick<PlanDraftRepository, "upsert" | "findCurrent" | "delete">;

function buildStack() {
  const store: StoredPlan[] = [];
  const db = buildInMemoryDb(store);
  const workoutPlanRepo = new WorkoutPlanRepository(db);
  const adapter = createPlanRouteRepo({
    database: db as unknown as Pick<Database, "transaction">,
    planSpecRepo: planSpecRepoStub,
    planDraftRepo: planDraftRepoStub,
    workoutPlanRepo,
  });
  return { store, workoutPlanRepo, adapter };
}

describe("plan name persistence round-trip (#93)", () => {
  it("a user-entered name is persisted and surfaces (list + detail) as that EXACT name", async () => {
    const { workoutPlanRepo, adapter } = buildStack();

    // WRITE: the generation service threads the confirmed spec's name here.
    const { id } = await workoutPlanRepo.createGenerating(
      TENANT_A,
      USER_A,
      SPEC_A,
      "Summer Cut"
    );

    // READ (detail): the adapter resolves defaultPlanName; a non-blank name
    // passes through unchanged.
    const detail = await adapter.findPlanById(TENANT_A, USER_A, id);
    expect(detail?.name).toBe("Summer Cut");

    // READ (list): the projection carries the same persisted name.
    const list = await adapter.findAllPlansByUser(TENANT_A, USER_A);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Summer Cut");
  });

  it("a blank name is persisted as null and surfaces as the defaultPlanName default", async () => {
    const { store, workoutPlanRepo, adapter } = buildStack();

    // WRITE: a blank submission arrives as null (normalized on promote). We pass
    // null explicitly — createGenerating must store null, NOT a write-time default.
    const { id } = await workoutPlanRepo.createGenerating(TENANT_A, USER_A, SPEC_A, null);

    // The raw column MUST be null (no write-time default) so the default stays dynamic.
    expect(store[0].name).toBeNull();

    const expectedDefault = defaultPlanName(null, CREATED_AT);

    // READ (detail): null → date-based default.
    const detail = await adapter.findPlanById(TENANT_A, USER_A, id);
    expect(detail?.name).toBe(expectedDefault);
    expect(detail?.name).not.toBe("");

    // READ (list): same default surfaces via the projection.
    const list = await adapter.findAllPlansByUser(TENANT_A, USER_A);
    expect(list[0].name).toBe(expectedDefault);
  });

  // The post-generation status-poll path reads through findLatestPlanBySpec, NOT
  // findById/findAllByUser. Its own projection must carry `name` through so the
  // resolved label survives that path too (regression: name dropped on the poll).
  it("name survives the findLatestPlanBySpec path (status-poll projection) (#93)", async () => {
    const { workoutPlanRepo, adapter } = buildStack();

    const { id } = await workoutPlanRepo.createGenerating(
      TENANT_A,
      USER_A,
      SPEC_A,
      "Summer Cut"
    );

    const latest = await adapter.findLatestPlanBySpec(TENANT_A, USER_A, SPEC_A);
    expect(latest?.id).toBe(id);
    expect(latest?.name).toBe("Summer Cut");
  });

  it("a blank name surfaces as the default via findLatestPlanBySpec (#93)", async () => {
    const { workoutPlanRepo, adapter } = buildStack();

    await workoutPlanRepo.createGenerating(TENANT_A, USER_A, SPEC_A, null);

    const latest = await adapter.findLatestPlanBySpec(TENANT_A, USER_A, SPEC_A);
    expect(latest?.name).toBe(defaultPlanName(null, CREATED_AT));
    expect(latest?.name).not.toBe("");
  });
});
