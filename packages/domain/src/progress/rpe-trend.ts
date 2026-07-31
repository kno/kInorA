/**
 * `computeRpeTrend` + `computeCompletionRate` — 15b-v2 trainer dashboard read
 * (Phase S1). Both are pure, deterministic (no I/O), mirroring the style of
 * `computeAdherence`/`computeRpeAdaptation`.
 */

import { addUtcDays, utcWeekBounds } from "./utc-week.js";
import type { RpeSessionInput } from "./rpe-adaptation.js";

/** Number of trailing weekly buckets the trend covers (design.md "RPE time-series"). */
const TREND_WEEKS = 8;
/** Minimum rated working sets a week needs before its bucket reports a real mean; below this the bucket is a gap. */
const MIN_RATED_SETS_PER_WEEK = 2;
/** Rolling window (in days) the completion-rate calc measures over (matches the 4-week adherence window). */
const COMPLETION_RATE_PERIOD_DAYS = 28;
/** Number of calendar weeks the completion-rate `planned` count is derived over. */
const COMPLETION_RATE_PERIOD_WEEKS = 4;

/** One weekly RPE bucket in the trend series. */
export interface RpeTrendPoint {
  /** ISO instant of Monday 00:00:00.000 UTC for this bucket's week. */
  weekStart: string;
  /** Mean RPE across every rated working set in the week, or `null` when fewer than `MIN_RATED_SETS_PER_WEEK` exist (rendered as a gap). */
  meanRpe: number | null;
  /** Distinct sessions in the week that recorded at least one rated set. */
  sessionsWithRpe: number;
}

/**
 * Buckets `sessions` into the trailing `TREND_WEEKS` UTC calendar weeks
 * (Monday-first, matching `utcWeekBounds`), most-recent week last. A week's
 * `meanRpe` is `null` unless it has `>= MIN_RATED_SETS_PER_WEEK` rated
 * working sets (design.md "RPE trend gap below sample floor") — the floor is
 * counted across ALL rated sets in the week, not per-session, so two
 * different sessions each contributing one rated set together clear it.
 *
 * `sessions[i].rpeValues` is expected to already be filtered to completed,
 * rated working sets by the caller (mirrors `buildRpeSessions`'s contract for
 * `computeRpeAdaptation`).
 *
 * Pure — no I/O.
 */
export function computeRpeTrend(sessions: RpeSessionInput[], now: Date = new Date()): RpeTrendPoint[] {
  const { start: currentWeekStart } = utcWeekBounds(now);

  const points: RpeTrendPoint[] = [];
  for (let weeksAgo = TREND_WEEKS - 1; weeksAgo >= 0; weeksAgo -= 1) {
    const weekStart = addUtcDays(currentWeekStart, -7 * weeksAgo);
    const weekEnd = new Date(addUtcDays(weekStart, 7).getTime() - 1);

    const sessionsInWeek = sessions.filter((session) => {
      const time = new Date(session.completedAt).getTime();
      return time >= weekStart.getTime() && time <= weekEnd.getTime();
    });

    const ratedSetsInWeek = sessionsInWeek.flatMap((session) => session.rpeValues);
    const sessionsWithRpe = sessionsInWeek.filter((session) => session.rpeValues.length > 0).length;
    const meanRpe =
      ratedSetsInWeek.length >= MIN_RATED_SETS_PER_WEEK
        ? ratedSetsInWeek.reduce((sum, value) => sum + value, 0) / ratedSetsInWeek.length
        : null;

    points.push({ weekStart: weekStart.toISOString(), meanRpe, sessionsWithRpe });
  }

  return points;
}

export interface ComputeCompletionRateInput {
  /** ISO timestamps of completed sessions (any date range). */
  completedAtDates: string[];
  /** Planned sessions for the current calendar week (from the active plan). */
  plannedSessionsPerWeek: number;
}

/** Rolling completion-rate result (design.md "completion-rate = rolling 28 days"). */
export interface CompletionRateResult {
  periodDays: 28;
  planned: number;
  completed: number;
  percent: number;
}

/**
 * Rolling 28-day completion rate ending at `now` (design.md "Completion-rate
 * period = rolling 28 days ending now, matches adherence's 4-week window").
 * `planned = plannedSessionsPerWeek * 4`; `percent = min(100, round(completed
 * / planned * 100))`. `planned === 0` returns `percent: 0` (no
 * division-by-zero) rather than `NaN`/`Infinity`.
 *
 * Pure — no I/O.
 */
export function computeCompletionRate(
  input: ComputeCompletionRateInput,
  now: Date = new Date()
): CompletionRateResult {
  const windowStartMs = now.getTime() - COMPLETION_RATE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

  const completed = input.completedAtDates.filter((iso) => {
    const time = new Date(iso).getTime();
    return time >= windowStartMs && time <= now.getTime();
  }).length;

  const planned = Math.max(0, input.plannedSessionsPerWeek) * COMPLETION_RATE_PERIOD_WEEKS;
  const percent = planned === 0 ? 0 : Math.min(100, Math.round((completed / planned) * 100));

  return { periodDays: COMPLETION_RATE_PERIOD_DAYS, planned, completed, percent };
}
