import { describe, expect, it } from "vitest";
import { computeWeeklyRollup } from "./weekly-rollup.js";

const NOW = new Date("2026-07-17T12:00:00.000Z"); // Friday, week of 2026-07-13..19

describe("computeWeeklyRollup", () => {
  it("aggregates per-day completed volume against the planned day slots", () => {
    const rows = computeWeeklyRollup(
      {
        planDays: [
          { dayIndex: 0, focus: "Tirón técnico" },
          { dayIndex: 1, focus: "Pierna ligera" },
          { dayIndex: 3, focus: "Empuje controlado" },
        ],
        sessions: [
          { completedAt: "2026-07-13T09:00:00.000Z", volumeKg: 1000 }, // Mon -> dayIndex 0
          { completedAt: "2026-07-16T09:00:00.000Z", volumeKg: 500 }, // Thu -> dayIndex 3
        ],
      },
      NOW
    );

    expect(rows).toEqual([
      { dayIndex: 0, focus: "Tirón técnico", loadKg: 1000, loadPercent: 100 },
      { dayIndex: 1, focus: "Pierna ligera", loadKg: 0, loadPercent: 0 },
      { dayIndex: 3, focus: "Empuje controlado", loadKg: 500, loadPercent: 50 },
    ]);
  });

  it("ignores sessions completed in a different calendar week", () => {
    const rows = computeWeeklyRollup(
      {
        planDays: [{ dayIndex: 0, focus: "Full body" }],
        sessions: [{ completedAt: "2026-07-06T09:00:00.000Z", volumeKg: 900 }],
      },
      NOW
    );

    expect(rows).toEqual([{ dayIndex: 0, focus: "Full body", loadKg: 0, loadPercent: 0 }]);
  });

  it("returns 0 loadPercent for every day when nothing was completed", () => {
    const rows = computeWeeklyRollup(
      { planDays: [{ dayIndex: 0, focus: "Rest" }, { dayIndex: 1, focus: "Legs" }], sessions: [] },
      NOW
    );

    expect(rows.every((row) => row.loadPercent === 0)).toBe(true);
  });

  it("returns an empty array when there is no plan", () => {
    expect(computeWeeklyRollup({ planDays: [], sessions: [] }, NOW)).toEqual([]);
  });
});
