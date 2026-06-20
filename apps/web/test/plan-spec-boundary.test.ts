import { describe, it, expect } from "vitest";
import { createPlanPayload } from "../src/lib/plan";
import type { PlanSpec } from "@kinora/contracts";

describe("createPlanPayload", () => {
  it("returns a PlanSpec with the same values as input", () => {
    const spec: PlanSpec = {
      goal: "hypertrophy",
      daysPerWeek: 4,
      sessionDurationMinutes: 60,
      location: "gym",
      equipment: ["dumbbells", "cable machine"],
      limitations: ["shoulder impingement"],
      confirmed: false,
    };

    const result = createPlanPayload(spec);

    expect(result.goal).toBe("hypertrophy");
    expect(result.daysPerWeek).toBe(4);
    expect(result.sessionDurationMinutes).toBe(60);
    expect(result.location).toBe("gym");
    expect(result.equipment).toEqual(["dumbbells", "cable machine"]);
    expect(result.limitations).toEqual(["shoulder impingement"]);
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
      confirmed: false,
    };

    const result = createPlanPayload(spec);

    expect(result).toEqual(spec);
    expect(result.goal).toBe("fat_loss");
    expect(result.location).toBe("outdoor");
    expect(result.equipment).toEqual(["jump rope"]);
  });
});