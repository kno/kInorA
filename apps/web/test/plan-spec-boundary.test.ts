import { describe, it, expect } from "vitest";
import { createPlanPayload } from "../src/lib/plan";
import type { PlanSpec } from "@kinora/contracts";

// Base preferenceScores for reuse in fixtures
const SCORES = { strength: 0.6, hypertrophy: 0.9, endurance: 0.3, mobility: 0.3 };

describe("createPlanPayload", () => {
  it("returns a PlanSpec with the same values as input", () => {
    const spec: PlanSpec = {
      goal: "hypertrophy",
      daysPerWeek: 4,
      sessionDurationMinutes: 60,
      location: "gym",
      equipment: ["dumbbells", "cable machine"],
      limitations: [{ text: "shoulder impingement", isWarning: true }],
      preferenceScores: SCORES,
      confirmed: false,
    };

    const result = createPlanPayload(spec);

    expect(result.goal).toBe("hypertrophy");
    expect(result.daysPerWeek).toBe(4);
    expect(result.sessionDurationMinutes).toBe(60);
    expect(result.location).toBe("gym");
    expect(result.equipment).toEqual(["dumbbells", "cable machine"]);
    expect(result.limitations).toEqual([{ text: "shoulder impingement", isWarning: true }]);
    expect(result.confirmed).toBe(false);
  });

  // --- Triangle: different goal, location, equipment ---

  it("returns the spec unchanged with different goal and location", () => {
    const spec: PlanSpec = {
      goal: "fat_loss",
      daysPerWeek: 6,
      sessionDurationMinutes: 30,
      location: "outdoor",
      equipment: ["jump rope"],
      limitations: [],
      preferenceScores: { strength: 0.4, hypertrophy: 0.5, endurance: 0.9, mobility: 0.4 },
      confirmed: false,
    };

    const result = createPlanPayload(spec);

    expect(result).toEqual(spec);
    expect(result.goal).toBe("fat_loss");
    expect(result.location).toBe("outdoor");
    expect(result.equipment).toEqual(["jump rope"]);
  });
});
