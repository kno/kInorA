import type { WorkoutSessionRecord } from "@kinora/contracts";

/**
 * Total training volume for a session: sum of `effectiveKg * actualReps`
 * across every *completed* set, where `effectiveKg` is the set's own logged
 * `weightKg` when it is a positive number, or otherwise the session's
 * `resolvedBodyweightKg` (17c-profile-body-metrics, PR 4 —
 * `resolveBodyweightForSession` applied once at the repository mapping
 * boundary). `(weightKg ?? 0) > 0`, not `weightKg == null`, on purpose: an
 * explicitly-logged `0 kg` set is indistinguishable from an unlogged one,
 * and `0 * reps` is the "you did nothing" lie bodyweight volume exists to
 * end. A completed set with no positive weight and no resolved bodyweight
 * contributes 0 (rather than throwing or being skipped from the sum), and a
 * session with no exercises/sets returns 0. **No signature change** from
 * before PR 4 — `resolvedBodyweightKg` is optional, so every existing
 * caller compiles and behaves unchanged when it is absent.
 *
 * Pure — no I/O.
 */
export function computeSessionVolume(session: WorkoutSessionRecord): number {
  let total = 0;

  for (const exercise of session.exercises) {
    for (const set of exercise.setRecords) {
      if (!set.completed) {
        continue;
      }
      const effectiveKg = (set.weightKg ?? 0) > 0 ? set.weightKg! : (session.resolvedBodyweightKg ?? 0);
      total += effectiveKg * (set.actualReps ?? 0);
    }
  }

  return total;
}

/**
 * Average RPE across every set in the session that recorded one. Sets
 * without an `rpe` value are excluded from both the sum and the count.
 * Returns `undefined` when no set in the session recorded an RPE (including
 * a session with no sets at all).
 *
 * Pure — no I/O.
 */
export function computeAverageRpe(session: WorkoutSessionRecord): number | undefined {
  let sum = 0;
  let count = 0;

  for (const exercise of session.exercises) {
    for (const set of exercise.setRecords) {
      if (set.rpe === undefined) {
        continue;
      }
      sum += set.rpe;
      count += 1;
    }
  }

  return count === 0 ? undefined : sum / count;
}

/**
 * RPE of every *completed* working set in the session that recorded one
 * (14b-v1.1 RPE-driven plan adaptation). Unlike `computeAverageRpe`, an
 * incomplete set is excluded even if it happens to carry an `rpe` value —
 * the adaptation window only counts working sets that were actually
 * performed. Returns `[]` when no completed set recorded an rpe.
 *
 * Pure — no I/O.
 */
export function extractCompletedSetRpeValues(session: WorkoutSessionRecord): number[] {
  const values: number[] = [];

  for (const exercise of session.exercises) {
    for (const set of exercise.setRecords) {
      if (set.completed && set.rpe !== undefined) {
        values.push(set.rpe);
      }
    }
  }

  return values;
}

/**
 * Compares `current` session volume against the immediately-prior completed
 * session for the same plan/exercise scope. Returns `undefined` when there
 * is no prior session (e.g. the first session in scope) — the caller
 * (history route/repository layer) supplies the already-fetched pair; this
 * function only derives the comparison.
 *
 * Pure — no I/O.
 */
export function computeVolumeTrend(
  current: WorkoutSessionRecord,
  prior: WorkoutSessionRecord | undefined,
): { volumeDelta: number; direction: "up" | "down" | "flat" } | undefined {
  if (!prior) {
    return undefined;
  }

  const volumeDelta = computeSessionVolume(current) - computeSessionVolume(prior);
  const direction = volumeDelta > 0 ? "up" : volumeDelta < 0 ? "down" : "flat";

  return { volumeDelta, direction };
}
