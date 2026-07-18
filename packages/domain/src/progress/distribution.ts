import { MUSCLE_GROUPS, type MuscleGroup } from "@kinora/contracts";

/**
 * A single exercise's contribution to the muscle-group distribution
 * (09c-v1-progress-dashboard-stats, Slice 3b). `muscleGroup` is the derived
 * classification from `classifyExerciseMuscleGroup` (`null` when the title
 * is unmapped — design.md "Muscle-group distribution"). `setCount` /
 * `volumeKg` are the exercise's already-computed completed-set count and
 * volume for the period (mirrors how `computeSessionVolume` only counts
 * completed sets).
 */
export interface MuscleGroupDistributionExercise {
  muscleGroup: MuscleGroup | null;
  setCount: number;
  volumeKg: number;
}

export interface MuscleGroupDistributionRow {
  muscleGroup: MuscleGroup;
  setCount: number;
  volumeKg: number;
}

/**
 * `computeMuscleGroupDistribution` — aggregates set count + volume across
 * the 10 primary `MuscleGroup` buckets for the statistics surface
 * (design.md "Muscle-group distribution: how it's aggregated vs. how it's
 * shown"). Exercises with `muscleGroup: null` (unmapped titles) are
 * excluded gracefully — they simply do not contribute to any bucket, and no
 * error is raised. Only groups that received at least one contribution are
 * returned, in the canonical `MUSCLE_GROUPS` order. Pure — no I/O.
 */
export function computeMuscleGroupDistribution(
  exercises: readonly MuscleGroupDistributionExercise[]
): MuscleGroupDistributionRow[] {
  const totals = new Map<MuscleGroup, { setCount: number; volumeKg: number }>();

  for (const exercise of exercises) {
    if (exercise.muscleGroup === null) {
      continue;
    }
    const current = totals.get(exercise.muscleGroup) ?? { setCount: 0, volumeKg: 0 };
    current.setCount += exercise.setCount;
    current.volumeKg += exercise.volumeKg;
    totals.set(exercise.muscleGroup, current);
  }

  return MUSCLE_GROUPS.filter((group) => totals.has(group)).map((group) => {
    const entry = totals.get(group)!;
    return { muscleGroup: group, setCount: entry.setCount, volumeKg: entry.volumeKg };
  });
}
