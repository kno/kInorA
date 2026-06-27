import { describe, it, expect } from "vitest";
import { assertPlanSpecShape } from "../src/plan/boundary";
import type { PlanSpec } from "@kinora/contracts";

// Base preferenceScores for reuse in fixtures
const SCORES = { strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 };

describe("assertPlanSpecShape", () => {
  // --- Scenario: Contract reused by API and web (Req 2) ---

  it("accepts a valid PlanSpec", () => {
    const validSpec: PlanSpec = {
      goal: "strength",
      daysPerWeek: 3,
      sessionDurationMinutes: 45,
      location: "gym",
      equipment: ["barbell"],
      limitations: [],
      preferenceScores: SCORES,
      confirmed: false,
    };

    // Should not throw for valid spec
    expect(() => assertPlanSpecShape(validSpec)).not.toThrow();
  });

  it("rejects input missing the goal field", () => {
    const invalid = {
      daysPerWeek: 3,
      sessionDurationMinutes: 45,
      location: "gym",
      equipment: [],
      limitations: [],
      preferenceScores: SCORES,
      confirmed: false,
    };

    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow();
  });

  // --- Triangle: confirmed is non-boolean ---

  it("rejects input with confirmed as a string instead of boolean", () => {
    const invalid = {
      goal: "strength",
      daysPerWeek: 3,
      sessionDurationMinutes: 45,
      location: "gym",
      equipment: ["barbell"],
      limitations: [],
      preferenceScores: SCORES,
      confirmed: "yes", // wrong type
    };

    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /confirmed must be a boolean/i
    );
  });

  it.each([
    [null, /must be an object/i],
    ["not-an-object", /must be an object/i],
    [{ goal: "strength", daysPerWeek: "3", sessionDurationMinutes: 45, location: "gym", equipment: [], limitations: [], preferenceScores: SCORES, confirmed: false }, /daysPerWeek must be a number/i],
    [{ goal: "strength", daysPerWeek: 3, sessionDurationMinutes: "45", location: "gym", equipment: [], limitations: [], preferenceScores: SCORES, confirmed: false }, /sessionDurationMinutes must be a number/i],
    [{ goal: "strength", daysPerWeek: 3, sessionDurationMinutes: 45, location: 123, equipment: [], limitations: [], preferenceScores: SCORES, confirmed: false }, /location must be a string/i],
    [{ goal: "strength", daysPerWeek: 3, sessionDurationMinutes: 45, location: "gym", equipment: "barbell", limitations: [], preferenceScores: SCORES, confirmed: false }, /equipment must be an array/i],
    [{ goal: "strength", daysPerWeek: 3, sessionDurationMinutes: 45, location: "gym", equipment: [], limitations: "none", preferenceScores: SCORES, confirmed: false }, /limitations must be an array/i],
  ])("rejects invalid PlanSpec shape %#", (invalid, expectedError) => {
    expect(() => assertPlanSpecShape(invalid)).toThrow(expectedError);
  });
});
