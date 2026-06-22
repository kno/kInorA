import { describe, expect, expectTypeOf, it } from "vitest";
import * as contracts from "./index";
import type {
  HealthResponse,
  LoginRequest,
  MembershipRole,
  MembershipStatus,
  OidcCallbackParams,
  PlanGoal,
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
    expectTypeOf<TenantQueryContextDTO>().toHaveProperty("actorUserId").toEqualTypeOf<
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
