import { addUtcDays, startOfUtcDay, utcDayKey } from "./utc-week.js";

/**
 * `computeStreak` — dashboard "Racha activa" (09c-v1-progress-dashboard-stats,
 * Slice 2). Counts consecutive UTC calendar days, ending today or yesterday,
 * on which the user completed at least one workout session. A calendar day
 * with no completed session breaks the streak (design.md "Streak: consecutive
 * training days"). Pure — no I/O.
 *
 * @param completedAtDates ISO timestamps of completed sessions (any order).
 * @param now Reference instant (default `new Date()`); UTC bucketing per
 *   design.md "Timezone".
 */
export function computeStreak(completedAtDates: string[], now: Date = new Date()): number {
  const completedDayKeys = new Set(completedAtDates.map((iso) => utcDayKey(new Date(iso))));

  let cursor = startOfUtcDay(now);
  if (!completedDayKeys.has(utcDayKey(cursor))) {
    cursor = addUtcDays(cursor, -1);
    if (!completedDayKeys.has(utcDayKey(cursor))) {
      return 0;
    }
  }

  let streak = 0;
  while (completedDayKeys.has(utcDayKey(cursor))) {
    streak += 1;
    cursor = addUtcDays(cursor, -1);
  }
  return streak;
}
