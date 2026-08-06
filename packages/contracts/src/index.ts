/**
 * Shared contract types for the kInorA monorepo.
 *
 * All workspace-internal types that cross app boundaries
 * MUST be defined here so both apps import from a single source of truth.
 *
 * No database imports are allowed in this package — only stable IDs,
 * DTOs, and cross-boundary types.
 */

import { z } from "zod";

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
  /**
   * Exercise-catalog id this exercise was resolved to (#352 slice B), or absent
   * when the prescribed `name` matched no catalog record.
   *
   * SERVER-SET ONLY, and deliberately absent from `WorkoutExerciseSchema`. That
   * schema is what `.withStructuredOutput(...)` hands the model, and #357 was
   * caused by exactly this shape: an optional undescribed string there is an
   * invitation the model accepts, filling it with plausible junk. The server
   * writes this field AFTER the structured-output parse, so the model never
   * sees it and can never author it.
   *
   * `name` remains the authoritative snapshot of what the user was prescribed
   * and is NEVER rewritten to the catalog's spelling — the catalog may change,
   * the prescription may not.
   */
  catalogId?: string;
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
  /**
   * Exercise-catalog id this row's `title` resolves to (#352 slice A), or
   * absent when it resolves to nothing.
   *
   * DERIVED AT READ TIME, never stored: `session_exercises` has no such column
   * and deliberately gains none. The row's `title` is a snapshot of what was
   * prescribed, so persisting a resolution would freeze a guess taken with
   * whatever catalog and matcher happened to be deployed that day; deriving it
   * on every read means a better catalog or matcher improves every historical
   * session at once, and a wrong link can be withdrawn by fixing the resolver.
   *
   * Consumers MUST degrade silently when it is absent — no link, no placeholder.
   */
  catalogExerciseId?: string;
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
  /**
   * TTS opt-out preference (13-v1.1-interactive-voice-chat, A3). Additive and
   * backward-compatible — omitting it still validates. Semantics: `null` or
   * `true` → TTS enabled (opt-out default is ON); `false` → the user has opted
   * out and the client MUST NOT request or play TTS audio.
   */
  ttsEnabled?: boolean | null;
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

export interface CreateUserMemoryRequest {
  factText: string;
  source: string;
  idempotencyKey: string;
}

export interface CreateUserMemoryResponse {
  memory: UserMemory;
}

export interface ListUserMemoriesResponse {
  settings: MemorySettings;
  memories: UserMemory[];
}

export interface UpdateMemorySettingsRequest {
  enabled: boolean;
}

export interface DeleteUserMemoryResponse {
  deleted: true;
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
  /**
   * Server-authoritative load bias (14b-v1.1). Absent = `"maintain"` — a
   * legacy/pre-14b spec is untouched (no migration needed; back-compat by
   * construction). Written ONLY via the `/adapt` LOAD confirm branch, never
   * by the wizard; the generator prompt (`buildPlanPrompt`) consumes it to
   * steer intensity up/down. Mirrors how `daysPerWeek` is the frequency lever.
   */
  intensityBias?: IntensityBias;
  /**
   * Optional trainer-authored plan branding (15b-v2 S3). Rides on the
   * confirmed spec (`spec_json`) the same way `name`/`intensityBias` do — no
   * new table, no migration. Authored at plan-creation time via the
   * client-owned plan-create route (`POST /clients/:clientUserId/plan-specs`);
   * absent means the plan renders unbranded (safe rollback). `accentColor`
   * MUST be a `^#[0-9a-fA-F]{6}$` hex string when present (validated at the
   * boundary, see `apps/api/src/plan/boundary.ts`); `trainerName`/`title` are
   * capped at 60 characters.
   */
  branding?: PlanBranding;
}

/**
 * Trainer-authored plan branding (15b-v2 S3/S4). Named export so both the
 * web `--plan-accent` CSS-var renderer and the mobile accent-prop seam (S4)
 * can reference the exact same client-safe shape as `PlanSpec.branding`,
 * without redefining it locally in each app. Pure data — no rendering
 * concerns live here.
 */
