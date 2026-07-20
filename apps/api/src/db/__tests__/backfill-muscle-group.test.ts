import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { backfillMuscleGroups } from "../backfill-muscle-group.js";
import { sessionExercises } from "../schema.js";

/**
 * 09c-v1-progress-dashboard-stats, Slice 1b, task 1b.4.
 *
 * Covers: idempotency (safe re-run), batching/chunking by `id`, resume after
 * an interruption, and the explicit versioned reclassify path. The mocked
 * `db` mirrors the query-builder mock pattern already used in
 * `workout-session.test.ts`.
 *
 * Each batch is written with a SINGLE bulk `update` call (a `CASE id WHEN
 * ... THEN ... END` SQL expression scoped by `WHERE id IN (...)`), not one
 * `update` per row. `extractCaseValues` decodes the drizzle `sql` template's
 * `queryChunks` back into an ordered array of `(id, muscleGroup)` pairs so
 * tests can assert per-row classification without depending on raw SQL text.
 */

interface Row {
  id: string;
  title: string;
}

/**
 * Reconstructs the `[{ id, muscleGroup }]` pairs embedded in a
 * `buildMuscleGroupCase(...)`-produced `SQL` expression. Drizzle's `sql`
 * template tag stores non-column/non-SQL interpolated values (our `id` and
 * `muscleGroup` params) as raw primitives directly inside `queryChunks`,
 * nested one level per `sql.join(...)` clause — so this recursively flattens
 * every chunk tree and collects the raw (non-object) values in template
 * order, which alternate `[id, muscleGroup, id, muscleGroup, ...]` because
 * each `WHEN ${id} THEN ${muscleGroup}` clause interpolates exactly two
 * primitives.
 */
function collectPrimitives(chunks: unknown[], out: unknown[]): void {
  for (const chunk of chunks) {
    if (chunk === null || typeof chunk !== "object") {
      out.push(chunk);
      continue;
    }
    const nested = (chunk as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(nested)) {
      collectPrimitives(nested, out);
    }
  }
}

function extractCaseValues(expr: SQL): Array<{ id: string; muscleGroup: string | null }> {
  const primitives: unknown[] = [];
  collectPrimitives(expr.queryChunks, primitives);

  const pairs: Array<{ id: string; muscleGroup: string | null }> = [];
  for (let i = 0; i < primitives.length; i += 2) {
    pairs.push({
      id: primitives[i] as string,
      muscleGroup: primitives[i + 1] as string | null,
    });
  }
  return pairs;
}

function createDb(batches: Row[][]) {
  let callIndex = 0;
  const limit = vi.fn().mockImplementation(() => Promise.resolve(batches[callIndex++] ?? []));
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const updateCalls: Array<{ ids: string[]; groups: Array<string | null> }> = [];
  const updateWhere = vi.fn();
  const update = vi.fn().mockImplementation((table: object) => {
    if (table !== sessionExercises) {
      throw new Error(`Unexpected update table: ${String(table)}`);
    }
    return {
      set: vi.fn().mockImplementation((values: { muscleGroup: SQL }) => ({
        where: vi.fn().mockImplementation((condition: unknown) => {
          updateWhere(condition);
          const pairs = extractCaseValues(values.muscleGroup);
          updateCalls.push({
            ids: pairs.map((pair) => pair.id),
            groups: pairs.map((pair) => pair.muscleGroup),
          });
          return Promise.resolve([]);
        }),
      })),
    };
  });

  return { db: { select, update } as never, select, where, limit, update, updateCalls };
}

describe("backfillMuscleGroups", () => {
  it("classifies and bulk-updates the rows scanned in the batch with ONE update call (fill mode = WHERE muscle_group IS NULL)", async () => {
    const rows: Row[] = [
      { id: "1", title: "Bench Press" },
      { id: "2", title: "Chest Supported Row" },
    ];
    const { db, update, updateCalls } = createDb([rows]);

    const result = await backfillMuscleGroups(db, { batchSize: 50 });

    expect(result).toEqual({ processed: 2, updated: 2, batches: 1 });
    // One bulk `update` call for the whole batch, not one per row.
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateCalls).toEqual([{ ids: ["1", "2"], groups: ["chest", "back"] }]);
  });

  it("batches/chunks over rows ordered by id, stopping once a short page is returned, with one bulk update per batch", async () => {
    const batchOne: Row[] = [
      { id: "1", title: "Bench Press" },
      { id: "2", title: "Bench Press" },
    ];
    const batchTwo: Row[] = [{ id: "3", title: "Squat" }];
    const { db, limit, update, updateCalls } = createDb([batchOne, batchTwo]);

    const result = await backfillMuscleGroups(db, { batchSize: 2 });

    expect(result.batches).toBe(2);
    expect(result.processed).toBe(3);
    expect(limit).toHaveBeenCalledTimes(2);
    // Two batches → two bulk update calls (not three per-row updates).
    expect(update).toHaveBeenCalledTimes(2);
    expect(updateCalls).toEqual([
      { ids: ["1", "2"], groups: ["chest", "chest"] },
      { ids: ["3"], groups: ["quads"] },
    ]);
  });

  it("is idempotent — re-running after all rows are classified performs zero further updates", async () => {
    // A second run's WHERE muscle_group IS NULL scan finds nothing left.
    const { db, update, updateCalls } = createDb([[]]);

    const result = await backfillMuscleGroups(db, { batchSize: 50 });

    expect(result).toEqual({ processed: 0, updated: 0, batches: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it("resumes after an interruption by simply scanning again — already-filled rows no longer match the NULL filter", async () => {
    // Simulates: a prior run committed rows 1-2 and crashed before batch 2. A
    // fresh call only ever sees the still-NULL rows (3+); no special resume
    // flag is required because each batch commits independently.
    const remaining: Row[] = [{ id: "3", title: "Squat" }];
    const { db, updateCalls } = createDb([remaining]);

    const result = await backfillMuscleGroups(db, { batchSize: 50 });

    expect(result).toEqual({ processed: 1, updated: 1, batches: 1 });
    expect(updateCalls).toEqual([{ ids: ["3"], groups: ["quads"] }]);
  });

  it("reclassify mode reprocesses every row regardless of its current muscle_group, including null-degrade, via one bulk update", async () => {
    const rows: Row[] = [
      { id: "1", title: "Bench Press" },
      { id: "2", title: "Farmer's Carry" },
    ];
    const { db, update, updateCalls } = createDb([rows]);

    const result = await backfillMuscleGroups(db, { batchSize: 50, mode: "reclassify" });

    expect(result).toEqual({ processed: 2, updated: 2, batches: 1 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateCalls).toEqual([{ ids: ["1", "2"], groups: ["chest", null] }]);
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
