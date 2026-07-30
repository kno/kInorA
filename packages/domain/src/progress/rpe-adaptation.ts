/**
 * `computeRpeAdaptation` — 14b v1.1 adaptation-from-RPE policy.
 *
 * Pure, deterministic (no I/O). Aggregates the mean RPE of completed working
 * sets across the last `WINDOW_SESSIONS` completed sessions (a session-count
 * window, NOT a calendar window — RPE is sparse/optional, so gaps are handled
 * by a sample-size floor rather than a date range) and, when the trend leaves
 * the `(RPE_LOW_THRESHOLD, RPE_HIGH_THRESHOLD)` productive zone, suggests a
 * one-rung `intensityBias` change on the `reduce < maintain < increase`
 * ladder. Mirrors `computeAdherenceAdaptation`'s shape and floor-guard style.
 */

/** The only lever this policy may suggest: a load bias (mirrors `PlanSpec.intensityBias`). */
export type IntensityBias = "reduce" | "maintain" | "increase";

/** The only adaptation this policy may suggest: a load (intensityBias) adjustment. */
export type RpeSuggestedChange = {
  kind: "adjust_load";
  direction: "increase" | "decrease";
  from: IntensityBias;
  to: IntensityBias;
};

/** Signal context for an actionable/`ok` RPE result over the session window. */
export interface RpeSnapshot {
  meanRpe: number;
  windowSessions: number;
  sessionsWithRpe: number;
  setsWithRpe: number;
}

export interface RpeSessionInput {
  /** ISO completedAt — used only to order sessions most-recent-first. */
  completedAt: string;
  /** RPE of each completed working set in this session that recorded one. */
  rpeValues: number[];
}

export interface ComputeRpeAdaptationInput {
  /** Any number of completed sessions with their rated set RPEs; order-independent. */
  sessions: RpeSessionInput[];
  /** Current `PlanSpec.intensityBias`. Absent/undefined defaults to `"maintain"`. */
  currentBias?: IntensityBias;
}

export interface RpeAdaptationResult {
  /** Always `"rpe"` for this policy; the shared contract reserves `"adherence"` for 14a. */
  source: "rpe";
  /** `"low"` here means "actionable" (too hard OR too easy) — mirrors adherence's use of `"low"` to surface a banner. */
  level: "ok" | "low" | "insufficient_data";
  /** Present for `"ok"` | `"low"`; absent for `"insufficient_data"`. */
  rpe?: RpeSnapshot;
  /** Present ONLY for `"low"` AND when a real one-rung ladder step exists (not already at the floor/ceiling rung). */
  suggestedChange?: RpeSuggestedChange;
}

/** Session-count window length (design.md "session-count window, hysteresis band"). */
export const WINDOW_SESSIONS = 3;
/** Mean RPE >= this over the window is "too hard" → suggest decreasing load. */
export const RPE_HIGH_THRESHOLD = 8.5;
/** Mean RPE <= this over the window is "too easy" → suggest increasing load. */
export const RPE_LOW_THRESHOLD = 5.5;
/** Minimum distinct sessions with at least one rated set, within the window. */
export const MIN_SESSIONS_WITH_RPE = 2;
/** Minimum total rated sets across the window. */
export const MIN_SETS_WITH_RPE = 4;

const BIAS_LADDER: IntensityBias[] = ["reduce", "maintain", "increase"];

export function computeRpeAdaptation(
  input: ComputeRpeAdaptationInput,
  _now: Date = new Date()
): RpeAdaptationResult {
  const currentBias = input.currentBias ?? "maintain";

  // Session-count window: take only the most recent WINDOW_SESSIONS entries,
  // regardless of the caller's input order (sort defensively by completedAt).
  const windowSessions = [...input.sessions]
    .sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime())
    .slice(0, WINDOW_SESSIONS);

  const sessionsWithRpe = windowSessions.filter((session) => session.rpeValues.length > 0).length;
  const allRpeValues = windowSessions.flatMap((session) => session.rpeValues);
  const setsWithRpe = allRpeValues.length;

  if (sessionsWithRpe < MIN_SESSIONS_WITH_RPE || setsWithRpe < MIN_SETS_WITH_RPE) {
    return { source: "rpe", level: "insufficient_data" };
  }

  const meanRpe = allRpeValues.reduce((sum, value) => sum + value, 0) / setsWithRpe;
  const snapshot: RpeSnapshot = {
    meanRpe,
    windowSessions: windowSessions.length,
    sessionsWithRpe,
    setsWithRpe,
  };

  if (meanRpe >= RPE_HIGH_THRESHOLD) {
    return withLadderStep("decrease", currentBias, snapshot);
  }
  if (meanRpe <= RPE_LOW_THRESHOLD) {
    return withLadderStep("increase", currentBias, snapshot);
  }
  return { source: "rpe", level: "ok", rpe: snapshot };
}

/**
 * Steps `currentBias` one rung on the `reduce < maintain < increase` ladder in
 * `direction`. At the floor (`reduce`, decreasing) or ceiling (`increase`,
 * increasing) there is no valid next rung — marks `"low"` (an actionable
 * trend exists) but emits no invalid `suggestedChange`, mirroring
 * `computeAdherenceAdaptation`'s `MIN_DAYS_PER_WEEK` floor behavior.
 */
function withLadderStep(
  direction: "increase" | "decrease",
  currentBias: IntensityBias,
  snapshot: RpeSnapshot
): RpeAdaptationResult {
  const currentIndex = BIAS_LADDER.indexOf(currentBias);
  const nextIndex = direction === "decrease" ? currentIndex - 1 : currentIndex + 1;
  const to = BIAS_LADDER[nextIndex];
  if (nextIndex < 0 || nextIndex >= BIAS_LADDER.length || to === undefined) {
    return { source: "rpe", level: "low", rpe: snapshot };
  }
  return {
    source: "rpe",
    level: "low",
    rpe: snapshot,
    suggestedChange: { kind: "adjust_load", direction, from: currentBias, to },
  };
}
