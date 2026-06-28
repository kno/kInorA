import { describe, expect, expectTypeOf, it } from "vitest";
import * as contracts from "./index";
import type {
  HealthResponse,
  LoginRequest,
  MembershipRole,
  MembershipStatus,
  OidcCallbackParams,
  PlanGoal,
  PlanLimitation,
  PlanPreferenceScores,
  PlanSpec,
  RegisterRequest,
  SessionContext,
  SessionId,
  SessionResponse,
  TenantId,
  TenantQueryContextDTO,
  TrainingLocation,
  UserId,
} from "./index";

describe("shared contracts boundary", () => {
  it("exports only the declared runtime values (Zod schemas)", () => {
    // Before 08-v1-ai-plan-generation this package was type-only.
    // WorkoutProgramSchema is the first runtime export — required for
    // .withStructuredOutput(WorkoutProgramSchema) in the OpenRouter adapter.
    expect(Object.keys(contracts)).toEqual(["WorkoutProgramSchema"]);
  });

  it("defines the health response contract", () => {
    expectTypeOf<HealthResponse>().toEqualTypeOf<{ status: "ok" }>();
  });

  it("defines the plan spec contract shared by apps", () => {
    expectTypeOf<PlanGoal>().toEqualTypeOf<
      "strength" | "hypertrophy" | "fat_loss" | "general_fitness"
    >();
    expectTypeOf<TrainingLocation>().toEqualTypeOf<"home" | "gym" | "outdoor">();
    expectTypeOf<PlanLimitation>().toEqualTypeOf<{ text: string; isWarning: boolean }>();
    expectTypeOf<PlanPreferenceScores>().toEqualTypeOf<{
      strength: number;
      hypertrophy: number;
      endurance: number;
      mobility: number;
    }>();
    expectTypeOf<PlanSpec>().toEqualTypeOf<{
      goal: PlanGoal;
      daysPerWeek: number;
      sessionDurationMinutes: number;
      location: TrainingLocation;
      equipment: string[];
      limitations: PlanLimitation[];
      preferenceScores: PlanPreferenceScores;
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

  it("defines auth session contracts with branded session id", () => {
    // SessionId is a branded string: assignable to string, but a plain
    // string is NOT assignable to SessionId (prevents accidental mixing).
    expectTypeOf<SessionId>().toMatchTypeOf<string>();
    expectTypeOf<string>().not.toMatchTypeOf<SessionId>();

    expectTypeOf<SessionContext>().toEqualTypeOf<{
      userId: UserId;
      tenantId: TenantId;
      sessionId: SessionId;
    }>();
  });

  it("defines auth request DTOs crossing app boundaries", () => {
    expectTypeOf<LoginRequest>().toEqualTypeOf<{ email: string; password: string }>();
    expectTypeOf<RegisterRequest>().toEqualTypeOf<{ email: string; password: string }>();
    expectTypeOf<OidcCallbackParams>().toEqualTypeOf<{ code: string; state: string }>();
  });

  it("defines the session response contract returned by auth flows", () => {
    expectTypeOf<SessionResponse>().toEqualTypeOf<{
      token: string;
      user: { id: UserId; email: string };
      tenant: { id: TenantId; name: string };
    }>();
  });
});
