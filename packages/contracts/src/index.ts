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
}

export { WorkoutProgramSchema } from "./workout-program.schema.js";

export interface HealthResponse {
  status: "ok";
}

export type PlanGoal = "strength" | "hypertrophy" | "fat_loss" | "general_fitness";

export type TrainingLocation = "home" | "gym" | "outdoor";

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
