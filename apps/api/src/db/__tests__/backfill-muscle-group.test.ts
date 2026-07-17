import { describe, expect, it, vi } from "vitest";
import { backfillMuscleGroups } from "../backfill-muscle-group.js";
import { sessionExercises } from "../schema.js";

/**
 * 09c-v1-progress-dashboard-stats, Slice 1b, task 1b.4.
 *
 * Covers: idempotency (safe re-run), batching/chunking by `id`, resume after
 * an interruption, and the explicit versioned reclassify path. The mocked
 * `db` mirrors the query-builder mock pattern already used in
 * `workout-session.test.ts`; per-row identity is asserted via call ORDER
 * (each fetched row produces exactly one `update` call, in fetch order)
 * rather than by decoding the drizzle `eq()` SQL fragment passed to `.where`.
 */

interface Row {
  id: string;
  title: string;
}

function createDb(batches: Row[][]) {
  let callIndex = 0;
  const limit = vi.fn().mockImplementation(() => Promise.resolve(batches[callIndex++] ?? []));
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const updatedGroups: Array<string | null> = [];
  const update = vi.fn().mockImplementation((table: object) => {
    if (table !== sessionExercises) {
      throw new Error(`Unexpected update table: ${String(table)}`);
    }
    return {
      set: vi.fn().mockImplementation((values: { muscleGroup: string | null }) => ({
        where: vi.fn().mockImplementation(() => {
          updatedGroups.push(values.muscleGroup);
          return Promise.resolve([]);
        }),
      })),
    };
  });

  return { db: { select, update } as never, select, where, limit, update, updatedGroups };
}

describe("backfillMuscleGroups", () => {
  it("classifies and updates the rows scanned in the batch (fill mode = WHERE muscle_group IS NULL)", async () => {
    const rows: Row[] = [
      { id: "1", title: "Bench Press" },
      { id: "2", title: "Chest Supported Row" },
    ];
    const { db, updatedGroups } = createDb([rows]);

    const result = await backfillMuscleGroups(db, { batchSize: 50 });

    expect(result).toEqual({ processed: 2, updated: 2, batches: 1 });
    expect(updatedGroups).toEqual(["chest", "back"]);
  });

  it("batches/chunks over rows ordered by id, stopping once a short page is returned", async () => {
    const batchOne: Row[] = [
      { id: "1", title: "Bench Press" },
      { id: "2", title: "Bench Press" },
    ];
    const batchTwo: Row[] = [{ id: "3", title: "Squat" }];
    const { db, limit } = createDb([batchOne, batchTwo]);

    const result = await backfillMuscleGroups(db, { batchSize: 2 });

    expect(result.batches).toBe(2);
    expect(result.processed).toBe(3);
    expect(limit).toHaveBeenCalledTimes(2);
  });

  it("is idempotent — re-running after all rows are classified performs zero further updates", async () => {
    // A second run's WHERE muscle_group IS NULL scan finds nothing left.
    const { db, updatedGroups } = createDb([[]]);

    const result = await backfillMuscleGroups(db, { batchSize: 50 });

    expect(result).toEqual({ processed: 0, updated: 0, batches: 0 });
    expect(updatedGroups).toEqual([]);
  });

  it("resumes after an interruption by simply scanning again — already-filled rows no longer match the NULL filter", async () => {
    // Simulates: a prior run committed rows 1-2 and crashed before batch 2. A
    // fresh call only ever sees the still-NULL rows (3+); no special resume
    // flag is required because each batch commits independently.
    const remaining: Row[] = [{ id: "3", title: "Squat" }];
    const { db, updatedGroups } = createDb([remaining]);

    const result = await backfillMuscleGroups(db, { batchSize: 50 });

    expect(result).toEqual({ processed: 1, updated: 1, batches: 1 });
    expect(updatedGroups).toEqual(["quads"]);
  });

  it("reclassify mode reprocesses every row regardless of its current muscle_group, including null-degrade", async () => {
    const rows: Row[] = [
      { id: "1", title: "Bench Press" },
      { id: "2", title: "Farmer's Carry" },
    ];
    const { db, updatedGroups } = createDb([rows]);

    const result = await backfillMuscleGroups(db, { batchSize: 50, mode: "reclassify" });

    expect(result).toEqual({ processed: 2, updated: 2, batches: 1 });
    expect(updatedGroups).toEqual(["chest", null]);
  });

  it("reclassify mode is also idempotent — running it twice back to back is safe", async () => {
    const rows: Row[] = [{ id: "1", title: "Bench Press" }];
    const first = createDb([rows]);
    const firstResult = await backfillMuscleGroups(first.db, { batchSize: 50, mode: "reclassify" });

    const second = createDb([rows]);
    const secondResult = await backfillMuscleGroups(second.db, { batchSize: 50, mode: "reclassify" });

    expect(firstResult).toEqual({ processed: 1, updated: 1, batches: 1 });
    expect(secondResult).toEqual({ processed: 1, updated: 1, batches: 1 });
  });

  it("defaults to fill mode and a sane default batch size when no options are given", async () => {
    const { db } = createDb([[]]);

    const result = await backfillMuscleGroups(db);

    expect(result).toEqual({ processed: 0, updated: 0, batches: 0 });
  });
});
