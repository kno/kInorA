import { describe, expect, it } from "vitest";
import { computeRpeTrend, computeCompletionRate } from "./rpe-trend.js";
import type { RpeSessionInput } from "./rpe-adaptation.js";

// Fixed "now" — Friday of the week 2026-07-13 (Mon) .. 2026-07-19 (Sun),
// mirroring the fixture already used by `getDashboardSummary`'s tests.
const NOW = new Date("2026-07-17T12:00:00.000Z");

function session(completedAt: string, rpeValues: number[]): RpeSessionInput {
  return { completedAt, rpeValues };
}

describe("computeRpeTrend", () => {
  it("1.1 returns exactly 8 weekly buckets, oldest-first, ending at the current UTC week (Monday-first)", () => {
    const points = computeRpeTrend([], NOW);

    expect(points).toHaveLength(8);
    // Current week Monday is 2026-07-13; the oldest bucket is 7 weeks before it.
    expect(points[0]!.weekStart).toBe("2026-05-25T00:00:00.000Z");
    expect(points[7]!.weekStart).toBe("2026-07-13T00:00:00.000Z");
  });

  it("1.1 a week's bucket has meanRpe: null when fewer than 2 rated working sets exist in that week", () => {
    // Only 1 rated set in the current week (2026-07-15) → gap.
    const sessions = [session("2026-07-15T09:00:00.000Z", [8])];
    const points = computeRpeTrend(sessions, NOW);

    const currentWeekBucket = points[7]!;
    expect(currentWeekBucket.meanRpe).toBeNull();
    expect(currentWeekBucket.sessionsWithRpe).toBe(1);
  });

  it("1.1 computes a real mean across ALL rated sets in the week once the >= 2 floor is met (triangulation)", () => {
    // Two different sessions in the current week with different rpe sets —
    // proves the mean is over all sets in the week, not a per-session average.
    const sessions = [
      session("2026-07-14T09:00:00.000Z", [8, 6]),
      session("2026-07-16T09:00:00.000Z", [9]),
    ];
    const points = computeRpeTrend(sessions, NOW);

    const currentWeekBucket = points[7]!;
    // (8 + 6 + 9) / 3 = 7.666...
    expect(currentWeekBucket.meanRpe).toBeCloseTo(23 / 3, 5);
    expect(currentWeekBucket.sessionsWithRpe).toBe(2);
  });

  it("1.1 buckets sessions by Monday-first UTC week boundary — Sunday 23:59:59.999 stays in the PRIOR week", () => {
    // 2026-07-12T23:59:59.999Z is the last instant of the week starting
    // 2026-07-06 (Mon); 2026-07-13T00:00:00.000Z is the first instant of the
    // current week.
    const sessions = [
      session("2026-07-12T23:59:59.999Z", [7, 7]),
      session("2026-07-13T00:00:00.000Z", [9, 9]),
    ];
    const points = computeRpeTrend(sessions, NOW);

    const priorWeekBucket = points[6]!; // week starting 2026-07-06
    const currentWeekBucket = points[7]!; // week starting 2026-07-13

    expect(priorWeekBucket.meanRpe).toBe(7);
    expect(currentWeekBucket.meanRpe).toBe(9);
  });

  it("1.1 ignores sessions outside the trailing 8-week window", () => {
    const tooOld = session("2026-01-01T09:00:00.000Z", [9, 9]);
    const points = computeRpeTrend([tooOld], NOW);

    expect(points.every((point) => point.meanRpe === null)).toBe(true);
  });
});

describe("computeCompletionRate", () => {
  it("1.3 computes percent = min(100, round(completed/planned*100)) over the rolling 28-day window", () => {
    // plannedSessionsPerWeek=3 -> planned = 3*4 = 12; 6 completions -> 50%.
    const completedAtDates = [
      "2026-07-01T08:00:00.000Z",
      "2026-07-03T08:00:00.000Z",
      "2026-07-05T08:00:00.000Z",
      "2026-07-08T08:00:00.000Z",
      "2026-07-10T08:00:00.000Z",
      "2026-07-15T08:00:00.000Z",
    ];

    const result = computeCompletionRate({ completedAtDates, plannedSessionsPerWeek: 3 }, NOW);

    expect(result.periodDays).toBe(28);
    expect(result.planned).toBe(12);
    expect(result.completed).toBe(6);
    expect(result.percent).toBe(50);
  });

  it("1.3 caps percent at 100 even when completed exceeds planned (triangulation)", () => {
    const completedAtDates = Array.from({ length: 15 }, (_unused, index) =>
      new Date(NOW.getTime() - index * 24 * 60 * 60 * 1000).toISOString()
    );

    // plannedSessionsPerWeek=3 -> planned = 12; 15 completions -> 125% -> capped at 100.
    const result = computeCompletionRate({ completedAtDates, plannedSessionsPerWeek: 3 }, NOW);

    expect(result.completed).toBe(15);
    expect(result.percent).toBe(100);
  });

  it("1.3 excludes completions outside the rolling 28-day window", () => {
    const insideWindow = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const outsideWindow = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();

    const result = computeCompletionRate(
      { completedAtDates: [insideWindow, outsideWindow], plannedSessionsPerWeek: 1 },
      NOW
    );

    expect(result.completed).toBe(1);
  });

  it("1.3 returns 0 percent (no division by zero) when plannedSessionsPerWeek is 0", () => {
    const result = computeCompletionRate(
      { completedAtDates: ["2026-07-15T08:00:00.000Z"], plannedSessionsPerWeek: 0 },
      NOW
    );

    expect(result.planned).toBe(0);
    expect(result.percent).toBe(0);
  });
});
