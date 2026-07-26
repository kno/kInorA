import { addUtcDays, startOfUtcDay } from "./utc-week.js";

/** Adherence percentage below this fraction over the window is `low` (design.md "Threshold + mapping"). */
const LOW_THRESHOLD = 0.7;
/** The minimum sane weekly frequency; a reduction can never propose fewer than this. */
const MIN_DAYS_PER_WEEK = 1;
/** Rolling window length in weeks when the caller does not pin one (design.md "PINNED DEFAULT = 4"). */
const DEFAULT_PERIOD_WEEKS = 4;

export interface ComputeAdherenceAdaptationInput {
  /** ISO timestamps of completed sessions (any range — e.g. the bounded 60-session history). */
  completedAtDates: string[];
  /** Planned sessions/week from the latest ready plan (= `PlanSpec.daysPerWeek`). */
  plannedSessionsPerWeek: number;
  /** Latest ready plan's `createdAt` (ISO). Guards new users from a false `low`. */
  planCreatedAt?: string;
  /** Rolling window length in weeks. Default 4. */
  periodWeeks?: number;
}

/** Signal context for a `low`/`ok` adherence result over the rolling window. */
export interface AdherenceSnapshot {
  /** completed/planned over the window, clamped to `0..1`. */
  adherence: number;
  periodWeeks: number;
  completedInWindow: number;
  /** `plannedSessionsPerWeek * periodWeeks`. */
  plannedInWindow: number;
}

/** The only adaptation 14a may suggest: a frequency reduction (`daysPerWeek`). */
export type SuggestedChange = { kind: "reduce_frequency"; fromDays: number; toDays: number };

export interface AdherenceAdaptationResult {
  /** Always `"adherence"` for this policy; the shared contract reserves `"rpe"` for 14b. */
  source: "adherence";
  level: "ok" | "low" | "insufficient_data";
  /** Present for `"ok"` | `"low"`; absent for `"insufficient_data"`. */
  adherence?: AdherenceSnapshot;
  /** Present ONLY for `"low"` AND when a real reduction exists (`toDays < fromDays`). */
  suggestedChange?: SuggestedChange;
}

/**
 * `computeAdherenceAdaptation` — 14a v1.1 adaptation-from-adherence policy.
 *
 * Deterministic, pure (no I/O, no LLM, no scheduler; `now` is injectable). Over a
 * trailing rolling window (default 4 weeks) it compares completed sessions against
 * `plannedSessionsPerWeek * periodWeeks` and decides whether to suggest a frequency
 * reduction. The weekly-template model has no per-date schedule, so planned volume is
 * `plannedSessionsPerWeek * periodWeeks` (design.md "Rolling window").
 *
 * Insufficient-data guards (→ `insufficient_data`, no snapshot, no suggestion):
 * `plannedSessionsPerWeek <= 0` (no active ready plan), missing `planCreatedAt`, or a
 * plan younger than the window — the last stops a brand-new plan reading `0% → low`,
 * since only plan age distinguishes a new user from an abandoning one.
 */
export function computeAdherenceAdaptation(
  input: ComputeAdherenceAdaptationInput,
  now: Date = new Date()
): AdherenceAdaptationResult {
  const periodWeeks = input.periodWeeks ?? DEFAULT_PERIOD_WEEKS;
  const windowStart = addUtcDays(startOfUtcDay(now), -periodWeeks * 7);
  const windowStartMs = windowStart.getTime();
  const nowMs = now.getTime();

  const insufficient: AdherenceAdaptationResult = { source: "adherence", level: "insufficient_data" };

  // No active ready plan / nothing to divide by.
  if (input.plannedSessionsPerWeek <= 0) return insufficient;
  // No plan age to reason about, or the plan is younger than one full window: a
  // brand-new plan has not had a full window to adhere, so 0% is not yet "low".
  if (!input.planCreatedAt) return insufficient;
  if (new Date(input.planCreatedAt).getTime() > windowStartMs) return insufficient;

  const completedInWindow = input.completedAtDates.filter((iso) => {
    const time = new Date(iso).getTime();
    return time >= windowStartMs && time <= nowMs;
  }).length;

  const plannedInWindow = input.plannedSessionsPerWeek * periodWeeks;
  const adherence = Math.min(1, Math.max(0, completedInWindow / plannedInWindow));
  const snapshot: AdherenceSnapshot = {
    adherence,
    periodWeeks,
    completedInWindow,
    plannedInWindow,
  };

  if (adherence >= LOW_THRESHOLD) {
    return { source: "adherence", level: "ok", adherence: snapshot };
  }

  const fromDays = input.plannedSessionsPerWeek;
  const toDays = Math.max(MIN_DAYS_PER_WEEK, fromDays - 1);
  if (toDays < fromDays) {
    return {
      source: "adherence",
      level: "low",
      adherence: snapshot,
      suggestedChange: { kind: "reduce_frequency", fromDays, toDays },
    };
  }
  // Already at the floor — mark low but emit no invalid change.
  return { source: "adherence", level: "low", adherence: snapshot };
}
