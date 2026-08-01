import { describe, expect, expectTypeOf, it } from "vitest";
import * as contracts from "./index";
import type {
  AdaptationSignalSource,
  AdaptationLevel,
  AdherenceSnapshot,
  IntensityBias,
  RpeSnapshot,
  SuggestedChange,
  AdaptationRecommendation,
  DashboardSummaryDTO,
  CreateUserMemoryRequest,
  CreateUserMemoryResponse,
  DefaultVectorMemoryEmbeddingConfig,
  DeleteUserMemoryResponse,
  HealthResponse,
  ListUserMemoriesResponse,
  LoginRequest,
  MemorySettings,
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
  DeleteSessionOutcome,
  StartSessionOutcome,
  TenantId,
  TenantQueryContextDTO,
  TrainingLocation,
  UpdateMemorySettingsRequest,
  UserMemory,
  UserMemoryConsentStatus,
  UserMemoryEligibility,
  UserMemoryStatus,
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
    // BILLING_FEATURES (#181 billing-correctness) is the single source of truth
    // for the BillingFeature union — routes/billing.ts imports it directly.
    // PlanSpecDraftSchema (12-interactive-text-chat) is the Zod contract for a
    // per-turn extracted Partial<PlanSpec> over the six wizard input fields.
    expect(Object.keys(contracts)).toEqual([
      "WorkoutProgramSchema",
      "DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG",
      "BILLING_FEATURES",
      "MUSCLE_GROUPS",
      "PlanSpecDraftSchema",
    ]);
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
      intensityBias?: IntensityBias;
      branding?: {
        trainerName?: string | null;
        title?: string | null;
        accentColor?: string | null;
      };
    }>();
  });

  it("defines tenant context contracts without database schema leakage", () => {
    expectTypeOf<TenantQueryContextDTO>().toHaveProperty("tenantId").toBeString();
    expectTypeOf<TenantQueryContextDTO>().toHaveProperty("actorUserId").toMatchTypeOf<
      string | undefined
    >();
    // 15a-v2-trainer-account-access Slice 1: additive 'trainer' role value.
    expectTypeOf<MembershipRole>().toEqualTypeOf<"owner" | "member" | "trainer">();
    expectTypeOf<MembershipStatus>().toEqualTypeOf<"invited" | "active" | "suspended">();
  });

  it("defines auth session contracts with branded session id", () => {
    // SessionId is a branded string: assignable to string, but a plain
    // string is NOT assignable to SessionId (prevents accidental mixing).
    expectTypeOf<SessionId>().toMatchTypeOf<string>();
    expectTypeOf<string>().not.toMatchTypeOf<SessionId>();

    // 15a-v2-trainer-account-access Slice 2: additive 'role' field, populated
    // from the fail-secure membership re-check (zero extra query).
    expectTypeOf<SessionContext>().toEqualTypeOf<{
      userId: UserId;
      tenantId: TenantId;
      sessionId: SessionId;
      role: MembershipRole;
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

  it("defines the DeleteSessionOutcome discriminated union (10c-workout-session-delete)", () => {
    const deleted: DeleteSessionOutcome = { kind: "deleted" };
    const notFound: DeleteSessionOutcome = { kind: "not_found" };
    const activeConflict: DeleteSessionOutcome = { kind: "active_conflict" };

    expect(deleted.kind).toBe("deleted");
    expect(notFound.kind).toBe("not_found");
    expect(activeConflict.kind).toBe("active_conflict");

    // Narrowing: each variant carries no extra payload.
    if (activeConflict.kind === "active_conflict") {
      expectTypeOf<keyof typeof activeConflict>().toEqualTypeOf<"kind">();
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

  it("defines vector-memory lifecycle and ownership contracts", () => {
    expectTypeOf<UserMemoryStatus>().toEqualTypeOf<
      | "candidate"
      | "confirmed"
      | "embedding_pending"
      | "active"
      | "rejected"
      | "failed"
      | "deleted"
    >();
    expectTypeOf<UserMemoryEligibility>().toEqualTypeOf<
      | "eligible"
      | "secret"
      | "raw_transcript"
      | "full_plan"
      | "sensitive_health"
      | "other"
    >();
    expectTypeOf<UserMemoryConsentStatus>().toEqualTypeOf<"granted" | "revoked">();
    expectTypeOf<UserMemory>().toEqualTypeOf<{
      id: string;
      tenantId: TenantId;
      userId: UserId;
      summary: string;
      source: string;
      status: UserMemoryStatus;
      eligibility: UserMemoryEligibility;
      consentStatus: UserMemoryConsentStatus;
      consentedAt: string;
      revokedAt?: string | null;
      disabledAt?: string | null;
      deletedAt?: string | null;
      idempotencyKey: string;
      fingerprint: string;
      schemaVersion: string;
      embeddingProvider: string;
      embeddingModel: string;
      embeddingVersion: string;
      embeddingDimension: number;
      createdAt: string;
      updatedAt: string;
    }>();
    expectTypeOf<MemorySettings>().toEqualTypeOf<{
      tenantId: TenantId;
      userId: UserId;
      enabled: boolean;
      settingsVersion: number;
      disabledAt?: string | null;
      updatedAt: string;
    }>();
    expectTypeOf<CreateUserMemoryRequest>().toEqualTypeOf<{
      factText: string;
      source: string;
      idempotencyKey: string;
    }>();
    expectTypeOf<CreateUserMemoryResponse>().toEqualTypeOf<{
      memory: UserMemory;
    }>();
    expectTypeOf<ListUserMemoriesResponse>().toEqualTypeOf<{
      settings: MemorySettings;
      memories: UserMemory[];
    }>();
    expectTypeOf<UpdateMemorySettingsRequest>().toEqualTypeOf<{
      enabled: boolean;
    }>();
    expectTypeOf<DeleteUserMemoryResponse>().toEqualTypeOf<{
      deleted: true;
    }>();
  });

  // ---------------------------------------------------------------------------
  // 14a-v1.1-adaptation-adherence — shared, type-only adaptation contract
  // ---------------------------------------------------------------------------

  it("defines the type-only AdaptationRecommendation contract (14a adherence + 14b rpe)", () => {
    expectTypeOf<AdaptationSignalSource>().toEqualTypeOf<"adherence" | "rpe">();
    expectTypeOf<AdaptationLevel>().toEqualTypeOf<"ok" | "low" | "insufficient_data">();

    expectTypeOf<AdherenceSnapshot>().toEqualTypeOf<{
      adherence: number;
      periodWeeks: number;
      completedInWindow: number;
      plannedInWindow: number;
    }>();

    expectTypeOf<IntensityBias>().toEqualTypeOf<"reduce" | "maintain" | "increase">();

    expectTypeOf<RpeSnapshot>().toEqualTypeOf<{
      meanRpe: number;
      windowSessions: number;
      sessionsWithRpe: number;
      setsWithRpe: number;
    }>();

    // 14b adds the `adjust_load` member to the union.
    expectTypeOf<SuggestedChange>().toEqualTypeOf<
      | { kind: "reduce_frequency"; fromDays: number; toDays: number }
      | { kind: "adjust_load"; direction: "increase" | "decrease"; from: IntensityBias; to: IntensityBias }
    >();

    expectTypeOf<AdaptationRecommendation>().toEqualTypeOf<{
      source: AdaptationSignalSource;
      level: AdaptationLevel;
      suggestedChange?: SuggestedChange;
      rationaleKey?: string;
      planSpecId?: string;
      adherence?: AdherenceSnapshot;
      rpe?: RpeSnapshot;
    }>();
  });

  it("adds an optional adaptation field to DashboardSummaryDTO (additive, type-only)", () => {
    expectTypeOf<DashboardSummaryDTO>()
      .toHaveProperty("adaptation")
      .toEqualTypeOf<AdaptationRecommendation | undefined>();
  });

  it("adds an optional viewerIsTrainer field to DashboardSummaryDTO (15b/#294, additive, type-only)", () => {
    expectTypeOf<DashboardSummaryDTO>().toHaveProperty("viewerIsTrainer").toEqualTypeOf<boolean | undefined>();
  });

  it("adds an optional intensityBias field to PlanSpec (14b; absent = maintain)", () => {
    expectTypeOf<PlanSpec>().toHaveProperty("intensityBias").toEqualTypeOf<IntensityBias | undefined>();
  });

  it("exposes the configurable default vector embedding metadata", () => {
    expectTypeOf<DefaultVectorMemoryEmbeddingConfig>().toEqualTypeOf<{
      provider: string;
      model: string;
      version: string;
      dimension: number;
    }>();

    expect(contracts.DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG).toMatchObject({
      provider: "openai",
      model: "text-embedding-3-small",
      version: "text-embedding-3-small",
      dimension: 1536,
    });
  });
});
