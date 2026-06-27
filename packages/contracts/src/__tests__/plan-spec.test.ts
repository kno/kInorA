import { describe, it, expectTypeOf } from "vitest";
import type {
  PlanLimitation,
  PlanPreferenceScores,
  PlanSpec,
  TrainingLocation,
} from "../index";

describe("PlanSpec contract types (07-v1-plan-wizard)", () => {
  it("PlanLimitation has text:string and isWarning:boolean", () => {
    expectTypeOf<PlanLimitation>().toEqualTypeOf<{
      text: string;
      isWarning: boolean;
    }>();
  });

  it("PlanPreferenceScores has four numeric keys: strength, hypertrophy, endurance, mobility", () => {
    expectTypeOf<PlanPreferenceScores>().toEqualTypeOf<{
      strength: number;
      hypertrophy: number;
      endurance: number;
      mobility: number;
    }>();
  });

  it("PlanSpec includes location: TrainingLocation", () => {
    expectTypeOf<PlanSpec>().toHaveProperty("location").toEqualTypeOf<TrainingLocation>();
  });

  it("PlanSpec includes limitations: PlanLimitation[]", () => {
    expectTypeOf<PlanSpec>().toHaveProperty("limitations").toEqualTypeOf<PlanLimitation[]>();
  });

  it("PlanSpec includes preferenceScores: PlanPreferenceScores", () => {
    expectTypeOf<PlanSpec>().toHaveProperty("preferenceScores").toEqualTypeOf<PlanPreferenceScores>();
  });

  it("PlanSpec full shape with all required fields", () => {
    expectTypeOf<PlanSpec>().toEqualTypeOf<{
      goal: import("../index").PlanGoal;
      daysPerWeek: number;
      sessionDurationMinutes: number;
      location: TrainingLocation;
      equipment: string[];
      limitations: PlanLimitation[];
      preferenceScores: PlanPreferenceScores;
      confirmed: boolean;
    }>();
  });
});
