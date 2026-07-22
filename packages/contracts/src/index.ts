/**
 * Shared contract types for the kInorA monorepo.
 *
 * All workspace-internal types that cross app boundaries
 * MUST be defined here so both apps import from a single source of truth.
 *
 * No database imports are allowed in this package — only stable IDs,
 * DTOs, and cross-boundary types.
 */

// ---------------------------------------------------------------------------
// Workout plan types — 08-v1-ai-plan-generation
// Forward-compatible with 09a (session/exercise/planned-set tracking).
// ---------------------------------------------------------------------------

export type WorkoutPlanStatus = "generating" | "ready" | "failed";

export interface WorkoutExercise {
  name: string;
  sets: number;
  /** Rep range or count expressed as a string (e.g. "8-12" or "15"). */
  reps: string;
  restSeconds: number;
  notes?: string;
  substitutionNote?: string;
}

export interface WorkoutSession {
  /** Day number within the week (1-based). */
  day: number;
  title: string;
  exercises: WorkoutExercise[];
}

export interface WorkoutProgram {
  /** One session per training day; length equals daysPerWeek from PlanSpec. */
  weeklySessions: WorkoutSession[];
  limitationWarnings: string[];
}

export type WorkoutSessionRecordStatus = "active" | "completed";

export interface SetRecordDTO {
  id: string;
  sessionExerciseId: string;
  setIndex: number;
  targetReps: string;
  actualReps?: number;
  weightKg?: number;
  rpe?: number;
  completed: boolean;
  notes?: string;
}

export interface SessionExerciseRecord {
  id: string;
  workoutSessionId: string;
  exerciseIndex: number;
  title: string;
  restSeconds: number;
  notes?: string;
  setRecords: SetRecordDTO[];
}

export interface WorkoutSessionRecord {
  id: string;
  workoutPlanId: string;
  status: WorkoutSessionRecordStatus;
  exercises: SessionExerciseRecord[];
  startedAt: string;
  completedAt?: string;
  /**
   * Plan day this session is scoped to (#93). Optional/additive: pre-migration
   * sessions have no day and legacy DTO consumers keep compiling.
   */
  day?: number;
}

/**
 * Discriminated result of `startSession` (#93).
 *
 * `started` / `resumed` carry the session snapshot; `conflict` carries the
 * currently-active scope so the caller can render a localized banner instead
 * of silently resuming the wrong day or collapsing into a generic 404.
 */
export type StartSessionOutcome =
  | { kind: "started" | "resumed"; session: WorkoutSessionRecord }
  | {
      kind: "conflict";
      activePlanId: string;
      activePlanName?: string;
      activeDay: number | null;
    };

/**
 * Discriminated result of `deleteSession` (10c-workout-session-delete).
 *
 * `deleted` — a completed session owned by the caller was removed (cascading
 * FKs atomically drop its session_exercises + set_records). `not_found` — no
 * session matched the scoped (tenantId, userId, id) predicate; the caller
 * learns nothing about sessions they do not own. `active_conflict` — the
 * session exists and is in-progress; R3 requires the user to complete or
 * cancel it before deletion, surfaced as 409.
 */
export type DeleteSessionOutcome =
  | { kind: "deleted" }
  | { kind: "not_found" }
  | { kind: "active_conflict" };

/**
 * Shared plan list DTO (#93) — one source of truth for web and future mobile.
 * `name` is resolved server-side via `defaultPlanName(row.name, row.createdAt)`
 * before it reaches the contract, so clients receive a non-empty label.
 */
export interface WorkoutPlanSummary {
  id: string;
  status: string;
  createdAt: string;
  name?: string;
}

/**
 * Shared plan detail DTO (#93) — matches the client DTO consumed by the plan
 * page/selector. `name` is resolved server-side (see WorkoutPlanSummary).
 */
export interface WorkoutPlanDetail {
  id: string;
  status: string;
  program?: WorkoutProgram;
  specId: string;
  name?: string;
}

export { WorkoutProgramSchema } from "./workout-program.schema.js";

export interface HealthResponse {
  status: "ok";
}

export type PlanGoal = "strength" | "hypertrophy" | "fat_loss" | "general_fitness";

