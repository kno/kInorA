/**
 * Shared UTC calendar-day/week helpers (09c-v1-progress-dashboard-stats,
 * Slice 2). Every surface in this change buckets calendar days/weeks in a
 * single fixed UTC reference for v1 (design.md "Timezone"). All functions
 * take the reference instant as an explicit parameter (default `new Date()`)
 * so a future per-user-timezone change is non-breaking.
 *
 * Pure — no I/O.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns a `YYYY-MM-DD` UTC calendar-day key for `date`. */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC of the calendar day containing `date`. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Adds `days` (may be negative) to `date`, preserving UTC midnight alignment. */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Monday 00:00:00.000 UTC through Sunday 23:59:59.999 UTC bounds of the
 * calendar week containing `reference` (design.md "The week model").
 */
export function utcWeekBounds(reference: Date): { start: Date; end: Date } {
  const day = startOfUtcDay(reference);
  // getUTCDay(): 0=Sunday..6=Saturday. Convert to Monday-first offset (0..6).
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  const start = addUtcDays(day, -mondayOffset);
  const end = new Date(addUtcDays(start, 7).getTime() - 1);
  return { start, end };
}

/**
 * 0-based Monday-first weekday index (0=Mon..6=Sun) of `date` within the
 * week starting at `weekStart`. Returns `undefined` when `date` falls
 * outside that 7-day window.
 */
export function utcWeekdayIndex(date: Date, weekStart: Date): number | undefined {
  const diffDays = Math.floor((startOfUtcDay(date).getTime() - weekStart.getTime()) / MS_PER_DAY);
  return diffDays >= 0 && diffDays < 7 ? diffDays : undefined;
}
