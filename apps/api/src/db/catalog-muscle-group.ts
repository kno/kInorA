/**
 * Muscle-group derivation from the exercise catalog's real taxonomy
 * (#352 slice C).
 *
 * ## What changes
 *
 * `session_exercises.muscle_group` — the column the dashboard and the muscular
 * distribution are computed from — was populated by keyword-matching the
 * free-text title (`classifyExerciseMuscleGroup`). That guesses: "barbell
 * close-grip bench press" contains "bench press", so it counted as CHEST even
 * though the catalog records its target as `triceps`. Where the title resolves
 * to a catalog record we now read the muscle from the dataset instead of
 * inferring it from the words, and the classifier stays as the fallback for
 * everything that does not resolve.
 *
 * Nothing here touches history. Only the write path at session start uses this,
 * so existing rows keep the value they were written with; #352 says backfilling
 * is a separate decision precisely because it would silently move every
 * existing user's stats.
 *
 * ## Why `target` and not `bodyPart`
 *
 * `bodyPart` is ten coarse buckets ("upper arms", "upper legs", "waist") that
 * do not survive projection onto our ten: "upper arms" is biceps AND triceps.
 * `target` is the primary mover — 19 values, most of which name one of our
 * buckets outright.
 *
 * `bodyPart` still did the deciding work for the entries `target` alone cannot
 * settle (`serratus anterior` -> chest, `spine`/`traps` -> back,
 * `abductors` -> glutes), but it does so at AUTHORING time, not at runtime:
 * in this dataset every `target` occurs under exactly one `bodyPart`, so
 * reading `bodyPart` here could not add information the target does not
 * already carry. That invariant is pinned by a test, so if a future dataset
 * refresh breaks it we find out and revisit the map instead of silently
 * shipping a mapping whose premise no longer holds.
 *
 * ## Why the map is exhaustive and has no catch-all
 *
 * Every distinct `target` in the catalog is either in
 * {@link CATALOG_TARGET_MUSCLE_GROUPS} or in {@link UNMAPPED_CATALOG_TARGETS},
 * and a test asserts exactly that against the live dataset in both directions.
 * A default branch would turn a dataset refresh that adds a target into a
 * silent stream of `null` muscle groups — invisible in the stats, and only
 * noticeable as a slowly growing "unclassified" slice. Instead the build fails
 * and somebody makes a decision.
 */
import { getExerciseById, resolveExerciseByName } from "@kinora/exercise-catalog";
import type { ExerciseCatalogRecord } from "@kinora/exercise-catalog";
import type { MuscleGroup } from "@kinora/contracts";

import { classifyExerciseMuscleGroup } from "./muscle-classifier.js";

/**
 * Every catalog `target` that names one of the ten `MuscleGroup` buckets,
 * mapped to it. Keys are the dataset's verbatim lowercase values.
 *
 * The non-obvious entries, and what decided them:
 *
 *  - `abductors` -> glutes. The hip abductors ARE the gluteus medius/minimus,
 *    so this is the same muscle under a functional name, not an approximation.
 *  - `serratus anterior` -> chest. No bucket of ours contains it, but all five
 *    records sit under `bodyPart: "chest"` and are chest-wall/scapular work
 *    (scapula push-ups, incline shoulder raises).
 *  - `spine` -> back. These are the erector-spinae movements (hyperextensions,
 *    back extensions), `bodyPart: "back"`.
 *  - `traps` -> back. Shrugs could argue for shoulders; the dataset files them
 *    under `bodyPart: "back"` and our `shoulders` bucket is the deltoids.
 *  - `upper back` / `lats` -> back. Our taxonomy has one back bucket.
 *  - `delts` -> shoulders, `pectorals` -> chest, `abs` -> core: same muscle,
 *    different vocabulary.
 */
export const CATALOG_TARGET_MUSCLE_GROUPS: Readonly<Record<string, MuscleGroup>> =
  Object.freeze({
    abductors: "glutes",
    abs: "core",
    biceps: "biceps",
    calves: "calves",
    delts: "shoulders",
    glutes: "glutes",
    hamstrings: "hamstrings",
    lats: "back",
    pectorals: "chest",
    quads: "quads",
    "serratus anterior": "chest",
    spine: "back",
    traps: "back",
    triceps: "triceps",
    "upper back": "back",
  });

/**
 * Catalog targets deliberately left out of {@link CATALOG_TARGET_MUSCLE_GROUPS}
 * because our ten buckets contain no honest home for them. Listing them is what
 * makes the exhaustiveness test able to tell "decided against" from "forgotten".
 *
 *  - `cardiovascular system` (29 records, `bodyPart: "cardio"`) — running,
 *    rowing, jumping rope. A cardio session has no muscle-group slice, and
 *    inventing one would distort the very distribution this slice exists to
 *    make credible.
 *  - `forearms` (37) — wrist curls and grip work. Our taxonomy stops at
 *    biceps/triceps; filing them under `biceps` would be a plain factual error.
 *  - `adductors` (6) — the inner-thigh group is not the quads, the hamstrings
 *    or the glutes. Unlike `abductors`, there is no bucket that anatomically
 *    contains it.
 *  - `levator scapulae` (2) — two neck stretches, `bodyPart: "neck"`.
 *
 * These are not dead ends: a record with one of these targets yields no
 * catalog-derived group, and {@link deriveExerciseMuscleGroup} then falls back
 * to the keyword classifier exactly as it would for an unresolvable title. So
 * the outcome is never WORSE than today's — "side plank hip adduction" still
 * lands in `core` — it just is not upgraded.
 */
export const UNMAPPED_CATALOG_TARGETS: ReadonlySet<string> = new Set([
  "adductors",
  "cardiovascular system",
  "forearms",
  "levator scapulae",
]);

/**
 * The catalog's own answer for a record, or `null` when its `target` is one of
 * the {@link UNMAPPED_CATALOG_TARGETS}. Pure; never throws.
 */
export function muscleGroupFromCatalogRecord(
  record: ExerciseCatalogRecord,
): MuscleGroup | null {
  return CATALOG_TARGET_MUSCLE_GROUPS[record.target] ?? null;
}

/** A prescribed exercise, narrowed to what the derivation actually reads. */
export interface DerivableExercise {
  /** The free-text snapshot of what was prescribed. Never rewritten. */
  name: string;
  /** Catalog id resolved server-side at generation time (#352 slice B). */
  catalogId?: string;
}

/**
 * Derives the muscle group to store for a prescribed exercise.
 *
 * Order, most-informed first:
 *
 *  1. the record behind a stored `catalogId`, which was resolved at generation
 *     time against the user's own equipment vocabulary — the same reason
 *     `plan/catalog-links.ts` never re-resolves a stored id;
 *  2. the record the free-text `name` resolves to, by name equality only (see
 *     `resolveExerciseByName` — it returns nothing rather than guessing);
 *  3. `classifyExerciseMuscleGroup`, unchanged, for a title the catalog cannot
 *     account for at all.
 *
 * Returns `null` only when the classifier itself has no answer, which is the
 * same "unclassified" outcome the column already stores today. Pure and total:
 * no I/O, no throw, and `name` is only ever read.
 */
export function deriveExerciseMuscleGroup(
  exercise: DerivableExercise,
): MuscleGroup | null {
  const record =
    (exercise.catalogId === undefined
      ? undefined
      : getExerciseById(exercise.catalogId)) ??
    resolveExerciseByName(exercise.name)?.record;

  const fromCatalog = record === undefined ? null : muscleGroupFromCatalogRecord(record);

  return fromCatalog ?? classifyExerciseMuscleGroup(exercise.name);
}