export type TrainingLocation = "home" | "gym" | "outdoor";

// ---------------------------------------------------------------------------
// User memory — structured profile + preferences (10a / 10b)
// User-scoped identity and training-context memory persisted per userId.
// These types are the cross-boundary shapes; enum value sets MUST mirror the
// database pgEnums defined in apps/api/src/db/schema.ts. `goal` reuses `PlanGoal`
// because the profile goal IS the plan-wizard goal — single source of truth.
// ---------------------------------------------------------------------------

/**
 * User experience level — mirrors the `experience_level` pgEnum.
 * Nullable on the stored row: a profile may exist with NULL until the user
 * chooses; UI MUST treat NULL as "unknown" rather than forcing a default.
 */
export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

/**
 * User profile DTO (10a-user-profile).
 * `name` is always present (NOT NULL, provisioned on registration from the
 * email prefix). `goal` and `experienceLevel` are nullable; NULL means
 * "not chosen yet", distinct from any default value.
 */
export interface UserProfile {
  userId: string;
  name: string;
  goal: PlanGoal | null;
  experienceLevel: ExperienceLevel | null;
}

/**
 * User preferences DTO (10b-user-preferences).
 * `defaultEquipment` is an array when non-null; an empty array `[]` is a
 * valid value ("visited the page, chose nothing"), distinct from NULL
 * ("never answered"). Stored as JSONB in the DB.
 */
export interface UserPreferences {
  userId: string;
  defaultLocation: string | null;
  defaultDuration: number | null;
  defaultEquipment: string[] | null;
}

/**
 * PUT /user-profile request body. `name` is required and MUST be non-blank;
 * caller-side validation rejects blank strings. `goal` and `experienceLevel`
 * are optional; omitted fields MUST leave the stored value unchanged.
 */
export interface UpdateProfileRequest {
  name: string;
  goal?: PlanGoal;
  experienceLevel?: ExperienceLevel;
}

/**
 * PUT /user-preferences request body. Every field is optional — the
 * endpoint is the canonical partial-update surface. Omitted fields MUST
 * leave the stored value unchanged (partial merge semantics live in the
 * repository, not here — the contract only declares what may be sent).
 */
export interface UpdatePreferencesRequest {
  defaultLocation?: string;
  defaultDuration?: number;
  defaultEquipment?: string[];
}

/**
 * Configurable default embedding metadata for 10b vector memory.
 * Stored in contracts so API slices can share one default without pushing
 * provider decisions into the domain package.
 */
export interface DefaultVectorMemoryEmbeddingConfig {
  provider: string;
  model: string;
  version: string;
  dimension: number;
}

export const DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG: DefaultVectorMemoryEmbeddingConfig = {
  provider: "openai",
  model: "text-embedding-3-small",
  // Provider-specific versioning is not separated yet, so the initial default
  // uses the configured model identifier as the compatible-version marker.
  version: "text-embedding-3-small",
  dimension: 1536,
};

export type UserMemoryStatus =
  | "candidate"
  | "confirmed"
  | "embedding_pending"
  | "active"
  | "rejected"
  | "failed"
  | "deleted";

export type UserMemoryEligibility =
  | "eligible"
  | "secret"
  | "raw_transcript"
  | "full_plan"
  | "sensitive_health"
  | "other";

export type UserMemoryConsentStatus = "granted" | "revoked";

/**
 * Shared DTO for user-controlled vector memory records.
 * Timestamp fields are ISO strings at the contract boundary.
 */
export interface UserMemory {
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
}

/**
 * Shared DTO for tenant+user scoped memory enablement.
 */
export interface MemorySettings {
  tenantId: TenantId;
  userId: UserId;
  enabled: boolean;
  settingsVersion: number;
  disabledAt?: string | null;
  updatedAt: string;
}

export interface PlanLimitation {
  text: string;
  isWarning: boolean;
}

export interface PlanPreferenceScores {
  strength: number;
  hypertrophy: number;
  endurance: number;
  mobility: number;
}

