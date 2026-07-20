import type { WeeklyDayStatus } from "@kinora/contracts";
import { addUtcDays, startOfUtcDay, utcDayKey } from "./utc-week.js";

export interface WeeklyPlanVsCompletionInput {
  /** Monday 00:00:00.000 UTC of the displayed calendar week. */
  weekStart: Date;
  /** ISO timestamps of completed sessions (any date range, any plan version). */
  completedAtDates: string[];
  /**
   * The current plan's training-day count (`weeklySessions.length`). Placed
   * into the first N weekday slots of the displayed week (Monday-first),
   * matching the plan's sequential "Día 1" display convention
   * (design.md "Planned-day → weekday mapping"). `0` when there is no
   * applicable plan for this week (e.g. a week predating the plan/account).
   */
  plannedTrainingDays: number;
}

/**
 * `computeWeeklyPlanVsCompletion` — weekly board per-day status array
 * (09c-v1-progress-dashboard-stats, Slice 4b). Resolves each of the 7
 * Monday-first days of `weekStart` to exactly one of `done` / `active` /
 * `rest` / `soon`, in the exhaustive precedence order from design.md
 * "The week model":
 *
 *   1. done   — a real completed session's `completedAt` buckets into this
 *      calendar day (regardless of plan version — this function has no
 *      notion of plan version at all, only dates).
 *   2. active — otherwise, this day is today.
 *   3. soon   — otherwise, this day is a FUTURE planned training slot (its
 *      Monday-first index is < `plannedTrainingDays` AND the day is after
 *      today).
 *   4. rest   — otherwise: a planned rest day (index >= N), a past skipped
 *      planned training day, or any day with no applicable plan. There is
 *      intentionally no "missed" status.
 *
 * `done` is never overridden by the planned overlay — it is checked first
 * and short-circuits every other branch. Pure — no I/O.
 */
export function computeWeeklyPlanVsCompletion(
  input: WeeklyPlanVsCompletionInput,
  now: Date = new Date()
): WeeklyDayStatus[] {
  const completedDayKeys = new Set(input.completedAtDates.map((iso) => utcDayKey(new Date(iso))));
  const today = startOfUtcDay(now);
  const todayKey = utcDayKey(today);
  const trainingDayCount = Math.max(0, Math.min(7, input.plannedTrainingDays));

  const days: WeeklyDayStatus[] = [];
  for (let index = 0; index < 7; index += 1) {
    const day = addUtcDays(input.weekStart, index);
    const dayKey = utcDayKey(day);

    if (completedDayKeys.has(dayKey)) {
      days.push("done");
      continue;
    }

    if (dayKey === todayKey) {
      days.push("active");
      continue;
    }

    const isPlannedTrainingSlot = index < trainingDayCount;
    const isFuture = day.getTime() > today.getTime();
    days.push(isPlannedTrainingSlot && isFuture ? "soon" : "rest");
  }

  return days;
}
