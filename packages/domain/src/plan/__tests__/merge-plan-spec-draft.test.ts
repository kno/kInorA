import { describe, expect, it } from "vitest";
import type { PlanSpecDraft } from "@kinora/contracts";
import { mergePlanSpecDraft, PLAN_SPEC_DRAFT_INPUT_FIELDS } from "../merge-plan-spec-draft.js";

const emptyDraft: PlanSpecDraft = {};

describe("mergePlanSpecDraft", () => {
  it("merges a full valid extraction onto an empty draft", () => {
    const extracted: PlanSpecDraft = {
      goal: "hypertrophy",
      daysPerWeek: 4,
      sessionDurationMinutes: 60,
      location: "gym",
      equipment: ["dumbbells"],
      limitations: [{ text: "lower back pain", isWarning: true }],
      name: "My plan",
    };
    const { draft, missingFields } = mergePlanSpecDraft(emptyDraft, extracted);
    expect(draft).toEqual(extracted);
    expect(missingFields).toEqual([]);
  });

  it("never writes preferenceScores or confirmed even if present on the input", () => {
    const dirty = {
      goal: "strength",
      preferenceScores: { strength: 1, hypertrophy: 0, endurance: 0, mobility: 0 },
      confirmed: true,
    } as unknown as PlanSpecDraft;
    const { draft } = mergePlanSpecDraft(emptyDraft, dirty);
    expect(draft).not.toHaveProperty("preferenceScores");
    expect(draft).not.toHaveProperty("confirmed");
    expect(draft.goal).toBe("strength");
  });

  it("drops an invalid goal enum and leaves the draft field unchanged", () => {
    const current: PlanSpecDraft = { goal: "strength" };
    const { draft } = mergePlanSpecDraft(current, {
      goal: "powerlifting",
    } as unknown as PlanSpecDraft);
    expect(draft.goal).toBe("strength");
  });

  it("drops an invalid location enum silently", () => {
    const { draft } = mergePlanSpecDraft(emptyDraft, {
      location: "moon",
    } as unknown as PlanSpecDraft);
    expect(draft.location).toBeUndefined();
  });

  it("drops an out-of-range duration (below the 15-minute floor)", () => {
    const { draft } = mergePlanSpecDraft(emptyDraft, { sessionDurationMinutes: 10 });
    expect(draft.sessionDurationMinutes).toBeUndefined();
  });

  it("drops an out-of-range duration (above the 240-minute ceiling)", () => {
    const current: PlanSpecDraft = { sessionDurationMinutes: 60 };
    const { draft } = mergePlanSpecDraft(current, { sessionDurationMinutes: 300 });
    expect(draft.sessionDurationMinutes).toBe(60);
  });

  it("drops a fractional duration", () => {
    const { draft } = mergePlanSpecDraft(emptyDraft, { sessionDurationMinutes: 60.5 });
    expect(draft.sessionDurationMinutes).toBeUndefined();
  });

  it("keeps an in-range duration at the exact bounds", () => {
    expect(mergePlanSpecDraft(emptyDraft, { sessionDurationMinutes: 15 }).draft.sessionDurationMinutes).toBe(15);
    expect(mergePlanSpecDraft(emptyDraft, { sessionDurationMinutes: 240 }).draft.sessionDurationMinutes).toBe(240);
  });

  it("drops daysPerWeek outside 1..7", () => {
    expect(mergePlanSpecDraft(emptyDraft, { daysPerWeek: 0 }).draft.daysPerWeek).toBeUndefined();
    expect(mergePlanSpecDraft(emptyDraft, { daysPerWeek: 8 }).draft.daysPerWeek).toBeUndefined();
  });

  it("drops a non-array equipment field", () => {
    const { draft } = mergePlanSpecDraft(emptyDraft, {
      equipment: "dumbbells",
    } as unknown as PlanSpecDraft);
    expect(draft.equipment).toBeUndefined();
  });

  it("drops equipment when any item is not a string", () => {
    const { draft } = mergePlanSpecDraft(emptyDraft, {
      equipment: ["dumbbells", 5],
    } as unknown as PlanSpecDraft);
    expect(draft.equipment).toBeUndefined();
  });

  it("drops malformed limitations entries", () => {
    const { draft } = mergePlanSpecDraft(emptyDraft, {
      limitations: [{ text: "x" }],
    } as unknown as PlanSpecDraft);
    expect(draft.limitations).toBeUndefined();
  });

  it("merges only the valid fields from a mixed valid/invalid extraction", () => {
    const { draft } = mergePlanSpecDraft(emptyDraft, {
      goal: "fat_loss",
      daysPerWeek: 99,
      location: "home",
    } as unknown as PlanSpecDraft);
    expect(draft.goal).toBe("fat_loss");
    expect(draft.location).toBe("home");
    expect(draft.daysPerWeek).toBeUndefined();
  });

  it("leaves the draft unchanged on an empty extraction", () => {
    const current: PlanSpecDraft = { goal: "strength", daysPerWeek: 3 };
    const { draft } = mergePlanSpecDraft(current, {});
    expect(draft).toEqual(current);
  });

  it("does not mutate the input current draft", () => {
    const current: PlanSpecDraft = { goal: "strength" };
    mergePlanSpecDraft(current, { daysPerWeek: 4 });
    expect(current).toEqual({ goal: "strength" });
  });

  it("computes missingFields as the input fields still absent after merge", () => {
    const current: PlanSpecDraft = { goal: "strength", location: "gym" };
    const { missingFields } = mergePlanSpecDraft(current, { daysPerWeek: 4 });
    expect(missingFields.sort()).toEqual(
      ["sessionDurationMinutes", "equipment", "limitations"].sort(),
    );
  });

  it("lists all six input fields as missing for an empty draft and empty extraction", () => {
    const { missingFields } = mergePlanSpecDraft(emptyDraft, {});
    expect(missingFields.sort()).toEqual([...PLAN_SPEC_DRAFT_INPUT_FIELDS].sort());
  });

  it("does not count name toward missingFields", () => {
    const full: PlanSpecDraft = {
      goal: "strength",
      daysPerWeek: 3,
      sessionDurationMinutes: 45,
      location: "home",
      equipment: [],
      limitations: [],
    };
    const { missingFields } = mergePlanSpecDraft(full, {});
    expect(missingFields).toEqual([]);
  });

  it("a valid extracted field overrides the current value", () => {
    const current: PlanSpecDraft = { daysPerWeek: 4 };
    const { draft } = mergePlanSpecDraft(current, { daysPerWeek: 3 });
    expect(draft.daysPerWeek).toBe(3);
  });
});