export interface PlanSpec {
  goal: PlanGoal;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  location: TrainingLocation;
  equipment: string[];
  limitations: PlanLimitation[];
  preferenceScores: PlanPreferenceScores;
  confirmed: boolean;
  /**
   * Optional user-supplied plan name (#93). Rides on the confirmed spec so it
   * survives the two-request promote → confirm flow: at generation time the
   * draft is already deleted, so `plan_specs.spec_json` is the only durable
   * carrier of the wizard-captured name. On generation it is copied to
   * `workout_plans.name`; the effective label is resolved on READ via
   * `defaultPlanName(name, createdAt)`. Nullable/optional: a blank submission
   * is stored as `null` so the date-based default stays dynamic. Never defaulted
   * at write time.
   */
  name?: string | null;
}

// ---------------------------------------------------------------------------
// Tenant contract types — stable IDs and context DTOs
// These types cross app boundaries without leaking database schema details.
// No Drizzle or pg imports are permitted here.
// ---------------------------------------------------------------------------

/**
 * Branded type for Tenant IDs.
 * Prevents accidental mixing with other UUID strings.
 */
export type TenantId = string & { readonly __brand: unique symbol };

/**
 * Branded type for User IDs.
 * Prevents accidental mixing with other UUID strings.
 */
export type UserId = string & { readonly __brand: unique symbol };

/**
 * Branded type for Membership IDs.
 * Prevents accidental mixing with other UUID strings.
 */
export type MembershipId = string & { readonly __brand: unique symbol };

/**
 * DTO for tenant-scoped query context crossing app boundaries.
 * Every repository method for tenant-owned data MUST receive this
 * and validate tenantId before reaching persistence.
 */
export interface TenantQueryContextDTO {
  tenantId: TenantId;
  actorUserId?: UserId;
}

/**
 * Membership role enum values — mirrors the database pgEnum.
 */
export type MembershipRole = "owner" | "member";

/**
 * Membership status enum values — mirrors the database pgEnum.
 */
export type MembershipStatus = "invited" | "active" | "suspended";

// ---------------------------------------------------------------------------
// Auth contract types — session identity and auth request/response DTOs
// These types cross app boundaries without leaking database schema details.
// No Drizzle or pg imports are permitted here.
// ---------------------------------------------------------------------------

/**
 * Branded type for Session IDs.
 * Prevents accidental mixing with other string IDs.
 */
export type SessionId = string & { readonly __brand: unique symbol };

/**
 * Authenticated request context attached to `request.authContext`.
 * Carries the session's user and tenant identity across boundaries.
 */
export interface SessionContext {
  userId: UserId;
  tenantId: TenantId;
  sessionId: SessionId;
}

/**
 * Email/password login request crossing the api boundary.
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Email/password registration request crossing the api boundary.
 */
export interface RegisterRequest {
  email: string;
  password: string;
}

/**
 * Provider-agnostic OIDC callback params received from an OAuth redirect.
 */
export interface OidcCallbackParams {
  code: string;
  state: string;
}

/**
 * Response to initiating a social (OIDC) login: the authorization URL the
 * caller should redirect the user-agent to, plus the opaque state the API
 * recorded to recover the provider on callback.
 */
export interface SocialLoginResponse {
  authorizationUrl: string;
  state: string;
}

/**
 * Session response returned by register, login, and social callback flows.
 * `token` is the opaque bearer token; `user` and `tenant` describe the
 * authenticated identity for the issued session.
 */
export interface SessionResponse {
  token: string;
  user: { id: UserId; email: string };
  tenant: { id: TenantId; name: string };
}

// ---------------------------------------------------------------------------
// Offline capture, reconnect sync & session history types — 09b-v1
// These are the cross-boundary shapes for the client-side mutation queue
// (web idb / mobile AsyncStorage), the session snapshot cache, connectivity
// detection, and the read-only session history aggregation. No Drizzle or
// idb/AsyncStorage/NetInfo imports are permitted here — this package stays
// runtime-agnostic; platform implementations live in each app.
// ---------------------------------------------------------------------------

/**
 * Input shape for recording/updating a workout set (PATCH /workout-sessions/:id/sets/:setId).
 * Single source of truth — web (`tracker-types.ts`) and mobile
 * (`apps/mobile/src/api/workout-session.ts`) currently hold local copies of
 * this shape; a later slice (PR 3/PR 4) migrates those call sites to import
 * from here instead of redefining it.
 */
