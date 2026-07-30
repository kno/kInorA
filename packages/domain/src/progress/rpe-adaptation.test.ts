import { describe, expect, it } from "vitest";
import {
  computeRpeAdaptation,
  MIN_SESSIONS_WITH_RPE,
  MIN_SETS_WITH_RPE,
  RPE_HIGH_THRESHOLD,
  RPE_LOW_THRESHOLD,
  WINDOW_SESSIONS,
} from "./rpe-adaptation.js";

const NOW = new Date("2026-07-29T12:00:00.000Z");

/** Build N sessions, most-recent-last, each with the given rpeValues array. */
function buildSessions(rpeValuesPerSession: number[][]): Array<{ completedAt: string; rpeValues: number[] }> {
  return rpeValuesPerSession.map((rpeValues, index) => ({
    completedAt: `2026-07-${String(10 + index).padStart(2, "0")}T09:00:00.000Z`,
    rpeValues,
  }));
}

describe("computeRpeAdaptation", () => {
  it("suggests decreasing load when the mean RPE over the last 3 sessions is 9.0 (>= 8.5)", () => {
    const sessions = buildSessions([[9, 9], [9, 9], [9, 9]]);
    const result = computeRpeAdaptation({ sessions }, NOW);

    expect(result.source).toBe("rpe");
    expect(result.level).toBe("low");
    expect(result.rpe).toEqual({ meanRpe: 9, windowSessions: 3, sessionsWithRpe: 3, setsWithRpe: 6 });
    expect(result.suggestedChange).toEqual({
      kind: "adjust_load",
      direction: "decrease",
      from: "maintain",
      to: "reduce",
    });
  });

  it("suggests increasing load when the mean RPE over the last 3 sessions is 5.0 (<= 5.5)", () => {
    const sessions = buildSessions([[5, 5], [5, 5], [5, 5]]);
    const result = computeRpeAdaptation({ sessions }, NOW);

    expect(result.level).toBe("low");
    expect(result.suggestedChange).toEqual({
      kind: "adjust_load",
      direction: "increase",
      from: "maintain",
      to: "increase",
    });
  });

  it("produces no suggestion when the mean RPE is in the (5.5, 8.5) productive zone", () => {
    const sessions = buildSessions([[7, 7], [7, 7], [7, 7]]);
    const result = computeRpeAdaptation({ sessions }, NOW);

    expect(result.level).toBe("ok");
    expect(result.suggestedChange).toBeUndefined();
    expect(result.rpe!.meanRpe).toBe(7);
  });

  it(`returns insufficient_data with fewer than ${MIN_SESSIONS_WITH_RPE} sessions carrying a rated set`, () => {
    const sessions = buildSessions([[9, 9, 9, 9], []]);
    const result = computeRpeAdaptation({ sessions }, NOW);

    expect(result.level).toBe("insufficient_data");
    expect(result.suggestedChange).toBeUndefined();
    expect(result.rpe).toBeUndefined();
  });

  it(`returns insufficient_data with fewer than ${MIN_SETS_WITH_RPE} total rated sets even with enough sessions`, () => {
    const sessions = buildSessions([[9], [9], [9]]);
    const result = computeRpeAdaptation({ sessions }, NOW);

    expect(result.level).toBe("insufficient_data");
  });

  it("suppresses the suggestion when already at the floor rung (reduce) and the trend is too hard", () => {
    const sessions = buildSessions([[9, 9], [9, 9], [9, 9]]);
    const result = computeRpeAdaptation({ sessions, currentBias: "reduce" }, NOW);

    expect(result.level).toBe("low");
    expect(result.suggestedChange).toBeUndefined();
  });

  it("suppresses the suggestion when already at the ceiling rung (increase) and the trend is too easy", () => {
    const sessions = buildSessions([[5, 5], [5, 5], [5, 5]]);
    const result = computeRpeAdaptation({ sessions, currentBias: "increase" }, NOW);

    expect(result.level).toBe("low");
    expect(result.suggestedChange).toBeUndefined();
  });

  it(`only considers the last ${WINDOW_SESSIONS} completed sessions, ignoring older ones`, () => {
    // 4 sessions total; the oldest (very easy, RPE 2) would drag the mean down
    // below the low threshold if it counted — but the window is only the last 3.
    const sessions = [
      { completedAt: "2026-07-01T09:00:00.000Z", rpeValues: [2, 2] },
      ...buildSessions([[9, 9], [9, 9], [9, 9]]),
    ];
    const result = computeRpeAdaptation({ sessions }, NOW);

    expect(result.rpe!.windowSessions).toBe(3);
    expect(result.rpe!.meanRpe).toBe(9);
    expect(result.suggestedChange).toEqual({
      kind: "adjust_load",
      direction: "decrease",
      from: "maintain",
      to: "reduce",
    });
  });

  it("exercises the exact threshold boundaries", () => {
    const highBoundary = computeRpeAdaptation(
      { sessions: buildSessions([[RPE_HIGH_THRESHOLD, RPE_HIGH_THRESHOLD], [RPE_HIGH_THRESHOLD, RPE_HIGH_THRESHOLD]]) },
      NOW
    );
    expect(highBoundary.suggestedChange?.direction).toBe("decrease");

    const lowBoundary = computeRpeAdaptation(
      { sessions: buildSessions([[RPE_LOW_THRESHOLD, RPE_LOW_THRESHOLD], [RPE_LOW_THRESHOLD, RPE_LOW_THRESHOLD]]) },
      NOW
    );
    expect(lowBoundary.suggestedChange?.direction).toBe("increase");
  });
});
