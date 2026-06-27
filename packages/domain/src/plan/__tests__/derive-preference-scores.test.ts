import { describe, it, expect } from "vitest";
import { derivePreferenceScores } from "../derive-preference-scores.js";
import type { PlanGoal } from "@kinora/contracts";

// Helper type matching the subset of PlanSpec the function needs
type Input = {
  goal: PlanGoal;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  location: "home" | "gym" | "outdoor";
  equipment: string[];
  limitations: Array<{ text: string; isWarning: boolean }>;
};

// Base case — no modifiers apply: 3 days, 60 min, gym, non-empty equipment, no limitations
describe("derivePreferenceScores — base table (no modifiers)", () => {
  const BASE: Omit<Input, "goal"> = {
    daysPerWeek: 3,
    sessionDurationMinutes: 60,
    location: "gym",
    equipment: ["barbell"],
    limitations: [],
  };

  it('goal="strength" → {strength:0.9, hypertrophy:0.6, endurance:0.2, mobility:0.3}', () => {
    const result = derivePreferenceScores({ ...BASE, goal: "strength" });
    expect(result).toEqual({ strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 });
  });

  it('goal="hypertrophy" → {strength:0.6, hypertrophy:0.9, endurance:0.3, mobility:0.3}', () => {
    const result = derivePreferenceScores({ ...BASE, goal: "hypertrophy" });
    expect(result).toEqual({ strength: 0.6, hypertrophy: 0.9, endurance: 0.3, mobility: 0.3 });
  });

  it('goal="fat_loss" → {strength:0.4, hypertrophy:0.5, endurance:0.9, mobility:0.4}', () => {
    const result = derivePreferenceScores({ ...BASE, goal: "fat_loss" });
    expect(result).toEqual({ strength: 0.4, hypertrophy: 0.5, endurance: 0.9, mobility: 0.4 });
  });

  it('goal="general_fitness" → {strength:0.5, hypertrophy:0.5, endurance:0.6, mobility:0.6}', () => {
    const result = derivePreferenceScores({ ...BASE, goal: "general_fitness" });
    expect(result).toEqual({ strength: 0.5, hypertrophy: 0.5, endurance: 0.6, mobility: 0.6 });
  });
});

// Design reference example
describe("derivePreferenceScores — design reference example", () => {
  it('strength/3/60/gym/barbell/[] → {strength:0.9, hypertrophy:0.6, endurance:0.2, mobility:0.3}', () => {
    const result = derivePreferenceScores({
      goal: "strength",
      daysPerWeek: 3,
      sessionDurationMinutes: 60,
      location: "gym",
      equipment: ["barbell"],
      limitations: [],
    });
    expect(result).toEqual({ strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 });
  });
});

// Individual modifier tests — isolate each modifier from base (strength, 3 days, 60 min, gym, barbell, [])
describe("derivePreferenceScores — modifiers", () => {
  const STRENGTH_BASE: Input = {
    goal: "strength",
    daysPerWeek: 3,
    sessionDurationMinutes: 60,
    location: "gym",
    equipment: ["barbell"],
    limitations: [],
  };

  it("daysPerWeek>=5 adds endurance +0.1", () => {
    const result = derivePreferenceScores({ ...STRENGTH_BASE, daysPerWeek: 5 });
    // base: {0.9, 0.6, 0.2, 0.3}, endurance+0.1 → 0.3
    expect(result).toEqual({ strength: 0.9, hypertrophy: 0.6, endurance: 0.3, mobility: 0.3 });
  });

  it("sessionDurationMinutes<=30 adds endurance +0.1 and subtracts hypertrophy -0.1", () => {
    const result = derivePreferenceScores({ ...STRENGTH_BASE, sessionDurationMinutes: 30 });
    // base: {0.9, 0.6, 0.2, 0.3}, endurance+0.1→0.3, hypertrophy-0.1→0.5
    expect(result).toEqual({ strength: 0.9, hypertrophy: 0.5, endurance: 0.3, mobility: 0.3 });
  });

  it('location==="outdoor" adds endurance +0.1 and mobility +0.1', () => {
    const result = derivePreferenceScores({ ...STRENGTH_BASE, location: "outdoor" });
    // base: {0.9, 0.6, 0.2, 0.3}, endurance+0.1→0.3, mobility+0.1→0.4
    expect(result).toEqual({ strength: 0.9, hypertrophy: 0.6, endurance: 0.3, mobility: 0.4 });
  });

  it("empty equipment subtracts strength -0.1 and adds mobility +0.1", () => {
    const result = derivePreferenceScores({ ...STRENGTH_BASE, equipment: [] });
    // base: {0.9, 0.6, 0.2, 0.3}, strength-0.1→0.8, mobility+0.1→0.4
    expect(result).toEqual({ strength: 0.8, hypertrophy: 0.6, endurance: 0.2, mobility: 0.4 });
  });

  it("any limitations adds mobility +0.1", () => {
    const result = derivePreferenceScores({
      ...STRENGTH_BASE,
      limitations: [{ text: "knee pain", isWarning: true }],
    });
    // base: {0.9, 0.6, 0.2, 0.3}, mobility+0.1→0.4
    expect(result).toEqual({ strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.4 });
  });
});

