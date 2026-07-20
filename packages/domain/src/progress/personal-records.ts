import type { PersonalRecord } from "@kinora/contracts";
import { normalizeTitle } from "./normalize.js";

/**
 * A single logged set, as input to `computePersonalRecords`
 * (09c-v1-progress-dashboard-stats, Slice 3b). `achievedAt` is the owning
 * session's completion date (ISO string) — PRs are keyed on when the
 * session was completed, not per-set timestamps (none exist).
 */
export interface PersonalRecordSetInput {
  exerciseTitle: string;
  completed: boolean;
  weightKg: number | null | undefined;
  actualReps: number | null | undefined;
  achievedAt: string;
}

const EPLEY_REP_DIVISOR = 30;

function estimatedOneRepMax(weightKg: number, actualReps: number): number {
  return weightKg * (1 + actualReps / EPLEY_REP_DIVISOR);
}

function isEligible(set: PersonalRecordSetInput): set is PersonalRecordSetInput & { weightKg: number; actualReps: number } {
  return set.completed && (set.weightKg ?? 0) > 0 && (set.actualReps ?? 0) > 0;
}

/**
 * `computePersonalRecords` — estimated one-rep max (Epley formula) per
 * exercise, grouped by normalized title (design.md "Personal records:
 * estimated 1RM"). Only **eligible** sets are considered: `completed` AND
 * `weightKg > 0` AND `actualReps > 0`. Bodyweight, no-weight/assisted, and
 * null-reps sets are excluded — Epley is meaningless without a real load
 * and rep count. An exercise with no eligible set is **omitted** from the
 * result, never surfaced as a zero PR.
 *
 * Each returned record carries the best (max) estimated 1RM, the date it
 * was achieved, and — when at least two distinct-day data points exist — a
 * `trend`: an ascending-by-date 1RM series (one point per calendar day,
 * taking that day's best set) plus a signed `delta` (latest point minus the
 * prior point). Pure — no I/O.
 */
export function computePersonalRecords(sets: readonly PersonalRecordSetInput[]): PersonalRecord[] {
  const byNormalizedTitle = new Map<string, { displayTitle: string; points: Map<string, { value: number; achievedAt: string }> }>();

  for (const set of sets) {
    if (!isEligible(set)) {
      continue;
    }

    const normalized = normalizeTitle(set.exerciseTitle);
    const value = estimatedOneRepMax(set.weightKg, set.actualReps);
    const dayKey = set.achievedAt.slice(0, 10);

    const group = byNormalizedTitle.get(normalized) ?? {
      displayTitle: set.exerciseTitle,
      points: new Map<string, { value: number; achievedAt: string }>(),
    };

    const existingPoint = group.points.get(dayKey);
    if (!existingPoint || value > existingPoint.value) {
      group.points.set(dayKey, { value, achievedAt: set.achievedAt });
    }

    byNormalizedTitle.set(normalized, group);
  }

  const records: PersonalRecord[] = [];

  for (const group of byNormalizedTitle.values()) {
    const series = [...group.points.values()].sort(
      (left, right) => new Date(left.achievedAt).getTime() - new Date(right.achievedAt).getTime()
    );

    const best = series.reduce((max, point) => (point.value > max.value ? point : max), series[0]!);
    // Prefer the display title recorded on the best-achieving day.
    const displayTitle = sets.find(
      (set) => isEligible(set) && set.achievedAt === best.achievedAt && normalizeTitle(set.exerciseTitle) === normalizeTitle(group.displayTitle)
    )?.exerciseTitle ?? group.displayTitle;

    const record: PersonalRecord = {
      exerciseTitle: displayTitle,
      estimated1RM: best.value,
      achievedAt: best.achievedAt,
    };

    if (series.length >= 2) {
      const values = series.map((point) => point.value);
      record.trend = { series: values, delta: values[values.length - 1]! - values[values.length - 2]! };
    }

    records.push(record);
  }

  return records;
}
