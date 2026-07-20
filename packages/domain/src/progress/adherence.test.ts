import { describe, expect, it } from "vitest";
import { computeAdherence } from "./adherence.js";

const NOW = new Date("2026-07-17T12:00:00.000Z"); // Friday, week of 2026-07-13..19

describe("computeAdherence", () => {
  it("counts completed sessions inside the current UTC calendar week against planned", () => {
    const result = computeAdherence(
      {
        completedAtDates: [
          "2026-07-13T09:00:00.000Z", // Mon (in week)
          "2026-07-15T09:00:00.000Z", // Wed (in week)
        ],
        plannedSessionsPerWeek: 5,
      },
      NOW
    );
    expect(result).toEqual({ weeklyCompleted: 2, weeklyPlanned: 5 });
  });

  it("does not inflate completed counts for sessions outside the current week", () => {
    const result = computeAdherence(
      {
        completedAtDates: [
          "2026-07-06T09:00:00.000Z", // prior week
          "2026-07-14T09:00:00.000Z", // this week (Tue)
        ],
        plannedSessionsPerWeek: 4,
      },
      NOW
    );
    expect(result).toEqual({ weeklyCompleted: 1, weeklyPlanned: 4 });
  });

  it("reports 0/0 when there is no plan and no completions", () => {
    const result = computeAdherence({ completedAtDates: [], plannedSessionsPerWeek: 0 }, NOW);
    expect(result).toEqual({ weeklyCompleted: 0, weeklyPlanned: 0 });
  });

  it("never returns a negative planned count", () => {
    const result = computeAdherence({ completedAtDates: [], plannedSessionsPerWeek: -3 }, NOW);
    expect(result.weeklyPlanned).toBe(0);
  });
});
