import { describe, expect, expectTypeOf, it } from "vitest";
import * as contracts from "./index";
import type {
  HealthResponse,
  MembershipRole,
  MembershipStatus,
  PlanGoal,
  PlanSpec,
  TenantQueryContextDTO,
  TrainingLocation,
} from "./index";

describe("shared contracts boundary", () => {
  it("keeps the package honest as a type-only boundary", () => {
    expect(Object.keys(contracts)).toEqual([]);
  });

  it("defines the health response contract", () => {
    expectTypeOf<HealthResponse>().toEqualTypeOf<{ status: "ok" }>();
  });

  it("defines the plan spec contract shared by apps", () => {
    expectTypeOf<PlanGoal>().toEqualTypeOf<
      "strength" | "hypertrophy" | "fat_loss" | "general_fitness"
    >();
    expectTypeOf<TrainingLocation>().toEqualTypeOf<"home" | "gym" | "outdoor">();
    expectTypeOf<PlanSpec>().toEqualTypeOf<{
      goal: PlanGoal;
      daysPerWeek: number;
      sessionDurationMinutes: number;
      location: TrainingLocation;
      equipment: string[];
      limitations: string[];
      confirmed: boolean;
    }>();
  });

  it("defines tenant context contracts without database schema leakage", () => {
    expectTypeOf<TenantQueryContextDTO>().toHaveProperty("tenantId").toBeString();
    expectTypeOf<TenantQueryContextDTO>().toHaveProperty("actorUserId").toMatchTypeOf<
      string | undefined
    >();
    expectTypeOf<MembershipRole>().toEqualTypeOf<"owner" | "member">();
    expectTypeOf<MembershipStatus>().toEqualTypeOf<"invited" | "active" | "suspended">();
  });
});
