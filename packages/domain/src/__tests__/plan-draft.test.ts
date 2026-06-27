import { describe, it, expect } from "vitest";
import { createPlanDraft } from "@kinora/domain";
import type { PlanSpec, PlanGoal, TrainingLocation, PlanLimitation, PlanPreferenceScores } from "@kinora/contracts";

// Shared fixture helpers
function makeScores(overrides: Partial<PlanPreferenceScores> = {}): PlanPreferenceScores {
  return { strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3, ...overrides };
}

function makeLimitation(text: string): PlanLimitation {
  return { text, isWarning: true };
}

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
      preferenceScores: makeScores(),
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
      preferenceScores: makeScores(),
      confirmed: true,
    };

    const draft = createPlanDraft(spec);

    expect(draft.confirmed).toBe(false);
  });

  // --- Triangulation: different goal, location, equipment ---
  // Forces real logic, not hardcoded values

  it("echoes all spec fields and forces confirmed to false with different goal and location", () => {
    const limitations: PlanLimitation[] = [makeLimitation("knee injury")];
    const preferenceScores: PlanPreferenceScores = {
      strength: 0.4,
      hypertrophy: 0.5,
      endurance: 0.9,
      mobility: 0.4,
    };
    const spec: PlanSpec = {
      goal: "fat_loss",
      daysPerWeek: 5,
      sessionDurationMinutes: 30,
      location: "outdoor",
      equipment: ["jump rope"],
      limitations,
      preferenceScores,
      confirmed: false,
    };

    const draft = createPlanDraft(spec);

    expect(draft.goal).toBe("fat_loss");
    expect(draft.daysPerWeek).toBe(5);
    expect(draft.sessionDurationMinutes).toBe(30);
    expect(draft.location).toBe("outdoor");
    expect(draft.equipment).toEqual(["jump rope"]);
    expect(draft.limitations).toEqual(limitations);
    expect(draft.preferenceScores).toEqual(preferenceScores);
    expect(draft.confirmed).toBe(false);
  });

  it("includes location in the draft", () => {
    const spec: PlanSpec = {
      goal: "hypertrophy",
      daysPerWeek: 4,
      sessionDurationMinutes: 60,
      location: "home",
      equipment: ["resistance bands"],
      limitations: [],
      preferenceScores: makeScores({ strength: 0.6, hypertrophy: 0.9, endurance: 0.3 }),
      confirmed: false,
    };

    const draft = createPlanDraft(spec);

    expect(draft.location).toBe("home");
  });

  it("preserves limitations as PlanLimitation objects in the draft", () => {
    const limitations: PlanLimitation[] = [
      makeLimitation("knee pain"),
      makeLimitation("shoulder impingement"),
    ];
    const spec: PlanSpec = {
      goal: "general_fitness",
      daysPerWeek: 3,
      sessionDurationMinutes: 45,
      location: "gym",
      equipment: [],
      limitations,
      preferenceScores: makeScores({ strength: 0.4, mobility: 0.7 }),
      confirmed: false,
    };

    const draft = createPlanDraft(spec);

    expect(draft.limitations).toHaveLength(2);
    expect(draft.limitations[0]).toEqual({ text: "knee pain", isWarning: true });
    expect(draft.limitations[1]).toEqual({ text: "shoulder impingement", isWarning: true });
  });

  it("preserves preferenceScores in the draft", () => {
    const preferenceScores: PlanPreferenceScores = {
      strength: 0.8,
      hypertrophy: 0.5,
      endurance: 0.3,
      mobility: 0.4,
    };
    const spec: PlanSpec = {
      goal: "strength",
      daysPerWeek: 4,
      sessionDurationMinutes: 45,
      location: "gym",
      equipment: ["barbell"],
      limitations: [],
      preferenceScores,
      confirmed: false,
    };

    const draft = createPlanDraft(spec);

    expect(draft.preferenceScores).toEqual(preferenceScores);
  });
});
