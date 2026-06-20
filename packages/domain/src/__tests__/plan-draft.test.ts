import { describe, it, expect } from "vitest";
import { createPlanDraft } from "@kinora/domain";
import type { PlanSpec, PlanGoal, TrainingLocation } from "@kinora/contracts";

describe("createPlanDraft", () => {
  // --- Scenario: Domain test runs in isolation (Req 3) ---
  // GIVEN a use case test imports only domain and contract packages
  // WHEN the unit test runs
  // THEN no framework or database module is loaded

  it("returns a draft with the same goal as the spec", () => {
    const spec: PlanSpec = {
      goal: "strength",
      daysPerWeek: 3,
      sessionDurationMinutes: 45,
      location: "gym",
      equipment: ["barbell", "rack"],
      limitations: [],
      confirmed: true,
    };

    const draft = createPlanDraft(spec);

    expect(draft.goal).toBe("strength");
  });

  it("forces confirmed to false regardless of spec value", () => {
    const spec: PlanSpec = {
      goal: "strength",
      daysPerWeek: 3,
      sessionDurationMinutes: 45,
      location: "gym",
      equipment: ["barbell", "rack"],
      limitations: [],
      confirmed: true,
    };

    const draft = createPlanDraft(spec);

    expect(draft.confirmed).toBe(false);
  });

  // --- Triangulation: different goal, location, equipment ---
  // Forces real logic, not hardcoded values

  it("echoes all spec fields and forces confirmed to false with different goal and location", () => {
    const spec: PlanSpec = {
      goal: "fat_loss",
      daysPerWeek: 5,
      sessionDurationMinutes: 30,
      location: "outdoor",
      equipment: ["jump rope"],
      limitations: ["knee injury"],
      confirmed: false,
    };

    const draft = createPlanDraft(spec);

    expect(draft.goal).toBe("fat_loss");
    expect(draft.daysPerWeek).toBe(5);
    expect(draft.sessionDurationMinutes).toBe(30);
    expect(draft.location).toBe("outdoor");
    expect(draft.equipment).toEqual(["jump rope"]);
    expect(draft.limitations).toEqual(["knee injury"]);
    expect(draft.confirmed).toBe(false);
  });
});