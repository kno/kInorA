import { config } from "dotenv";
import { and, asc, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDbClient } from "./client.js";
import type { Database } from "./client.js";
import { sessionExercises } from "./schema.js";
import { classifyExerciseMuscleGroup } from "./muscle-classifier.js";

/**
 * Idempotent, batched muscle-group backfill (09c-v1-progress-dashboard-stats,
 * Slice 1b). See design.md "How exercises get a muscle group".
 *
 * Two modes:
 *   - "fill" (default) — only touches rows where `muscle_group IS NULL`.
 *     Safe to re-run any time; already-classified rows are never revisited,
 *     so a re-run after an interruption naturally resumes from wherever the
 *     NULL scan picks back up (each batch commits independently).
 *   - "reclassify" — reprocesses EVERY row, regardless of its current
 *     `muscle_group` value. Use this after a classifier improvement to fix
 *     previously mis-labeled rows that the NULL-only filter would never
 *     revisit.
 *
 * Both modes page through rows ordered by `id` in bounded chunks
 * (`batchSize`, default `DEFAULT_BATCH_SIZE`), so this stays safe against a
 * large `session_exercises` table and never loads the whole table at once.
 */

export const DEFAULT_BATCH_SIZE = 500;

export type BackfillMode = "fill" | "reclassify";

export interface BackfillOptions {
  /** Number of rows scanned/updated per batch. Defaults to `DEFAULT_BATCH_SIZE`. */
  batchSize?: number;
  /** "fill" (default) only touches NULL rows; "reclassify" touches every row. */
  mode?: BackfillMode;
  /** Resume a "reclassify" run from strictly after this row id (exclusive). */
  startAfterId?: string;
}

export interface BackfillResult {
  /** Total rows scanned across all batches. */
  processed: number;
  /** Total rows updated (equal to `processed` — every scanned row is written). */
  updated: number;
  /** Number of batches executed. */
  batches: number;
}

interface ScannedRow {
  id: string;
  title: string;
}

/**
 * Minimal query-builder surface this module needs from `Database` — kept
 * narrow so unit tests can supply a lightweight mock instead of a full
 * drizzle client.
 */
type BackfillDb = Pick<Database, "select" | "update">;

export async function backfillMuscleGroups(
  db: BackfillDb,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const mode = options.mode ?? "fill";

  let cursor = options.startAfterId;
  let processed = 0;
  let updated = 0;
  let batches = 0;

  for (;;) {
    const rows = (await db
      .select({ id: sessionExercises.id, title: sessionExercises.title })
      .from(sessionExercises)
      .where(scanCondition(mode, cursor))
      .orderBy(asc(sessionExercises.id))
      .limit(batchSize)) as ScannedRow[];

    if (rows.length === 0) {
      break;
    }
    batches += 1;

    const classified = rows.map((row) => ({
      id: row.id,
      muscleGroup: classifyExerciseMuscleGroup(row.title),
    }));

    await db
      .update(sessionExercises)
      .set({ muscleGroup: buildMuscleGroupCase(classified) })
      .where(
        inArray(
          sessionExercises.id,
          classified.map((row) => row.id),
        ),
      );
    updated += classified.length;

    processed += rows.length;
    cursor = rows[rows.length - 1]!.id;

    if (rows.length < batchSize) {
      break;
    }
  }

  return { processed, updated, batches };
}

/**
 * Builds a single `CASE id WHEN ... THEN ... END` SQL expression covering an
 * entire batch, so each batch is written with ONE bulk `UPDATE ... WHERE id
 * IN (...)` round-trip instead of one `UPDATE` per row.
 */
export function buildMuscleGroupCase(
  rows: Array<{ id: string; muscleGroup: string | null }>,
): SQL {
  const clauses = rows.map((row) => sql`WHEN ${row.id} THEN ${row.muscleGroup}`);
  return sql`CASE ${sessionExercises.id} ${sql.join(clauses, sql` `)} ELSE ${sessionExercises.muscleGroup} END`;
}

/**
 * CLI entrypoint — `pnpm --filter api db:backfill-muscle-group [--reclassify]`.
 * Only runs when this file is executed directly (not when imported, e.g. by
 * tests). Creates its own DB client from `DATABASE_URL` (loaded from the
 * project root `.env`, mirroring `src/index.ts`), runs the backfill, logs a
 * summary, and exits non-zero on failure so operators/CI notice.
 */
async function runCli(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dirname, "../../../../.env");
  config({ path: envPath });

  const mode: BackfillMode = process.argv.includes("--reclassify") ? "reclassify" : "fill";

  const { db, pool } = createDbClient();
  try {
    const result = await backfillMuscleGroups(db, { mode });
    console.log(
      `[backfill-muscle-group] mode=${mode} batches=${result.batches} processed=${result.processed} updated=${result.updated}`,
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli().catch((err) => {
    console.error("[backfill-muscle-group] failed:", err);
    process.exitCode = 1;
  });
}

function scanCondition(mode: BackfillMode, cursor: string | undefined): SQL | undefined {
  const conditions: SQL[] = [];
  if (mode === "fill") {
    conditions.push(isNull(sessionExercises.muscleGroup));
  }
  if (cursor) {
    conditions.push(gt(sessionExercises.id, cursor));
  }

  if (conditions.length === 0) {
    return undefined;
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return and(...conditions);
}
