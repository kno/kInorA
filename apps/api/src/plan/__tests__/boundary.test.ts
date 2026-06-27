import { describe, it, expect } from "vitest";
import { assertPlanSpecShape } from "../boundary.js";
import type { PlanSpec } from "@kinora/contracts";

// Valid PlanSpec fixture using the new shape (limitations as PlanLimitation[], with preferenceScores)
const VALID_SPEC: PlanSpec = {
  goal: "strength",
  daysPerWeek: 3,
  sessionDurationMinutes: 45,
  location: "gym",
  equipment: ["barbell"],
  limitations: [{ text: "knee pain", isWarning: true }],
  preferenceScores: { strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
  confirmed: false,
};

describe("assertPlanSpecShape — updated for 07-v1-plan-wizard", () => {
  it("accepts a valid PlanSpec with new limitations and preferenceScores shape", () => {
    expect(() => assertPlanSpecShape(VALID_SPEC)).not.toThrow();
  });

  it("accepts PlanSpec with empty limitations array", () => {
    const spec = { ...VALID_SPEC, limitations: [] };
    expect(() => assertPlanSpecShape(spec)).not.toThrow();
  });

  it("accepts PlanSpec with multiple PlanLimitation objects", () => {
    const spec = {
      ...VALID_SPEC,
      limitations: [
        { text: "knee pain", isWarning: true },
        { text: "shoulder impingement", isWarning: false },
      ],
    };
    expect(() => assertPlanSpecShape(spec)).not.toThrow();
  });

  // --- limitations shape validation ---

  it("rejects limitations as a plain string array (old shape)", () => {
    const invalid = { ...VALID_SPEC, limitations: ["knee pain"] };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /limitations\[0\].*text.*isWarning|limitations must be an array of/i
    );
  });

  it("rejects limitations items missing the text field", () => {
    const invalid = { ...VALID_SPEC, limitations: [{ isWarning: true }] };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /limitations\[0\].*text|text.*string/i
    );
  });

  it("rejects limitations items missing the isWarning field", () => {
    const invalid = { ...VALID_SPEC, limitations: [{ text: "knee pain" }] };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /limitations\[0\].*isWarning|isWarning.*boolean/i
    );
  });

  it("rejects limitations where isWarning is not a boolean", () => {
    const invalid = { ...VALID_SPEC, limitations: [{ text: "knee pain", isWarning: "yes" }] };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /isWarning.*boolean/i
    );
  });

  it("rejects limitations where text is not a string", () => {
    const invalid = { ...VALID_SPEC, limitations: [{ text: 42, isWarning: true }] };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /text.*string/i
    );
  });

  // --- preferenceScores shape validation ---

  it("rejects PlanSpec missing preferenceScores", () => {
    const { preferenceScores: _, ...invalid } = VALID_SPEC;
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /preferenceScores/i
    );
  });

  it("rejects preferenceScores missing strength", () => {
    const invalid = {
      ...VALID_SPEC,
      preferenceScores: { hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
    };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /preferenceScores\.strength|strength.*number/i
    );
  });

  it("rejects preferenceScores missing hypertrophy", () => {
    const invalid = {
      ...VALID_SPEC,
      preferenceScores: { strength: 0.9, endurance: 0.2, mobility: 0.3 },
    };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /preferenceScores\.hypertrophy|hypertrophy.*number/i
    );
  });

  it("rejects preferenceScores missing endurance", () => {
    const invalid = {
      ...VALID_SPEC,
      preferenceScores: { strength: 0.9, hypertrophy: 0.6, mobility: 0.3 },
    };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /preferenceScores\.endurance|endurance.*number/i
    );
  });

  it("rejects preferenceScores missing mobility", () => {
    const invalid = {
      ...VALID_SPEC,
      preferenceScores: { strength: 0.9, hypertrophy: 0.6, endurance: 0.2 },
    };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /preferenceScores\.mobility|mobility.*number/i
    );
  });

  it("rejects preferenceScores where strength is not a number", () => {
    const invalid = {
      ...VALID_SPEC,
      preferenceScores: { strength: "high", hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
    };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /strength.*number/i
    );
  });

  // --- Existing validations still work ---

  it("rejects null input", () => {
    expect(() => assertPlanSpecShape(null)).toThrow(/must be an object/i);
  });

  it("rejects input missing goal", () => {
    const { goal: _, ...invalid } = VALID_SPEC;
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /goal.*string/i
    );
  });

  it("rejects input with confirmed as a string instead of boolean", () => {
    const invalid = { ...VALID_SPEC, confirmed: "yes" };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /confirmed must be a boolean/i
    );
  });

  // --- 08 atomic coupling: PlanLimitation[] shape handled in boundary ---
  // Coordinate comment: change 08 (ai-plan-generation) reads PlanSpec.limitations
  // as PlanLimitation[] — this boundary.ts validates the same shape for both
  // 07 (wizard confirm) and 08 (consumption). Both changes share this boundary file.
  it("PlanLimitation[] shape accepted: 08 consumer coupling verified", () => {
    const spec08: PlanSpec = {
      goal: "hypertrophy",
      daysPerWeek: 4,
      sessionDurationMinutes: 60,
      location: "home",
      equipment: ["dumbbells"],
      limitations: [{ text: "wrist injury", isWarning: true }],
      preferenceScores: { strength: 0.6, hypertrophy: 0.9, endurance: 0.3, mobility: 0.3 },
      confirmed: true,
    };
    expect(() => assertPlanSpecShape(spec08)).not.toThrow();
  });
});