export interface WorkoutSetUpdateInput {
  actualReps?: number;
  weightKg?: number;
  rpe?: number;
  completed: boolean;
  notes?: string;
}

/**
 * A single queued offline mutation, persisted client-side (idb on web,
 * AsyncStorage on mobile) before being flushed through the existing
 * idempotent write paths on reconnect.
 *
 * `clientSeq` is the monotonic, collision-free ordering + last-write-wins
 * tie-break key (persisted across app restart via a `lastClientSeq`
 * high-water-mark — never reset to 0 on load).
 *
 * `queuedAt` (wall-clock `Date.now()`) is diagnostics/FIFO-display only —
 * it MUST NOT be used for ordering or LWW decisions, since it can tie under
 * rapid taps at ~1ms resolution.
 */
export type PendingMutation =
  | {
      kind: "set";
      sessionId: string;
      setId: string;
      input: WorkoutSetUpdateInput;
      queuedAt: number;
      clientSeq: number;
    }
  | {
      kind: "complete";
      sessionId: string;
      queuedAt: number;
      clientSeq: number;
    };

/**
 * Local-store snapshot cache (idb / AsyncStorage) — the read-side complement
 * to the `PendingMutation` queue. Lets the tracker hydrate its UI from the
 * last-known server state (with queued mutations re-applied on top) during
 * an offline reload/restart, without requiring a network GET.
 */
export interface WorkoutSessionSnapshot {
  sessionId: string;
  session: WorkoutSessionRecord;
  cachedAt: number;
}

/**
 * Platform-agnostic connectivity detection port. Implementations are
 * necessarily platform-specific (`navigator.onLine` + online/offline events
 * on web; `@react-native-community/netinfo` on mobile) and live in each app;
 * only the shape is shared here.
 */
export interface ConnectivityMonitor {
  isOnline(): boolean;
  /** Registers a listener for connectivity changes; returns an unsubscribe function. */
  subscribe(cb: (online: boolean) => void): () => void;
}

/**
 * Discriminated flush-failure taxonomy, threaded through `unwrapWorkoutSession`
 * (web) and the mobile `workout-session.ts` API client, so the flush handler
 * on each platform can route retry/poison/stale-action decisions without
 * string-matching on `message`.
 *
 * - `UNREACHABLE`: network/offline error — retry, entry stays queued.
 * - `VALIDATION` / `NOT_FOUND`: 4xx poison-message — drop the entry, surface to the user.
 * - `AUTH`: 401/403 — the session expired or was revoked (or a membership was
 *   suspended) between enqueue and flush. Retryable, NOT poison-dropped (the
 *   mutation itself may be perfectly valid) — entry stays queued and the
 *   caller surfaces a "session expired — reload / sign in to sync" notice.
 * - `STALE_ACTION` (web only): stale Server Action reference on redeploy —
 *   entry stays queued, surface "reload to sync".
 * - `SERVER`: 5xx or unexpected failure — retryable, entry stays queued
 *   (never poison-dropped).
 */
export type FlushErrorCode =
  | "UNREACHABLE"
  | "STALE_ACTION"
  | "AUTH"
  | "VALIDATION"
  | "NOT_FOUND"
  | "SERVER";

/**
 * One entry in the paginated session history list. `trend` compares this
 * session vs. the immediately-prior completed session for the same
 * plan/exercise scope; `undefined` when there is no prior session (e.g. the
 * first session in scope).
 */
export interface WorkoutHistoryEntry {
  session: WorkoutSessionRecord;
  totalVolume: number;
  averageRpe?: number;
  trend?: { volumeDelta: number; direction: "up" | "down" | "flat" };
}

/**
 * Pagination contract for `GET /workout-sessions/history` — offset-based,
 * default page size 20 (both fields tunable by the caller).
 */
