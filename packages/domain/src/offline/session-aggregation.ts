import type { WorkoutSessionRecord } from "@kinora/contracts";

/**
 * Total training volume for a session: sum of `weightKg * actualReps` across
 * every *completed* set. A completed set missing `weightKg` or `actualReps`
 * contributes 0 (rather than throwing or being skipped from the sum), and a
 * session with no exercises/sets returns 0.
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
      total += (set.weightKg ?? 0) * (set.actualReps ?? 0);
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
