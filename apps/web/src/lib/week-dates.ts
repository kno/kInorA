/**
 * week-dates.ts — the single source of "what day is it" for every surface that
 * renders a live date (the dashboard topbar pill and week strip, the plan hero
 * pill).
 *
 * Extracted verbatim from `dashboard/page.tsx` for #411: the plan hero used to
 * render a hardcoded catalog string ("Today · Fri 12"), and the fix must reuse
 * the dashboard's formatter rather than grow a second one that can drift.
 *
 * Everything here works in UTC, matching the Monday-first `WeeklyOverviewDTO`
 * day convention, so the date pill and the weekday strip beside it can never
 * disagree about which day it is. (The app stores no per-user timezone; UTC is
 * the convention the whole week model already uses.)
 *
 * `now` is injectable so callers and tests can pin the clock; production call
 * sites pass nothing and read the real current instant.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 0-based Monday-first weekday index for "today" (UTC), matching the DTO convention. */
export function todayIndex(now: Date = new Date()): number {
  return (now.getUTCDay() + 6) % 7;
}

/** 0-based Monday-first weekday index (design.md convention) -> a locale-formatted short weekday label. */
export function weekdayLabel(dayIndex: number, locale: string, now: Date = new Date()): string {
  const monday = new Date(now.getTime() - todayIndex(now) * DAY_MS);
  const day = new Date(monday.getTime() + dayIndex * DAY_MS);
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(day);
}

/** Locale-formatted "weekday, day month" label for the topbar/hero date pills. */
export function formatToday(locale: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(now);
}