export interface WorkoutHistoryQuery {
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Progress dashboard, statistics & weekly overview types — 09c-v1.
// DTOs for the three read-only progress surfaces (dashboard, statistics,
// weekly plan board) plus exercise-detail history. No Drizzle imports.
// ---------------------------------------------------------------------------

/** The 10 primary muscle-group buckets (design.md "Muscle-group taxonomy"); mirrors the OpenDesign muscle library manifest. Composite/regional slugs are `MuscleRegion` below, never a distribution bucket. */
export const MUSCLE_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "core",
  "glutes",
  "quads",
  "hamstrings",
  "calves",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/** Composite/regional muscle slugs used for plan-focus grouping (e.g. a week-route day's "focus"). Distinct from `MuscleGroup` — never a statistics distribution bucket. */
export type MuscleRegion =
  | "upper-body"
  | "lower-body"
  | "full-body"
  | "push"
  | "pull"
  | "leg"
  | "posterior-chain"
  | "core-shoulders"
  | "chest-back"
  | "glutes-core"
  | "legs-core"
  | "shoulders-arms";

/** A single estimated-1RM personal record (Epley formula), keyed by normalized exercise title (design.md "Personal records"). */
export interface PersonalRecord {
  exerciseTitle: string;
  /** Estimated one-rep max in kg, computed via the Epley formula. */
  estimated1RM: number;
  /** ISO date the estimated 1RM was achieved. */
  achievedAt: string;
  /** Recent 1RM series (oldest → newest) plus a signed delta, for the sparkline. */
  trend?: { series: number[]; delta: number };
}

/** A KPI value paired with its delta vs. the previous period. `deltaVsPreviousPeriod` is `null` when the previous period has no data — never `Infinity`/`NaN` (design.md "KPI deltas"). */
export interface KpiWithDelta {
  value: number;
  deltaVsPreviousPeriod: number | null;
}

/** Dashboard summary DTO. Weekly progress is always measured in sessions, never any other unit (design.md "Dashboard"). */
export interface DashboardSummaryDTO {
  /** Consecutive calendar days (UTC) with at least one completed session. */
  streak: number;
  /** Recent per-day completion series backing the streak sparkline. */
  recentDailyCompletion: boolean[];
  /** Completed sessions in the current calendar week (UTC). */
  weeklyCompleted: number;
  /** Planned sessions for the current calendar week (UTC). */
  weeklyPlanned: number;
  /**
   * Per-planned-day load for the "Ruta de carga" week-route strip (Slice 2).
   * `dayIndex` is the 0-based Monday-first weekday index (0=Mon..6=Sun),
   * matching the plan's sequential day → weekday display convention
   * (design.md "Planned-day → weekday mapping"). Empty when there is no
   * active ready plan.
   */
  weeklyRollup: Array<{ dayIndex: number; focus?: string; loadKg: number; loadPercent: number }>;
}

/** Statistics summary DTO. Deliberately carries no adherence KPI (design.md "Adherence lives on the Dashboard, not Statistics"). */
export interface StatsSummaryDTO {
  range: "week" | "month" | "year";
  totalVolumeKg: KpiWithDelta;
  sessionCount: KpiWithDelta;
  totalDurationMin: KpiWithDelta;
  prCount: KpiWithDelta;
  /** Volume trend series for the current period vs. the previous period. */
  volumeTrend: { current: number[]; previous: number[] };
  /** Set count + volume per primary muscle group (10-group granularity). */
  muscleGroupDistribution: Array<{ muscleGroup: MuscleGroup; setCount: number; volumeKg: number }>;
  personalRecords: PersonalRecord[];
}

/** Exhaustive per-day status for the weekly plan board (no "missed" state). */
export type WeeklyDayStatus = "done" | "active" | "rest" | "soon";

/** Weekly overview DTO — the Monday–Sunday plan board with prev/next week navigation (design.md "The week model"). */
export interface WeeklyOverviewDTO {
  /** ISO date (Monday) of the displayed calendar week. */
  weekStart: string;
  /** Human-facing week label (e.g. "8–14 jun"). */
  weekLabel: string;
  days: Array<{ date: string; status: WeeklyDayStatus; focus?: string }>;
  /** ISO date (Monday) of the previous/next week, for navigation. */
  previousWeekStart: string;
  nextWeekStart: string;
}

/** Exercise detail DTO — read-only recent-history reference. Omitted entirely (design.md "Exercise detail") when no history exists. */
export interface ExerciseDetailDTO {
  exerciseTitle: string;
  recentSets: Array<{ completedAt: string; weightKg?: number; actualReps?: number; rpe?: number }>;
}