// Combined modifiers
describe("derivePreferenceScores — combined modifiers", () => {
  it("all modifiers active simultaneously", () => {
    // goal=strength base: {0.9, 0.6, 0.2, 0.3}
    // daysPerWeek=5: endurance+0.1 → 0.3
    // sessionDurationMinutes=25: endurance+0.1→0.4, hypertrophy-0.1→0.5
    // location=outdoor: endurance+0.1→0.5, mobility+0.1→0.4
    // equipment=[]: strength-0.1→0.8, mobility+0.1→0.5
    // limitations=[{...}]: mobility+0.1→0.6
    const result = derivePreferenceScores({
      goal: "strength",
      daysPerWeek: 5,
      sessionDurationMinutes: 25,
      location: "outdoor",
      equipment: [],
      limitations: [{ text: "back injury", isWarning: true }],
    });
    expect(result).toEqual({ strength: 0.8, hypertrophy: 0.5, endurance: 0.5, mobility: 0.6 });
  });
});

// Clamp tests — values must never exceed 0 or go below 0 after modifiers
describe("derivePreferenceScores — clamping", () => {
  it("result values never exceed 1.0", () => {
    // fat_loss base endurance=0.9; add daysPerWeek>=5 (+0.1)=1.0; sessionDuration<=30 (+0.1)=1.1 → clamped to 1.0
    const result = derivePreferenceScores({
      goal: "fat_loss",
      daysPerWeek: 5,
      sessionDurationMinutes: 30,
      location: "gym",
      equipment: ["jump rope"],
      limitations: [],
    });
    expect(result.endurance).toBeLessThanOrEqual(1);
    expect(result.endurance).toBe(1);
  });

  it("result values never go below 0", () => {
    // general_fitness base strength=0.5; fat_loss base might go lower, but let's use strength with all subtracting modifiers
    // strength base strength=0.9; only equipment empty subtracts strength -0.1 → 0.8 (won't go below 0)
    // Use general_fitness + empty equipment: strength=0.5-0.1=0.4
    const result = derivePreferenceScores({
      goal: "general_fitness",
      daysPerWeek: 3,
      sessionDurationMinutes: 60,
      location: "gym",
      equipment: [],
      limitations: [],
    });
    expect(result.strength).toBeGreaterThanOrEqual(0);
    expect(result.strength).toBe(0.4);
  });

  it("all result values are rounded to 2 decimal places", () => {
    const result = derivePreferenceScores({
      goal: "general_fitness",
      daysPerWeek: 5,
      sessionDurationMinutes: 30,
      location: "outdoor",
      equipment: [],
      limitations: [{ text: "wrist pain", isWarning: true }],
    });
    // Check all values are max 2 decimal places
    for (const key of ["strength", "hypertrophy", "endurance", "mobility"] as const) {
      const val = result[key];
      expect(Number(val.toFixed(2))).toBe(val);
    }
  });
});
