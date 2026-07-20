import { describe, expect, it } from "vitest";
import { computeStreak } from "./streak.js";

const NOW = new Date("2026-07-17T12:00:00.000Z"); // Friday

describe("computeStreak", () => {
  it("counts consecutive UTC calendar days ending today", () => {
    const completedAt = [
      "2026-07-17T08:00:00.000Z", // today (Fri)
      "2026-07-16T20:00:00.000Z", // Thu
      "2026-07-15T09:00:00.000Z", // Wed
    ];
    expect(computeStreak(completedAt, NOW)).toBe(3);
  });

  it("counts consecutive days ending yesterday when today has no session yet", () => {
    const completedAt = [
      "2026-07-16T20:00:00.000Z", // Thu (yesterday)
      "2026-07-15T09:00:00.000Z", // Wed
    ];
    expect(computeStreak(completedAt, NOW)).toBe(2);
  });

  it("a gap day resets the streak", () => {
    const completedAt = [
      "2026-07-17T08:00:00.000Z", // today
      // 2026-07-16 is a gap day — no session
      "2026-07-15T09:00:00.000Z",
      "2026-07-14T09:00:00.000Z",
    ];
    expect(computeStreak(completedAt, NOW)).toBe(1);
  });

  it("returns 0 when neither today nor yesterday has a completed session", () => {
    const completedAt = ["2026-07-10T09:00:00.000Z"];
    expect(computeStreak(completedAt, NOW)).toBe(0);
  });

  it("returns 0 for no history", () => {
    expect(computeStreak([], NOW)).toBe(0);
  });

  it("counts multiple sessions on the same UTC day only once", () => {
    const completedAt = [
      "2026-07-17T08:00:00.000Z",
      "2026-07-17T18:00:00.000Z",
    ];
    expect(computeStreak(completedAt, NOW)).toBe(1);
  });
});
