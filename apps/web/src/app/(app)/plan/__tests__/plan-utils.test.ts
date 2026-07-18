// @vitest-environment node
/**
 * Tests for plan-utils.ts — pure math helpers (no React, no DOM needed).
 */
import { describe, it, expect } from "vitest";
import {
  EXECUTION_OVERHEAD_SECONDS,
  buildWeekTiles,
  estimateSessionMinutes,
  restDays,
  sessionLoadBars,
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

describe("plan-utils — sessionLoadBars (Slice 4a: day-card mini bar-stack, closes #128)", () => {
  it("returns 4 bars by default", () => {
    const exercises = [{ name: "Squat", sets: 4, reps: "5", restSeconds: 90 }];
    expect(sessionLoadBars(exercises)).toHaveLength(4);
  });

  it("returns all zeros for an empty exercises array", () => {
    expect(sessionLoadBars([])).toEqual([0, 0, 0, 0]);
  });

  it("normalizes bar heights (0-100) relative to the session's own max load", () => {
    // Bench Press: 4 × (90 + 30) = 480s (max)
    // Overhead Press: 3 × (60 + 30) = 270s → round(270/480 × 100) = 56
    const exercises = [
      { name: "Bench Press", sets: 4, reps: "8-10", restSeconds: 90 },
      { name: "Overhead Press", sets: 3, reps: "10", restSeconds: 60 },
    ];
    expect(sessionLoadBars(exercises)).toEqual([100, 56, 0, 0]);
  });

  it("caps at barCount exercises (5th+ exercise ignored, not overflowed)", () => {
    const exercises = Array.from({ length: 6 }, (_, i) => ({
      name: `Ex${i}`,
      sets: i + 1,
      reps: "10",
      restSeconds: 30,
    }));
    expect(sessionLoadBars(exercises)).toHaveLength(4);
  });

  it("the single most-loaded exercise always renders at 100%", () => {
    const exercises = [{ name: "Solo", sets: 2, reps: "10", restSeconds: 30 }];
    expect(sessionLoadBars(exercises)[0]).toBe(100);
  });
});

describe("plan-utils — buildWeekTiles (spec-fidelity fix: full 7-tile Mon–Sun grid)", () => {
  const threeSessions = [
    { day: 1, title: "Push Day", exercises: [] },
    { day: 2, title: "Pull Day", exercises: [] },
    { day: 3, title: "Leg Day", exercises: [] },
  ];

  it("always returns exactly 7 tiles regardless of session count", () => {
    expect(buildWeekTiles(threeSessions)).toHaveLength(7);
    expect(buildWeekTiles([])).toHaveLength(7);
    expect(
      buildWeekTiles(
        Array.from({ length: 7 }, (_, i) => ({ day: i + 1, title: `D${i + 1}`, exercises: [] })),
      ),
    ).toHaveLength(7);
  });

  it("assigns dayNumber 1-7 (Monday-first) in order", () => {
    const tiles = buildWeekTiles(threeSessions);
    expect(tiles.map((t) => t.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("attaches the matching session by day number, undefined when no training day", () => {
    const tiles = buildWeekTiles(threeSessions);
    expect(tiles[0]!.session?.title).toBe("Push Day");
    expect(tiles[1]!.session?.title).toBe("Pull Day");
    expect(tiles[2]!.session?.title).toBe("Leg Day");
    expect(tiles[3]!.session).toBeUndefined();
    expect(tiles[6]!.session).toBeUndefined();
  });

  it("attaches status/date from overview.days by index when provided", () => {
    const overviewDays = [
      { date: "2026-07-13", status: "done" as const },
      { date: "2026-07-14", status: "active" as const },
      { date: "2026-07-15", status: "soon" as const },
      { date: "2026-07-16", status: "rest" as const },
      { date: "2026-07-17", status: "rest" as const },
      { date: "2026-07-18", status: "rest" as const },
      { date: "2026-07-19", status: "rest" as const },
    ];
    const tiles = buildWeekTiles(threeSessions, overviewDays);
    expect(tiles.map((t) => t.status)).toEqual([
      "done",
      "active",
      "soon",
      "rest",
      "rest",
      "rest",
      "rest",
    ]);
    expect(tiles[0]!.date).toBe("2026-07-13");
  });

  it("status/date are undefined for every tile when overview.days is absent", () => {
    const tiles = buildWeekTiles(threeSessions);
    for (const tile of tiles) {
      expect(tile.status).toBeUndefined();
      expect(tile.date).toBeUndefined();
    }
  });

  it("a training day can carry a 'rest' status (past-skipped planned session — no 'missed' state)", () => {
    const overviewDays = [
      { date: "2026-07-13", status: "rest" as const },
      { date: "2026-07-14", status: "active" as const },
      { date: "2026-07-15", status: "soon" as const },
      { date: "2026-07-16", status: "rest" as const },
      { date: "2026-07-17", status: "rest" as const },
      { date: "2026-07-18", status: "rest" as const },
      { date: "2026-07-19", status: "rest" as const },
    ];
    const tiles = buildWeekTiles(threeSessions, overviewDays);
    // Day 1 (Push Day) is a real training day but was skipped — status is
    // "rest", NOT "missed" (spec: no "missed" state exists), and the tile
    // still carries its session data (title/exercises) unchanged.
    expect(tiles[0]!.status).toBe("rest");
    expect(tiles[0]!.session?.title).toBe("Push Day");
  });
});
