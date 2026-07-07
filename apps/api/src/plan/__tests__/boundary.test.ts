import { describe, it, expect } from "vitest";
import { assertPlanSpecShape, assertPlanSpecInput } from "../boundary.js";
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

  // --- preferenceScores range validation [0, 1] ---

  it("rejects preferenceScores.strength above 1", () => {
    const invalid = {
      ...VALID_SPEC,
      preferenceScores: { strength: 1.5, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
    };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /preferenceScores\.strength.*\[0.*1\]|strength.*out of range|strength.*between/i
    );
  });

  it("rejects preferenceScores.strength below 0", () => {
    const invalid = {
      ...VALID_SPEC,
      preferenceScores: { strength: -0.1, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
    };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /preferenceScores\.strength.*\[0.*1\]|strength.*out of range|strength.*between/i
    );
  });

  it("rejects preferenceScores.hypertrophy out of range", () => {
    const invalid = {
      ...VALID_SPEC,
      preferenceScores: { strength: 0.9, hypertrophy: 1.1, endurance: 0.2, mobility: 0.3 },
    };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /preferenceScores\.hypertrophy.*\[0.*1\]|hypertrophy.*out of range|hypertrophy.*between/i
    );
  });

  it("rejects preferenceScores.endurance out of range", () => {
    const invalid = {
      ...VALID_SPEC,
      preferenceScores: { strength: 0.9, hypertrophy: 0.6, endurance: 2, mobility: 0.3 },
    };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /preferenceScores\.endurance.*\[0.*1\]|endurance.*out of range|endurance.*between/i
    );
  });

  it("rejects preferenceScores.mobility out of range", () => {
    const invalid = {
      ...VALID_SPEC,
      preferenceScores: { strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: -1 },
    };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /preferenceScores\.mobility.*\[0.*1\]|mobility.*out of range|mobility.*between/i
    );
  });

  it("accepts preferenceScores at boundary values 0 and 1", () => {
    const spec = {
      ...VALID_SPEC,
      preferenceScores: { strength: 0, hypertrophy: 1, endurance: 0, mobility: 1 },
    };
    expect(() => assertPlanSpecShape(spec as unknown as PlanSpec)).not.toThrow();
  });

  // --- equipment element type validation ---

  it("rejects equipment array containing a number element", () => {
    const invalid = { ...VALID_SPEC, equipment: [1] };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /equipment\[0\].*string/i
    );
  });

  it("rejects equipment array containing null", () => {
    const invalid = { ...VALID_SPEC, equipment: [null] };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /equipment\[0\].*string/i
    );
  });

  it("rejects equipment array containing an object", () => {
    const invalid = { ...VALID_SPEC, equipment: [{}] };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /equipment\[0\].*string/i
    );
  });

  it("rejects equipment array with mixed valid and invalid elements", () => {
    const invalid = { ...VALID_SPEC, equipment: ["barbell", 42, "dumbbells"] };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /equipment\[1\].*string/i
    );
  });

  it("accepts equipment array with multiple string elements", () => {
    const spec = { ...VALID_SPEC, equipment: ["barbell", "dumbbells", "kettlebell"] };
    expect(() => assertPlanSpecShape(spec as unknown as PlanSpec)).not.toThrow();
  });

  it("accepts empty equipment array", () => {
    const spec = { ...VALID_SPEC, equipment: [] };
    expect(() => assertPlanSpecShape(spec as unknown as PlanSpec)).not.toThrow();
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

  // --- optional plan name (#93) ---

  it("accepts a PlanSpec with a non-blank string name (#93)", () => {
    const spec = { ...VALID_SPEC, name: "Summer Cut" };
    expect(() => assertPlanSpecShape(spec)).not.toThrow();
  });

  it("accepts a PlanSpec with a null name (#93 — blank submission stored as null)", () => {
    const spec = { ...VALID_SPEC, name: null };
    expect(() => assertPlanSpecShape(spec)).not.toThrow();
  });

  it("accepts a PlanSpec with an absent name (#93 — legacy/optional)", () => {
    const { ...spec } = VALID_SPEC;
    expect(() => assertPlanSpecShape(spec)).not.toThrow();
  });

  it("rejects a PlanSpec with a non-string, non-null name (#93)", () => {
    const invalid = { ...VALID_SPEC, name: 42 };
    expect(() => assertPlanSpecShape(invalid as unknown as PlanSpec)).toThrow(
      /name.*string/i
    );
  });

  // #93: the boundary validates the name TYPE only. Length (VARCHAR(120)) is a
  // route concern surfaced as 422 plan_name_too_long — the shape validator does
  // NOT reject on length, so a name of any length passes the type check here.
  it("accepts a PlanSpec with a name of exactly 120 chars (#93)", () => {
    const spec = { ...VALID_SPEC, name: "a".repeat(120) };
    expect(() => assertPlanSpecShape(spec)).not.toThrow();
  });

  it("does not reject on length — an over-120-char name passes the type check (#93)", () => {
    const spec = { ...VALID_SPEC, name: "a".repeat(121) };
    expect(() => assertPlanSpecShape(spec)).not.toThrow();
  });

  // --- assertPlanSpecInput — input-only validator (no preferenceScores, no confirmed) ---

describe("assertPlanSpecInput — wizard input validator", () => {
  const VALID_INPUT = {
    goal: "strength",
    daysPerWeek: 3,
    sessionDurationMinutes: 60,
    location: "gym",
    equipment: ["barbell"],
    limitations: [{ text: "knee pain", isWarning: true }],
  };

  it("accepts a valid wizard input spec without preferenceScores or confirmed", () => {
    expect(() => assertPlanSpecInput(VALID_INPUT)).not.toThrow();
  });

  it("accepts input with empty equipment and limitations arrays", () => {
    expect(() =>
      assertPlanSpecInput({ ...VALID_INPUT, equipment: [], limitations: [] })
    ).not.toThrow();
  });

  it("does NOT require preferenceScores — accepts input without it", () => {
    const { ...input } = VALID_INPUT;
    expect(() => assertPlanSpecInput(input)).not.toThrow();
  });

  it("does NOT require confirmed — accepts input without it", () => {
    expect(() => assertPlanSpecInput(VALID_INPUT)).not.toThrow();
  });

  it("rejects null input", () => {
    expect(() => assertPlanSpecInput(null)).toThrow(/must be an object/i);
  });

  it("rejects missing goal", () => {
    const { goal: _, ...invalid } = VALID_INPUT;
    expect(() => assertPlanSpecInput(invalid)).toThrow(/goal.*string/i);
  });

  it("rejects goal as a number", () => {
    expect(() => assertPlanSpecInput({ ...VALID_INPUT, goal: 42 })).toThrow(/goal.*string/i);
  });

  it("rejects missing daysPerWeek", () => {
    const { daysPerWeek: _, ...invalid } = VALID_INPUT;
    expect(() => assertPlanSpecInput(invalid)).toThrow(/daysPerWeek.*number/i);
  });

  it("rejects daysPerWeek as a string", () => {
    expect(() => assertPlanSpecInput({ ...VALID_INPUT, daysPerWeek: "3" })).toThrow(/daysPerWeek.*number/i);
  });

  it("rejects missing sessionDurationMinutes", () => {
    const { sessionDurationMinutes: _, ...invalid } = VALID_INPUT;
    expect(() => assertPlanSpecInput(invalid)).toThrow(/sessionDurationMinutes.*number/i);
  });

  it("rejects missing location", () => {
    const { location: _, ...invalid } = VALID_INPUT;
    expect(() => assertPlanSpecInput(invalid)).toThrow(/location.*string/i);
  });

  it("rejects missing equipment (not an array)", () => {
    const { equipment: _, ...invalid } = VALID_INPUT;
    expect(() => assertPlanSpecInput(invalid)).toThrow(/equipment.*array/i);
  });

  it("rejects equipment containing a non-string element", () => {
    expect(() => assertPlanSpecInput({ ...VALID_INPUT, equipment: [1] })).toThrow(
      /equipment\[0\].*string/i
    );
  });

  it("rejects missing limitations (not an array)", () => {
    const { limitations: _, ...invalid } = VALID_INPUT;
    expect(() => assertPlanSpecInput(invalid)).toThrow(/limitations.*array/i);
  });

  it("rejects limitations item missing text", () => {
    expect(() =>
      assertPlanSpecInput({ ...VALID_INPUT, limitations: [{ isWarning: true }] })
    ).toThrow(/limitations\[0\].*text|text.*string/i);
  });

  it("rejects limitations item missing isWarning", () => {
    expect(() =>
      assertPlanSpecInput({ ...VALID_INPUT, limitations: [{ text: "knee pain" }] })
    ).toThrow(/limitations\[0\].*isWarning|isWarning.*boolean/i);
  });

  // #93: the route calls assertPlanSpecInput on the RAW draft, so the name TYPE
  // guarantee (string|null) is enforced HERE. Length (VARCHAR(120)) is NOT — it
  // is a route concern surfaced as a distinct 422 plan_name_too_long.
  it("accepts input with an absent name (#93 — optional)", () => {
    expect(() => assertPlanSpecInput(VALID_INPUT)).not.toThrow();
  });

  it("accepts input with a null name (#93)", () => {
    expect(() => assertPlanSpecInput({ ...VALID_INPUT, name: null })).not.toThrow();
  });

  it("accepts input with a non-blank string name (#93)", () => {
    expect(() =>
      assertPlanSpecInput({ ...VALID_INPUT, name: "Summer Cut" })
    ).not.toThrow();
  });

  it("accepts input with a name of exactly 120 chars (#93 boundary)", () => {
    expect(() =>
      assertPlanSpecInput({ ...VALID_INPUT, name: "a".repeat(120) })
    ).not.toThrow();
  });

  it("rejects input with a non-string, non-null name (#93)", () => {
    expect(() =>
      assertPlanSpecInput({ ...VALID_INPUT, name: 42 })
    ).toThrow(/name.*string/i);
  });

  it("does not reject input on length — length is a route (422) concern, not a boundary one (#93)", () => {
    expect(() =>
      assertPlanSpecInput({ ...VALID_INPUT, name: "a".repeat(121) })
    ).not.toThrow();
  });
});

});
