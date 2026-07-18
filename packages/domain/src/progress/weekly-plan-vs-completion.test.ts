import { describe, expect, it } from "vitest";
import { computeWeeklyPlanVsCompletion } from "./weekly-plan-vs-completion.js";

// Monday 2026-07-13 .. Sunday 2026-07-19 (UTC).
const WEEK_START = new Date("2026-07-13T00:00:00.000Z");

describe("computeWeeklyPlanVsCompletion", () => {
  it("marks today as done when a completed session falls on today (done wins over active)", () => {
    const now = new Date("2026-07-15T12:00:00.000Z"); // Wednesday
    const days = computeWeeklyPlanVsCompletion(
      { weekStart: WEEK_START, completedAtDates: ["2026-07-15T08:00:00.000Z"], plannedTrainingDays: 5 },
      now
    );
    // Wed = index 2
    expect(days[2]).toBe("done");
  });

  it("marks today as active when no completed session exists for today", () => {
    const now = new Date("2026-07-15T12:00:00.000Z"); // Wednesday
    const days = computeWeeklyPlanVsCompletion(
      { weekStart: WEEK_START, completedAtDates: [], plannedTrainingDays: 5 },
      now
    );
    expect(days[2]).toBe("active");
  });

  it("marks a future planned training day as soon", () => {
    const now = new Date("2026-07-13T12:00:00.000Z"); // Monday
    const days = computeWeeklyPlanVsCompletion(
      { weekStart: WEEK_START, completedAtDates: [], plannedTrainingDays: 5 },
      now
    );
    // Friday (index 4) is a future planned training day (N=5, indices 0..4).
    expect(days[4]).toBe("soon");
  });

  it("marks a past planned training day with no completed session as rest (skipped day, no 'missed')", () => {
    const now = new Date("2026-07-16T12:00:00.000Z"); // Thursday
    const days = computeWeeklyPlanVsCompletion(
      { weekStart: WEEK_START, completedAtDates: [], plannedTrainingDays: 5 },
      now
    );
    // Monday (index 0) is a past planned training day with nothing completed -> rest.
    expect(days[0]).toBe("rest");
  });

  it("marks a planned rest day (index >= N) as rest", () => {
    const now = new Date("2026-07-13T12:00:00.000Z"); // Monday
    const days = computeWeeklyPlanVsCompletion(
      { weekStart: WEEK_START, completedAtDates: [], plannedTrainingDays: 3 },
      now
    );
    // Index 5 (Saturday) >= N=3 -> rest, even though it's future.
    expect(days[5]).toBe("rest");
  });

  it("is exhaustive: every one of the 7 days gets exactly one of the 4 statuses", () => {
    const now = new Date("2026-07-16T12:00:00.000Z");
    const days = computeWeeklyPlanVsCompletion(
      { weekStart: WEEK_START, completedAtDates: ["2026-07-13T08:00:00.000Z"], plannedTrainingDays: 4 },
      now
    );
    expect(days).toHaveLength(7);
    for (const status of days) {
      expect(["done", "active", "rest", "soon"]).toContain(status);
    }
  });

  it("renders an all-rest week (+ any real done) for a week predating the plan/account", () => {
    // now is far in the future relative to the displayed week; plannedTrainingDays
    // reflects the CURRENT plan, but this past week has no applicable overlay
    // except real completed-session dates.
    const now = new Date("2026-08-01T12:00:00.000Z");
    const days = computeWeeklyPlanVsCompletion(
      { weekStart: WEEK_START, completedAtDates: ["2026-07-14T08:00:00.000Z"], plannedTrainingDays: 0 },
      now
    );
    expect(days).toEqual(["rest", "done", "rest", "rest", "rest", "rest", "rest"]);
  });

  it("counts a done day regardless of which plan version produced the session (input is plan-version-agnostic)", () => {
    // computeWeeklyPlanVsCompletion has no notion of plan version at all —
    // any completedAtDates entry bucketed into the week counts as done.
    const now = new Date("2026-07-17T12:00:00.000Z");
    const days = computeWeeklyPlanVsCompletion(
      { weekStart: WEEK_START, completedAtDates: ["2026-07-13T23:59:59.999Z"], plannedTrainingDays: 5 },
      now
    );
    expect(days[0]).toBe("done");
  });
});
