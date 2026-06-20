import { describe, it, expect } from "vitest";
import { assertPlanSpecShape } from "../src/plan/boundary";
import type { PlanSpec } from "@kinora/contracts";

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
      confirmed: "yes", // wrong type
    };

    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /confirmed must be a boolean/i
    );
  });
});