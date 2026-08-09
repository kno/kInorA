import { describe, expect, it } from "vitest";
import {
  PLAN_NAME_MAX_LENGTH,
  normalizePlanName,
  validatePlanName,
} from "../plan-name.js";
import { defaultPlanName } from "../default-plan-name.js";

describe("validatePlanName (#415)", () => {
  it("accepts an ordinary name", () => {
    expect(validatePlanName("Summer Cut")).toEqual([]);
  });

  it("accepts a name that only needs trimming", () => {
    expect(validatePlanName("  Summer Cut  ")).toEqual([]);
  });

  it("rejects an empty name", () => {
    expect(validatePlanName("")).toEqual(["plan_name_empty"]);
  });

  // The whole point of rejecting rather than storing: a blank stored name is
  // resolved to a date label on read, so accepting "   " would silently name
  // the plan something the user never typed.
  it("rejects a whitespace-only name rather than letting the default layer rename the plan", () => {
    expect(validatePlanName("   \t\n ")).toEqual(["plan_name_empty"]);
    expect(defaultPlanName("   ", "2026-08-09T00:00:00.000Z")).toBe("Plan 2026-08-09");
  });

  it("accepts a name at exactly the column bound", () => {
    expect(validatePlanName("a".repeat(PLAN_NAME_MAX_LENGTH))).toEqual([]);
  });

  it("rejects a name one character past the column bound", () => {
    expect(validatePlanName("a".repeat(PLAN_NAME_MAX_LENGTH + 1))).toEqual(["plan_name_too_long"]);
  });

  // Length is measured on what would actually be stored, so padding is not
  // an overflow.
  it("measures length after trimming, so trailing padding is not too long", () => {
    const padded = `${"a".repeat(PLAN_NAME_MAX_LENGTH)}${" ".repeat(50)}`;
    expect(validatePlanName(padded)).toEqual([]);
  });

  it("matches the varchar(120) bound on workout_plans.name", () => {
    expect(PLAN_NAME_MAX_LENGTH).toBe(120);
  });
});

describe("normalizePlanName (#415)", () => {
  it("returns the trimmed value that gets stored", () => {
    expect(normalizePlanName("  Summer Cut  ")).toBe("Summer Cut");
  });

  it("collapses a whitespace-only name to the empty string validate rejects", () => {
    expect(normalizePlanName("   ")).toBe("");
  });
});
