import { describe, expect, it } from "vitest";
import { PlanSpecDraftSchema } from "../index";
import type { PlanSpecDraft } from "../index";

/**
 * Guard for the conversational create-plan draft contract (12-interactive-text-chat, S1).
 *
 * PlanSpecDraftSchema is a Zod schema over ONLY the six wizard INPUT fields
 * plus an optional `name`. It MUST NOT carry `preferenceScores` (derived
 * server-side by `derivePreferenceScores`) or `confirmed`.
 */
describe("PlanSpecDraftSchema", () => {
  it("exposes exactly the six input fields plus optional name", () => {
    expect(Object.keys(PlanSpecDraftSchema.shape).sort()).toEqual(
      [
        "daysPerWeek",
        "equipment",
        "goal",
        "limitations",
        "location",
        "name",
        "sessionDurationMinutes",
      ].sort(),
    );
  });

  it("NEVER declares preferenceScores or confirmed", () => {
    expect(PlanSpecDraftSchema.shape).not.toHaveProperty("preferenceScores");
    expect(PlanSpecDraftSchema.shape).not.toHaveProperty("confirmed");
  });

  it("accepts a full valid draft of the six input fields + name", () => {
    const input = {
      goal: "hypertrophy",
      daysPerWeek: 4,
      sessionDurationMinutes: 60,
      location: "gym",
      equipment: ["dumbbells", "barbell"],
      limitations: [{ text: "lower back pain", isWarning: true }],
      name: "My plan",
    };
    const result = PlanSpecDraftSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts an empty partial draft (all fields optional)", () => {
    expect(PlanSpecDraftSchema.safeParse({}).success).toBe(true);
  });

  it("strips unknown keys such as preferenceScores and confirmed on parse", () => {
    const result = PlanSpecDraftSchema.parse({
      goal: "strength",
      preferenceScores: { strength: 1, hypertrophy: 0, endurance: 0, mobility: 0 },
      confirmed: true,
    });
    expect(result).not.toHaveProperty("preferenceScores");
    expect(result).not.toHaveProperty("confirmed");
    expect(result.goal).toBe("strength");
  });

  it("rejects a goal outside PlanGoal", () => {
    expect(PlanSpecDraftSchema.safeParse({ goal: "powerlifting" }).success).toBe(false);
  });

  it("rejects a location outside TrainingLocation", () => {
    expect(PlanSpecDraftSchema.safeParse({ location: "moon" }).success).toBe(false);
  });

  it("accepts every valid PlanGoal", () => {
    for (const goal of ["strength", "hypertrophy", "fat_loss", "general_fitness"]) {
      expect(PlanSpecDraftSchema.safeParse({ goal }).success).toBe(true);
    }
  });

  it("accepts every valid TrainingLocation", () => {
    for (const location of ["home", "gym", "outdoor"]) {
      expect(PlanSpecDraftSchema.safeParse({ location }).success).toBe(true);
    }
  });

  it("bounds sessionDurationMinutes to 15..240 inclusive", () => {
    expect(PlanSpecDraftSchema.safeParse({ sessionDurationMinutes: 15 }).success).toBe(true);
    expect(PlanSpecDraftSchema.safeParse({ sessionDurationMinutes: 240 }).success).toBe(true);
    expect(PlanSpecDraftSchema.safeParse({ sessionDurationMinutes: 14 }).success).toBe(false);
    expect(PlanSpecDraftSchema.safeParse({ sessionDurationMinutes: 241 }).success).toBe(false);
    expect(PlanSpecDraftSchema.safeParse({ sessionDurationMinutes: 60.5 }).success).toBe(false);
  });

  it("bounds daysPerWeek to 1..7 integers", () => {
    expect(PlanSpecDraftSchema.safeParse({ daysPerWeek: 1 }).success).toBe(true);
    expect(PlanSpecDraftSchema.safeParse({ daysPerWeek: 7 }).success).toBe(true);
    expect(PlanSpecDraftSchema.safeParse({ daysPerWeek: 0 }).success).toBe(false);
    expect(PlanSpecDraftSchema.safeParse({ daysPerWeek: 8 }).success).toBe(false);
  });

  it("requires limitations entries to be { text, isWarning }", () => {
    expect(
      PlanSpecDraftSchema.safeParse({ limitations: [{ text: "x", isWarning: false }] }).success,
    ).toBe(true);
    expect(PlanSpecDraftSchema.safeParse({ limitations: [{ text: "x" }] }).success).toBe(false);
  });

  it("allows name to be null (blank submission carrier)", () => {
    expect(PlanSpecDraftSchema.safeParse({ name: null }).success).toBe(true);
  });

  it("infers PlanSpecDraft with all-optional input fields", () => {
    const draft: PlanSpecDraft = {};
    expect(draft).toEqual({});
  });
});
