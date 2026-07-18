/**
 * plan-utils.ts — pure math helpers for plan view rendering.
 *
 * No "use client" directive, no server-only import, no side effects.
 * Safe to import from both server components (PlanWeekView) and client
 * islands (DayDetailPanel) without boundary violations.
 */

import type { WorkoutSession } from "@kinora/contracts";

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