export interface PlanBranding {
  trainerName?: string | null;
  title?: string | null;
  accentColor?: string | null;
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
 * `trainer` (15a-v2-trainer-account-access, Slice 1) is additive: it is not
 * yet gated or granted anywhere — the authorization seam that checks it lands
 * in Slice 2.
 */
export type MembershipRole = "owner" | "member" | "trainer";

/**
 * Membership status enum values — mirrors the database pgEnum.
 */
export type MembershipStatus = "invited" | "active" | "suspended";

/**
 * `trainer` (15a-v2-trainer-account-access, Slice 1) is additive: entitlement
 * plumbing (`resolveTenantFeatureLimit`) knows about it, but no route gates a
 * capability on it yet — that lands with the authorization seam in Slice 2.
 *
 * `gym` (16a-v3-gym-white-label, Slice 1) is additive: entitlement plumbing
 * knows about it, but no route grants or gates a capability on it yet — the
 * `assertGymEntitled` authorization seam lands in Slice 3.
 */
export type BillingTier = "free" | "pro" | "trainer" | "gym";

export type BillingStatus = "active" | "trialing" | "expired" | "overridden";

export type BillingSource = "system" | "backfill" | "admin_override" | "stripe";

/**
 * Billing cycle for a paid Stripe subscription (11b-v1-billing-stripe-integration).
 * Monthly and annual map to two config-driven Stripe Prices; both, once paid,
 * resolve to the `pro` tier. Null on Free/trial tenants that have no cycle.
 */
export type BillingCycle = "monthly" | "annual";

/**
 * The billing-metered features. SINGLE source of truth: the `BillingFeature`
 * union is derived from this const array so runtime validation (e.g. the route
 * allow-list) and the compile-time type can never drift when a feature is added.
 */
export const BILLING_FEATURES = [
  "plan_generation",
  "plan_regeneration",
  "memory_write",
  "memory_retrieval",
] as const;

export type BillingFeature = (typeof BILLING_FEATURES)[number];

export type BillingDenialReason =
  | "operation_key_required"
  | "inactive_membership"
  | "billing_state_unavailable"
  | "premium_required"
  | "trial_expired"
  | "subscription_ended"
  | "tenant_quota_exhausted"
  | "member_allocation_exhausted"
  | "allocation_out_of_bounds"
  | "unauthorized_quota_admin";

export interface TenantBillingStateDTO {
  tenantId: TenantId;
  tier: BillingTier;
  status: BillingStatus;
  source: BillingSource;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  activeOverrideEndsAt: string | null;
  updatedAt: string;
  /**
   * Additive Stripe subscription metadata (11b-v1). Pure metadata: the tier is
   * still resolved by the server's entitlement logic, never from these fields.
   * OPTIONAL in Slice 1 so the existing 11a visibility mapper compiles and
   * emits an unchanged response (zero behavior change); the webhook/web slices
   * populate them. `billingCycle`/`currentPeriodEnd` are null when there is no
   * paid Stripe subscription; `cancelAtPeriodEnd` defaults to false.
   */
  billingCycle?: BillingCycle | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}

// ---------------------------------------------------------------------------
// Stripe billing flow DTOs (11b-v1-billing-stripe-integration).
// Type-only scaffolding so later slices (checkout, portal, invoices) compile.
// No card/PAN data crosses this boundary.
// ---------------------------------------------------------------------------

/**
 * Request to start a Stripe-hosted checkout for a Pro upgrade. The tenant is
 * NEVER supplied here — it is derived server-side from `authContext`.
 */
export interface CheckoutSessionRequest {
  cycle: BillingCycle;
  promotionCode?: string;
}

/** Response carrying the Stripe-hosted checkout URL to redirect the user to. */
export interface CheckoutSessionResponse {
  url: string;
}

/** Response carrying the Stripe-hosted Customer Portal URL. */
export interface PortalSessionResponse {
  url: string;
}

/**
 * Privacy-safe invoice projection read live from Stripe. Contains NO full card
 * number (PAN) — only the display brand and last four digits, if present.
 */
export interface InvoiceDTO {
  id: string;
  amountDue: number;
  currency: string;
  status: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
  receiptUrl: string | null;
  cardBrand?: string;
  cardLast4?: string;
}

/**
 * Config-driven display pricing for one billing cycle (11b-v1 Slice 5). Amounts
 * are in the currency's MINOR unit (e.g. cents), sourced server-side from the
 * Stripe pricing configuration — never hardcoded in the web bundle.
 */
export interface BillingCyclePriceDTO {
  cycle: BillingCycle;
  /** Amount attributed to a single month, in minor units (e.g. 999 = 9,99 €). */
  amountPerMonth: number;
  /**
   * Amount charged per billing interval, in minor units. Equal to
   * `amountPerMonth` for the monthly cycle; `amountPerMonth * 12` for annual.
   */
  amountPerInterval: number;
}

/**
 * Config-driven billing pricing surfaced to the web billing screen (11b-v1
 * Slice 5). The displayed prices and the save badge derive from this DTO, which
 * the API builds from its Stripe pricing config — the web NEVER hardcodes
 * amounts or the save percentage.
 */
export interface BillingPricingDTO {
  /** ISO 4217 currency code, lowercase (e.g. "eur"). */
  currency: string;
  monthly: BillingCyclePriceDTO;
  annual: BillingCyclePriceDTO;
  /** Derived: round((1 - annualPerMonth / monthlyPerMonth) * 100). */
  annualSavePercent: number;
}

export interface TenantQuotaUsageDTO {
  feature: BillingFeature;
  period: string;
  used: number;
  limit: number;
}

export interface MemberQuotaUsageDTO {
  userId: UserId;
  feature: BillingFeature;
  period: string;
  used: number;
  limit: number;
}

export interface BillingVisibilityDTO {
  billing: TenantBillingStateDTO;
  tenantUsage: TenantQuotaUsageDTO[];
  memberUsage: MemberQuotaUsageDTO[];
  denialReason?: BillingDenialReason;
  upgradePromptPath?: string;
}

export interface SetMemberAllocationRequest {
  userId: UserId;
  feature: BillingFeature;
  period: string;
  limit: number;
}

/**
 * A single member allocation as returned after a quota-admin write. Counts/limits
 * only — never any member memory, prompt, health, or generated private content.
 */
export interface MemberAllocationDTO {
  userId: UserId;
  feature: BillingFeature;
  period: string;
  limit: number;
}

export interface SetMemberAllocationResponse {
  allocation: MemberAllocationDTO;
}

/**
 * Owner/trainer quota-administration usage report for one tenant + period.
 * Privacy boundary: exposes ONLY aggregate tenant counts and per-member usage
 * counts (integers/enums). It MUST NOT carry member memories, prompts, health
 * details, generated private content, or any cross-tenant data.
 */
export interface TenantUsageReportDTO {
  tenantUsage: TenantQuotaUsageDTO[];
  memberUsage: MemberQuotaUsageDTO[];
}

export interface CreateAdminOverrideRequest {
  tier: BillingTier;
  startsAt: string;
  endsAt: string;
  reason: string;
}

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
 *
 * `role` (15a-v2-trainer-account-access, Slice 2) is populated from the
 * membership row the fail-secure re-check already fetches per request — zero
 * extra query. It is the input `resolveAuthorizedOwner` and `requireRole`
 * gate on; it never widens access by itself.
 */
export interface SessionContext {
  userId: UserId;
  tenantId: TenantId;
  sessionId: SessionId;
  role: MembershipRole;
}

// ---------------------------------------------------------------------------
// Trainer account access contracts (15a-v2-trainer-account-access, Slice 1).
// Additive DTOs for the same-tenant trainer/client assignment. No route or
// authorization behavior change lands in this slice — see design.md.
// ---------------------------------------------------------------------------

/**
 * Lifecycle of a `trainer_client_assignments` row — mirrors the database
 * pgEnum `trainer_assignment_status`.
 *   invited  — the trainer has invited the client, not yet accepted
 *   active   — the client accepted; the trainer may act on their behalf
 *   revoked  — the assignment no longer grants access (kept for audit)
 */
export type TrainerAssignmentStatus = "invited" | "active" | "revoked";

/**
 * A trainer/client assignment record. One-trainer-per-client is enforced at
 * the data layer (partial unique index on `client_user_id` where
 * `status <> 'revoked'`), not by this DTO shape.
 */
export interface TrainerClientAssignmentDTO {
  id: string;
  tenantId: TenantId;
  trainerUserId: UserId;
  clientUserId: UserId;
  status: TrainerAssignmentStatus;
}

/**
 * Request payload to invite a client by email into the trainer's tenant.
 * Wired to a route in Slice 3 — this is type-only scaffolding in Slice 1.
 */
export interface InviteClientRequest {
  email: string;
}

/**
 * Trainer-facing client-list row. Wired to a route in Slice 3.
 */
export interface ClientSummaryDTO {
  clientUserId: UserId;
  email: string;
  status: TrainerAssignmentStatus;
}

/**
 * Gym white-label branding palette (16a-v3-gym-white-label, Slice 1). Each
 * token is either a `^#[0-9a-fA-F]{6}$` hex string or `null` when the tenant
 * has not configured that field — themed surfaces fall back to
 * `var(--gym-x, var(--default))` for any `null` token (S4/S5). Validated at
 * the application layer by `apps/api/src/branding/palette.ts` before any
 * write and mirrored by a DB CHECK constraint on `tenant_branding`.
 */
export interface BrandingPalette {
  accent: string | null;
  accentFg: string | null;
  surface: string | null;
  surface2: string | null;
  fg: string | null;
  muted: string | null;
}

/**
 * A tenant's branding configuration (16a-v3-gym-white-label, Slice 1). Type-
 * only scaffolding in Slice 1 — no route reads or writes this shape yet; the
 * gated CRUD route lands in Slice 3, and `logoUrl` is populated once the
 * Slice 2 `ObjectStoragePort` upload route exists.
 */
export interface TenantBrandingDTO {
  tenantId: TenantId;
  subdomainSlug: string;
  logoUrl: string | null;
  palette: BrandingPalette;
}

/**
 * Response payload for a successful logo upload (16a-v3-gym-white-label,
 * Slice 2's `POST /branding/logo`). Type-only scaffolding in Slice 1.
 */
export interface LogoUploadResponseDTO {
  logoUrl: string;
}

/**
 * Request body for `PUT /branding` (16a-v3-gym-white-label, Slice 3) — the
 * gym owner's own-tenant branding upsert. `subdomainSlug` is required (the
 * table column is `NOT NULL` + unique-indexed); `palette` is validated by
 * `apps/api/src/branding/palette.ts` before any write.
 */
export interface UpdateBrandingRequest {
  subdomainSlug: string;
  palette: BrandingPalette;
}

/**
 * Response payload for the PUBLIC, unauthenticated `GET
 * /public/branding/by-slug/:slug` (16a-v3-gym-white-label, Slice 3).
 * Deliberately excludes `tenantId` and `subdomainSlug` — only the fields a
 * pre-auth login page needs to theme itself, no PII, no internal ids.
 */
export interface PublicBrandingDTO {
  logoUrl: string | null;
  palette: BrandingPalette;
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

/**
 * Response returned by the social (OIDC) callback flow. Extends the shared
 * {@link SessionResponse} with the optional `originSlug` that the API rounds
 * trips through server-side state — the gym subdomain the login was initiated
 * from. The web callback validates this slug and redirects the user-agent back
 * to `https://<slug>.<apex>` so the white-label survives the OAuth hop.
 *
 * `originSlug` is server-vouched (stored keyed by the opaque `state`, never
 * echoed from the client); the web layer STILL re-validates it as a single DNS
 * label before building a redirect target (open-redirect prevention).
 */
export interface SocialCallbackResponse extends SessionResponse {
  originSlug?: string;
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

// -----------------------------------------------------------------------------
// 14a-v1.1-adaptation-adherence — shared adaptation recommendation contract.
//
// TYPE-ONLY (no Zod, no runtime export): the shape is server-produced and
// server-consumed on confirm, never parsed from an untrusted boundary, so it
// adds no runtime value and keeps the public-surface export guard
// (contracts.test.ts / billing-dto.test.ts) unchanged. If a future slice ever
// adds a runtime export here, both guard arrays MUST be updated in that slice.
// -----------------------------------------------------------------------------

/** Which signal produced an adaptation recommendation. `"adherence"` ships in 14a; `"rpe"` is reserved for 14b feeding the same banner slot. */
export type AdaptationSignalSource = "adherence" | "rpe";

/** Adaptation recommendation level. A banner renders only when `"low"`; `"ok"`/`"insufficient_data"` render nothing. */
export type AdaptationLevel = "ok" | "low" | "insufficient_data";

/** Signal context for an adherence-based recommendation over the rolling window. */
export interface AdherenceSnapshot {
  /** 0..1 completed/planned over the window. */
  adherence: number;
  /** Rolling window length in weeks (default 4). */
  periodWeeks: number;
  completedInWindow: number;
  /** `plannedSessionsPerWeek * periodWeeks`. */
  plannedInWindow: number;
}

/** Server-authoritative load bias steered by the generator prompt (14b-v1.1). Rides on `PlanSpec.intensityBias`. */
export type IntensityBias = "reduce" | "maintain" | "increase";

/** The adaptation Slice 1 (14a) or 14b may suggest: a frequency reduction, or a load (`intensityBias`) adjustment. */
export type SuggestedChange =
  | { kind: "reduce_frequency"; fromDays: number; toDays: number }
  | { kind: "adjust_load"; direction: "increase" | "decrease"; from: IntensityBias; to: IntensityBias };

/** Signal context for an actionable/`ok` RPE result over the last `WINDOW_SESSIONS` completed sessions (14b-v1.1). */
export interface RpeSnapshot {
  meanRpe: number;
  windowSessions: number;
  sessionsWithRpe: number;
  setsWithRpe: number;
}

/** Single shared adaptation recommendation carried on the dashboard read; both 14a (adherence) and 14b (rpe) compose into ONE banner via this shape. */
export interface AdaptationRecommendation {
  source: AdaptationSignalSource;
  level: AdaptationLevel;
  /** Present only when `level === "low"` and a real reduction/ladder-step exists. */
  suggestedChange?: SuggestedChange;
  /** i18n key, never raw prose (API-attached). */
  rationaleKey?: string;
  /** The spec to `POST /plan-specs/:id/adapt` on confirm (API-attached). */
  planSpecId?: string;
  /** Signal context for the adherence source (14a). */
  adherence?: AdherenceSnapshot;
  /** Signal context for the rpe source (14b). */
  rpe?: RpeSnapshot;
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
  /**
   * Optional adherence/adaptation recommendation (14a). Additive and optional so
   * existing consumers are unaffected; the banner renders only when
   * `adaptation.level === "low"`. Attached by the read; consumes no quota.
   */
  adaptation?: AdaptationRecommendation;
  /**
   * True when the authenticated viewer's membership role is `trainer`
   * (15b/#294) — drives trainer-only nav visibility. Optional/additive so
   * existing consumers are unaffected.
   */
  viewerIsTrainer?: boolean;
}

/**
 * One weekly RPE bucket in the trainer dashboard's trend series (15b-v2,
 * Phase S1). `meanRpe` is `null` when the week has fewer than 2 rated
 * working sets — rendered as a gap, never a fabricated zero.
 */
export interface RpeTrendPoint {
  weekStart: string;
  meanRpe: number | null;
  sessionsWithRpe: number;
}

/**
 * Trainer dashboard read DTO for `GET /trainer/clients/:clientUserId/dashboard`
 * (15b-v2, Phase S1). Resolved via `resolveAuthorizedOwner` before any
 * repository call; trainer and client always share the same `tenantId` for
 * this read (design.md "Tenant-Safe Dashboard Data").
 */
export interface ClientDashboardDTO {
  /** Up to 8 weekly buckets over the trailing 8 UTC weeks (Monday-first). */
  rpeTrend: RpeTrendPoint[];
  /** Rolling 28-day completion rate; `percent = min(100, round(completed/planned*100))`. */
  completionRate: { periodDays: 28; planned: number; completed: number; percent: number };
  /** Last 5 completed sessions; `meanRpe` is `null` when the session recorded no rated set. */
  recentSessions: Array<{ date: string; volumeKg: number; meanRpe: number | null }>;
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

// ---------------------------------------------------------------------------
// 12-v1.1-interactive-text-chat — conversational create-plan draft contract
// A `Partial<PlanSpec>` restricted to the SIX wizard INPUT fields (+ optional
// name) that a single chat turn may extract. `preferenceScores` and `confirmed`
// are intentionally absent: preferenceScores is derived server-side by
// `derivePreferenceScores`, and `confirmed` is a server-owned state transition.
// ---------------------------------------------------------------------------

/**
 * Zod schema for a per-turn extracted plan-spec draft (12-interactive-text-chat).
 *
 * Every field is optional — a turn may fill any subset. Enum-validated against
 * `PlanGoal` / `TrainingLocation`; `sessionDurationMinutes` is bounded 15..240.
 *
 * COUPLING: the 15/240 bound is hardcoded here because `@kinora/contracts` is a
 * leaf package and MUST NOT import `@kinora/domain`. It MUST stay in sync with
 * `SESSION_DURATION_LIMITS` in `packages/domain/src/plan/session-duration.ts`.
 * If the domain bound changes, update this schema in the same change.
 *
 * MUST NOT declare `preferenceScores` or `confirmed`.
 */
export const PlanSpecDraftSchema = z.object({
  goal: z.enum(["strength", "hypertrophy", "fat_loss", "general_fitness"]).optional(),
  daysPerWeek: z.number().int().min(1).max(7).optional(),
  // 15..240 — MUST match SESSION_DURATION_LIMITS (packages/domain session-duration.ts).
  sessionDurationMinutes: z.number().int().min(15).max(240).optional(),
  location: z.enum(["home", "gym", "outdoor"]).optional(),
  equipment: z.array(z.string()).optional(),
  limitations: z.array(z.object({ text: z.string(), isWarning: z.boolean() })).optional(),
  name: z.string().nullable().optional(),
});

/** Inferred `Partial<PlanSpec>` over the six wizard input fields (+ optional name). */
export type PlanSpecDraft = z.infer<typeof PlanSpecDraftSchema>;

/**
 * The six required wizard INPUT fields. Drives `missingFields` computation in the
 * domain merge (`mergePlanSpecDraft`) and the deterministic clarifying questions.
 */
export type PlanSpecDraftField =
  | "goal"
  | "daysPerWeek"
  | "sessionDurationMinutes"
  | "location"
  | "equipment"
  | "limitations";

// ---------------------------------------------------------------------------
// Exercise library — DTOs exchanged between the API and the clients.
//
// The catalog itself lives in `@kinora/exercise-catalog`. These schemas are the
// WIRE projection of `ExerciseCatalogRecord`: the list item carries only what a
// grid card renders, the detail adds the heavy instruction payload.
//
// COUPLING: `@kinora/contracts` is a leaf package and MUST NOT import
// `@kinora/exercise-catalog`, so the body-part enum is duplicated here. It MUST
// stay in sync with the `BodyPart` union in
// `packages/exercise-catalog/src/types.ts` — change both in the same slice.
// ---------------------------------------------------------------------------

/** Upstream body-part taxonomy (lowercase, space-separated), mirroring `BodyPart`. */
export const EXERCISE_BODY_PARTS = [
  "back",
  "cardio",
  "chest",
  "lower arms",
  "lower legs",
  "neck",
  "shoulders",
  "upper arms",
  "upper legs",
  "waist",
] as const;

/** The body part an exercise trains. */
export type ExerciseBodyPart = (typeof EXERCISE_BODY_PARTS)[number];

/**
 * Longest free-text `?search=` the catalog list endpoint accepts.
 *
 * SINGLE SOURCE OF TRUTH, for the same reason `EXERCISE_BODY_PARTS` is one: the
 * API REJECTS a longer term with 400, and the web library TRUNCATES to this
 * length before sending. When the number was duplicated on both sides, lowering
 * the API cap would have left the web layer sending terms it now 400s on, which
 * the page renders as a false "library unavailable" card.
 */
export const MAX_EXERCISE_SEARCH_LENGTH = 200;

/**
 * A single exercise as rendered in a browse/search grid.
 *
 * `attribution` is REQUIRED on the wire: the media referenced by `imagePath`
 * (self-hosted) and `gifPath` (CDN-served) is © Gym visual and its notice must
 * travel with it. Never strip it to shrink the payload — serving a file from a
 * public CDN does not relax the attribution obligation.
 */
export const ExerciseCatalogItemSchema = z.object({
  /** Zero-padded upstream id, e.g. `"0001"`. */
  id: z.string().min(1),
  name: z.string().min(1),
  bodyPart: z.enum(EXERCISE_BODY_PARTS),
  equipment: z.string().min(1),
  target: z.string().min(1),
  muscleGroup: z.string().min(1),
  /** Self-hosted thumbnail, app-absolute — e.g. `"/exercises/images/0001-2gPfomN.jpg"`. */
  imagePath: z.string().min(1),
  /**
   * CDN-served animation, an ABSOLUTE https URL (jsDelivr, pinned to an upstream
   * commit SHA) — e.g.
   * `"https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@<sha>/videos/0001-2gPfomN.gif"`.
   *
   * Intentionally validated as a plain non-empty string, not `z.url()` or a
   * prefix check: the delivery mechanism is an operational decision owned by
   * `scripts/import-exercise-catalog.ts`, and the wire contract must not have to
   * change if the media moves back to self-hosting. Render it as-is.
   */
  gifPath: z.string().min(1),
  attribution: z.string().min(1),
});

export type ExerciseCatalogItem = z.infer<typeof ExerciseCatalogItemSchema>;

/**
 * A single exercise with its full detail payload. Extends the list item with
 * the fields only the detail view needs, so the list response stays small.
 * `instructionSteps` always carries both shipped locales.
 */
export const ExerciseCatalogDetailSchema = ExerciseCatalogItemSchema.extend({
  secondaryMuscles: z.array(z.string()),
  instructionSteps: z.object({
    en: z.array(z.string()).min(1),
    es: z.array(z.string()).min(1),
  }),
});

export type ExerciseCatalogDetail = z.infer<typeof ExerciseCatalogDetailSchema>;

/**
 * A page of catalog items. `total` is the match count BEFORE pagination, so
 * clients can render a pager; `limit`/`offset` echo the applied window.
 */
export const ExerciseCatalogListResponseSchema = z.object({
  items: z.array(ExerciseCatalogItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});

export type ExerciseCatalogListResponse = z.infer<
  typeof ExerciseCatalogListResponseSchema
>;
