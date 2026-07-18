/**
 * plan-utils.ts — pure math helpers for plan view rendering.
 *
 * No "use client" directive, no server-only import, no side effects.
 * Safe to import from both server components (PlanWeekView) and client
 * islands (DayDetailPanel) without boundary violations.
 */

import type { WeeklyDayStatus, WorkoutSession } from "@kinora/contracts";

/**
 * Assumed average seconds to perform one set (rep execution).
 * Documented estimate — tunable via code review.
 */
export const EXECUTION_OVERHEAD_SECONDS = 30;

/**
 * Estimate session duration in minutes.
 *
 * Formula: ceil( Σ(sets × (restSeconds + EXECUTION_OVERHEAD_SECONDS)) / 60 )
 *
 * Rest + per-set execution overhead is a more realistic estimate than
 * rest alone. The 30s overhead is a named constant so it is reviewable
 * and tunable. Labels carry "est." to communicate approximation.
 */
export function estimateSessionMinutes(
  exercises: WorkoutSession["exercises"],
): number {
  const totalSeconds = exercises.reduce(
    (sum, e) => sum + e.sets * (e.restSeconds + EXECUTION_OVERHEAD_SECONDS),
    0,
  );
  return Math.ceil(totalSeconds / 60);
}

/**
 * Derive rest days from the 08 contract invariant:
 *   weeklySessions.length === daysPerWeek on a 7-day week.
 *   rest days = max(0, 7 − weeklySessions.length)
 *
 * Clamps to 0 so malformed data (>7 sessions) never produces negative.
 * No API change required.
 */
export function restDays(weeklySessions: Pick<WorkoutSession, "day">[]): number {
  return Math.max(0, 7 - weeklySessions.length);
}

/**
 * Derive presentational mini bar-stack heights (0-100) for a day card's
 * load visualization (Slice 4a — web-plan.html `.mini-stack`, closes #128).
 *
 * Purely derived from the session's OWN exercises — no cross-session
 * analytics, no new domain function, no persisted data. Each bar height is
 * the exercise's estimated load (sets × (restSeconds + overhead)) relative
 * to the session's own max load, rounded to the nearest integer percent.
 * Always returns exactly `barCount` values (padded with 0 when there are
 * fewer exercises, truncated when there are more) so every day card renders
 * a uniform bar-stack regardless of exercise count.
 */
export function sessionLoadBars(
  exercises: WorkoutSession["exercises"],
  barCount = 4,
): number[] {
  const loads = exercises.map(
    (e) => e.sets * (e.restSeconds + EXECUTION_OVERHEAD_SECONDS),
  );
  const max = Math.max(0, ...loads);
  const bars = loads
    .slice(0, barCount)
    .map((load) => (max > 0 ? Math.round((load / max) * 100) : 0));
  while (bars.length < barCount) bars.push(0);
  return bars;
}

/**
 * One slot of the 7-tile Monday–Sunday weekly board (spec-fidelity fix,
 * 09c-v1-progress-dashboard-stats). Every calendar day gets a tile, whether
 * or not it is one of the plan's training days.
 */
export interface WeekTile {
  /** 1-7, Monday-first — matches `WorkoutSession.day` numbering. */
  dayNumber: number;
  /** The matching planned training-day session, if `dayNumber` is one. */
  session?: WorkoutSession;
  /** Real day state from `WeeklyOverviewDTO.days[dayNumber-1]`, when available. */
  status?: WeeklyDayStatus;
  /** ISO date from the same overview entry, when available. */
  date?: string;
}

/**
 * Build the fixed 7-tile Monday–Sunday grid (spec.md "Weekly Plan and
 * Progress Overview" — each day shows exactly one status; NOT one card per
 * training day).
 *
 * `overviewDays` is `WeeklyOverviewDTO.days` (already a 7-entry, Monday-first
 * array — see `getWeeklyOverview`). When absent (fetch failed, or a caller
 * that predates Slice 4b), every tile's `status`/`date` is `undefined` and
 * the caller falls back to session-presence-only rendering.
 */
export function buildWeekTiles(
  sessions: WorkoutSession[],
  overviewDays?: Array<{ date: string; status: WeeklyDayStatus; focus?: string }>,
): WeekTile[] {
  return Array.from({ length: 7 }, (_, i) => {
    const dayNumber = i + 1;
    const session = sessions.find((s) => s.day === dayNumber);
    const overviewDay = overviewDays?.[i];
    return {
      dayNumber,
      session,
      status: overviewDay?.status,
      date: overviewDay?.date,
    };
  });
}
