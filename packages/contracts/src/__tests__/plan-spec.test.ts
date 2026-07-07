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

  // #93: the optional plan name rides on the confirmed spec (spec_json) so it
  // survives the two-request promote → confirm flow. It is the durable carrier
  // between promote (POST /plan-specs) and generation (POST /plan-specs/:id/confirm),
  // where the draft is already deleted. It is nullable so a blank submission is
  // stored as null and the date-based default is resolved on read.
  it("PlanSpec includes an optional nullable name (#93)", () => {
    expectTypeOf<PlanSpec>().toHaveProperty("name").toEqualTypeOf<string | null | undefined>();
  });

  it("PlanSpec full shape with all required fields plus optional name", () => {
    expectTypeOf<PlanSpec>().toEqualTypeOf<{
      goal: import("../index").PlanGoal;
      daysPerWeek: number;
      sessionDurationMinutes: number;
      location: TrainingLocation;
      equipment: string[];
      limitations: PlanLimitation[];
      preferenceScores: PlanPreferenceScores;
      confirmed: boolean;
      name?: string | null;
    }>();
  });
});
