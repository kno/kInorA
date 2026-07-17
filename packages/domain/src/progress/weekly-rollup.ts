import { utcWeekBounds, utcWeekdayIndex } from "./utc-week.js";

export interface WeeklyRollupPlanDay {
  /** 0-based Monday-first weekday index (0=Mon..6=Sun) — the same
   * sequential display convention used by the weekly board
   * (design.md "Planned-day → weekday mapping"). */
  dayIndex: number;
  focus: string;
}

export interface WeeklyRollupSession {
  completedAt: string;
  volumeKg: number;
}

export interface WeeklyRollupRow {
  dayIndex: number;
  focus?: string;
  loadKg: number;
  /** 0-100, relative to the week's highest-load day (0 when nothing was completed). */
  loadPercent: number;
}

/**
 * `computeWeeklyRollup` — dashboard "Ruta de carga" week-route strip
 * (09c-v1-progress-dashboard-stats, Slice 2). Aggregates completed-session
 * volume per planned day slot for the current UTC calendar week and derives
 * a relative load-fill percentage for the bar. Pure — no I/O.
 */
export function computeWeeklyRollup(
  input: { planDays: WeeklyRollupPlanDay[]; sessions: WeeklyRollupSession[] },
  now: Date = new Date()
): WeeklyRollupRow[] {
  if (input.planDays.length === 0) {
    return [];
  }

  const { start } = utcWeekBounds(now);
  const loadByDayIndex = new Map<number, number>();

  for (const session of input.sessions) {
    const dayIndex = utcWeekdayIndex(new Date(session.completedAt), start);
    if (dayIndex === undefined) {
      continue;
    }
    loadByDayIndex.set(dayIndex, (loadByDayIndex.get(dayIndex) ?? 0) + session.volumeKg);
  }

  const rows = input.planDays.map((planDay) => ({
    dayIndex: planDay.dayIndex,
    focus: planDay.focus,
    loadKg: loadByDayIndex.get(planDay.dayIndex) ?? 0,
  }));

  const maxLoad = Math.max(0, ...rows.map((row) => row.loadKg));

  return rows.map((row) => ({
    ...row,
    loadPercent: maxLoad > 0 ? Math.round((row.loadKg / maxLoad) * 100) : 0,
  }));
}
