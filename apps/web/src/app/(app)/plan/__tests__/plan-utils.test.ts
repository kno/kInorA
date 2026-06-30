// @vitest-environment node
/**
 * Tests for plan-utils.ts — pure math helpers (no React, no DOM needed).
 */
import { describe, it, expect } from "vitest";
import {
  EXECUTION_OVERHEAD_SECONDS,
  estimateSessionMinutes,
  restDays,
} from "../plan-utils";

describe("plan-utils — EXECUTION_OVERHEAD_SECONDS", () => {
  it("is 30 seconds (documented estimate)", () => {
    expect(EXECUTION_OVERHEAD_SECONDS).toBe(30);
  });
});

describe("plan-utils — estimateSessionMinutes", () => {
  it("returns 0 for empty exercises array", () => {
    expect(estimateSessionMinutes([])).toBe(0);
  });

  it("computes ceil(sets × (restSeconds + 30) / 60) for a single exercise", () => {
    // 4 sets × (90 + 30) = 480s → ceil(480/60) = 8 min
    const exercises = [{ name: "Squat", sets: 4, reps: "5", restSeconds: 90 }];
    expect(estimateSessionMinutes(exercises)).toBe(8);
  });

  it("sums across multiple exercises", () => {
    // Exercise 1: 4 × (90 + 30) = 480s
    // Exercise 2: 3 × (60 + 30) = 270s
    // total = 750s → ceil(750/60) = 13 min (750/60 = 12.5)
    const exercises = [
      { name: "Bench Press", sets: 4, reps: "8-10", restSeconds: 90 },
      { name: "Overhead Press", sets: 3, reps: "10", restSeconds: 60 },
    ];
    expect(estimateSessionMinutes(exercises)).toBe(13);
  });

  it("applies ceil to fractional minutes", () => {
    // 1 set × (31 + 30) = 61s → ceil(61/60) = 2 min (not 1)
    const exercises = [{ name: "X", sets: 1, reps: "1", restSeconds: 31 }];
    expect(estimateSessionMinutes(exercises)).toBe(2);
  });

  it("returns exact minutes when result is whole number", () => {
    // 1 set × (30 + 30) = 60s → ceil(60/60) = 1 min
    const exercises = [{ name: "X", sets: 1, reps: "1", restSeconds: 30 }];
    expect(estimateSessionMinutes(exercises)).toBe(1);
  });
});

describe("plan-utils — restDays", () => {
  it("returns 7 - length for a normal case (5 sessions → 2 rest days)", () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      day: i + 1,
      title: `Day ${i + 1}`,
      exercises: [],
    }));
    expect(restDays(sessions)).toBe(2);
  });

  it("returns 0 when sessions.length === 7 (full week — no rest days)", () => {
    const sessions = Array.from({ length: 7 }, (_, i) => ({
      day: i + 1,
      title: `Day ${i + 1}`,
      exercises: [],
    }));
    expect(restDays(sessions)).toBe(0);
  });

  it("clamps to 0 when sessions.length > 7 (never returns negative)", () => {
    // Edge case: malformed data with 8 sessions
    const sessions = Array.from({ length: 8 }, (_, i) => ({
      day: i + 1,
      title: `Day ${i + 1}`,
      exercises: [],
    }));
    expect(restDays(sessions)).toBe(0);
  });

  it("returns 6 for 1 session", () => {
    const sessions = [{ day: 1, title: "Push Day", exercises: [] }];
    expect(restDays(sessions)).toBe(6);
  });

  it("returns 7 for 0 sessions (empty array)", () => {
    expect(restDays([])).toBe(7);
  });
});
