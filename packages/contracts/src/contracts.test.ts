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
  StartSessionOutcome,
  TenantId,
  TenantQueryContextDTO,
  TrainingLocation,
  UserId,
  WorkoutPlanDetail,
  WorkoutPlanSummary,
  WorkoutProgram,
  WorkoutSessionRecord,
} from "./index";

describe("shared contracts boundary", () => {
  it("exports only the declared runtime values (Zod schemas + settled consts)", () => {
    // Before 08-v1-ai-plan-generation this package was type-only.
    // WorkoutProgramSchema is the first runtime export — required for
    // .withStructuredOutput(WorkoutProgramSchema) in the OpenRouter adapter.
    // MUSCLE_GROUPS (09c-v1-progress-dashboard-stats) is the settled 10-group
    // taxonomy const — see design.md "Muscle-group taxonomy".
    expect(Object.keys(contracts)).toEqual(["WorkoutProgramSchema", "MUSCLE_GROUPS"]);
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
      name?: string | null;
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

  // ---------------------------------------------------------------------------
  // 93-plan-navigation-and-start — day-scoped sessions + shared plan DTOs
  // ---------------------------------------------------------------------------

  it("exposes an optional numeric day on WorkoutSessionRecord (#93, additive)", () => {
    expectTypeOf<WorkoutSessionRecord>().toHaveProperty("day").toEqualTypeOf<
      number | undefined
    >();
  });

  it("defines the StartSessionOutcome discriminated union (#93)", () => {
    // started / resumed carry the session; conflict carries the active scope.
    const started: StartSessionOutcome = {
      kind: "started",
      session: {} as WorkoutSessionRecord,
    };
    const resumed: StartSessionOutcome = {
      kind: "resumed",
      session: {} as WorkoutSessionRecord,
    };
    const conflict: StartSessionOutcome = {
      kind: "conflict",
      activePlanId: "plan-1",
      activeDay: 2,
    };
    expect(started.kind).toBe("started");
    expect(resumed.kind).toBe("resumed");
    expect(conflict.kind).toBe("conflict");

    // The conflict branch narrows to the active-scope fields.
    if (conflict.kind === "conflict") {
      expectTypeOf(conflict.activePlanId).toEqualTypeOf<string>();
      expectTypeOf(conflict.activeDay).toEqualTypeOf<number | null>();
      expectTypeOf(conflict.activePlanName).toEqualTypeOf<string | undefined>();
    }
    // The started/resumed branch narrows to the session.
    if (started.kind === "started") {
      expectTypeOf(started.session).toEqualTypeOf<WorkoutSessionRecord>();
    }
  });

  it("defines shared plan DTOs with an optional name (#93, one source of truth)", () => {
    expectTypeOf<WorkoutPlanSummary>().toEqualTypeOf<{
      id: string;
      status: string;
      createdAt: string;
      name?: string;
    }>();
    expectTypeOf<WorkoutPlanDetail>().toEqualTypeOf<{
      id: string;
      status: string;
      program?: WorkoutProgram;
      specId: string;
      name?: string;
    }>();
  });
});
