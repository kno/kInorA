import { utcWeekBounds } from "./utc-week.js";

export interface ComputeAdherenceInput {
  /** ISO timestamps of completed sessions (any date range). */
  completedAtDates: string[];
  /** Planned sessions for the current calendar week (from the active plan). */
  plannedSessionsPerWeek: number;
}

export interface AdherenceResult {
  weeklyCompleted: number;
  weeklyPlanned: number;
}

/**
 * `computeAdherence` — dashboard "Progreso semanal X/Y"
 * (09c-v1-progress-dashboard-stats, Slice 2). Counts completed sessions
 * whose `completedAt` falls inside the current UTC calendar week (Monday
 * 00:00:00.000 UTC through Sunday 23:59:59.999 UTC) against the planned
 * count — never inflating completed counts for sessions not yet logged
 * (design.md "Adherence lives on the Dashboard, not Statistics"). Pure —
 * no I/O.
 */
export function computeAdherence(
  input: ComputeAdherenceInput,
  now: Date = new Date()
): AdherenceResult {
  const { start, end } = utcWeekBounds(now);

  const weeklyCompleted = input.completedAtDates.filter((iso) => {
    const time = new Date(iso).getTime();
    return time >= start.getTime() && time <= end.getTime();
  }).length;

  return {
    weeklyCompleted,
    weeklyPlanned: Math.max(0, input.plannedSessionsPerWeek),
  };
}
