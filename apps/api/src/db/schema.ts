import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  integer,
  jsonb,
  boolean,
  index,
  numeric,
  varchar,
  smallint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Membership role: owner is the tenant creator; member is an invited user.
 * Extensible for future roles (e.g., admin).
 */
export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "member",
]);

/**
 * Membership status lifecycle:
 *   invited  — user has been invited but has not yet accepted
 *   active   — user is an active member of the tenant
 *   suspended — user's membership is suspended
 */
export const membershipStatusEnum = pgEnum("membership_status", [
  "invited",
  "active",
  "suspended",
]);

/**
 * Tenants — organizations or personal workspaces that own all user data.
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Users — individuals who can belong to one or more tenants through memberships.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Memberships — the association table linking users to tenants.
 * A user can be a member of multiple tenants.
 * The (tenantId, userId) pair is unique per membership.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserUnique: uniqueIndex("memberships_tenant_id_user_id_unique").on(
      table.tenantId,
      table.userId
    ),
  })
);

/**
 * Credentials — password hashes for email/password auth users.
 * One credential row per user (unique on userId).
 * `passwordHash` stores a salted scrypt hash as `<saltHex>:<hashHex>`.
 */
export const credentials = pgTable(
  "credentials",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdUnique: uniqueIndex("credentials_user_id_unique").on(table.userId),
  })
);

/**
 * OAuth Accounts — links an external OIDC provider to a kInorA user.
 * `userId` is nullable: a row may exist (by verified email) before it is
 * linked to a user. Race-safe linking relies on the two unique indexes.
 */
export const oauth_accounts = pgTable(
  "oauth_accounts",
  {
    providerId: text("provider_id").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    providerAccountUnique: uniqueIndex(
      "oauth_accounts_provider_id_provider_account_id_unique"
    ).on(table.providerId, table.providerAccountId),
    providerEmailUnique: uniqueIndex("oauth_accounts_provider_id_email_unique").on(
      table.providerId,
      table.email
    ),
  })
);

/**
 * Plan Drafts — one active draft per user per tenant.
 * Stores the in-progress wizard answers so the user can exit and resume.
 * The unique index on (tenant_id, user_id) enforces the single-active-draft invariant.
 * Promoted to a plan_specs row on wizard completion.
 */
export const planDrafts = pgTable(
  "plan_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    step: integer("step").notNull(),
    specJson: jsonb("spec_json").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserUnique: uniqueIndex("plan_drafts_tenant_user_unique").on(
      table.tenantId,
      table.userId
    ),
  })
);

/**
 * Plan Specs — confirmed wizard requirements (NOT a workout program).
 * Created when the user completes all wizard steps and clicks Finish.
 * The actual workout program (exercises, sets, schedule) is owned by change 08
 * (ai-plan-generation) and will live in a separate table referencing plan_specs(id).
 */
export const planSpecs = pgTable(
  "plan_specs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    specJson: jsonb("spec_json").notNull(),
    confirmed: boolean("confirmed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserIdx: index("plan_specs_tenant_user_idx").on(
      table.tenantId,
      table.userId
    ),
  })
);

/**
 * Workout Plan Status — lifecycle enum for AI-generated workout plans.
 *   generating — LLM is working; the row was created by confirm/regenerate
 *   ready      — LLM succeeded; program_json is populated
 *   failed     — LLM or post-processing failed; error_message is populated
 */
export const workoutPlanStatusEnum = pgEnum("workout_plan_status", [
  "generating",
  "ready",
  "failed",
]);

/**
 * Workout Plans — AI-generated workout programs for a plan spec.
 * Created by change 08 (ai-plan-generation).
 * One row per generation attempt; multiple rows may exist per plan_spec_id
 * (each regenerate creates a fresh row). The latest row represents the current plan.
 * program_json is typed by WorkoutProgram from @kinora/contracts.
 * Stuck-generating strategy: manual regenerate only — stale rows remain for audit.
 */
export const workoutPlans = pgTable(
  "workout_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planSpecId: uuid("plan_spec_id")
      .notNull()
      .references(() => planSpecs.id, { onDelete: "cascade" }),
    status: workoutPlanStatusEnum("status").notNull(),
    /**
     * User-supplied plan name (#93). Nullable/additive: legacy rows and blank
     * wizard submissions store NULL; the effective label is resolved on read
     * via the domain helper `defaultPlanName(name, createdAt)`.
     */
    name: varchar("name", { length: 120 }),
    programJson: jsonb("program_json"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantSpecIdx: index("workout_plans_tenant_spec_idx").on(
      table.tenantId,
      table.planSpecId
    ),
  })
);

/**
 * Workout session status — active while the workout is in progress, completed once closed.
 */
export const workoutSessionStatusEnum = pgEnum("workout_session_status", [
  "active",
  "completed",
]);

/**
 * Workout sessions — one relational snapshot root per live or completed workout.
 * The partial unique index guarantees at most one active session per tenant/user pair.
 */
export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workoutPlanId: uuid("workout_plan_id")
      .notNull()
      .references(() => workoutPlans.id, { onDelete: "cascade" }),
    status: workoutSessionStatusEnum("status").notNull().default("active"),
    /**
     * Plan day this session is scoped to (#93). Nullable/additive: legacy rows
     * store NULL and therefore never match a (planId, day) resume comparison,
     * forcing the conflict branch instead of a silent wrong-day resume.
     */
    day: smallint("day"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserIdx: index("workout_sessions_tenant_user_idx").on(table.tenantId, table.userId),
    singleActivePerUser: uniqueIndex("workout_sessions_single_active_per_user_unique")
      .on(table.tenantId, table.userId)
      .where(sql`${table.status} = 'active'`),
  })
);

/**
 * Session exercises — immutable except the derived `muscle_group`
 * classification column. The exercise snapshot rows (title, order, rest,
 * notes) are copied from the workout plan and never mutated afterward; that
 * is the true immutable *what-happened* record. `muscle_group` is different:
 * it is a computed label *about* the row — a deterministic function of
 * `title` produced by `classifyExerciseMuscleGroup` (09c-v1
 * progress-dashboard-stats, Slice 1b) — carries no user-logged information,
 * and can be recomputed at any time. Populating it at write time or via the
 * idempotent backfill therefore does not violate the snapshot invariant. See
 * design.md "Immutable-table carve-out".
 */
export const sessionExercises = pgTable(
  "session_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workoutSessionId: uuid("workout_session_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    exerciseIndex: integer("exercise_index").notNull(),
    title: text("title").notNull(),
    restSeconds: integer("rest_seconds").notNull(),
    notes: text("notes"),
    /**
     * Derived muscle-group classification (09c-v1 Slice 1b). Additive and
     * nullable: legacy rows and unclassifiable titles stay NULL, and
     * rolling this column back is just dropping it with no data loss.
     * Populated at write time in `insertSessionExercises` and by the
     * idempotent backfill script (`apps/api/src/db/backfill-muscle-group.ts`).
     */
    muscleGroup: varchar("muscle_group"),
  },
  (table) => ({
    workoutSessionIdx: index("session_exercises_workout_session_idx").on(table.workoutSessionId),
  })
);

/**
 * Set records — planned targets plus logged execution values for each set.
 */
export const setRecords = pgTable(
  "set_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionExerciseId: uuid("session_exercise_id")
      .notNull()
      .references(() => sessionExercises.id, { onDelete: "cascade" }),
    setIndex: integer("set_index").notNull(),
    targetReps: text("target_reps").notNull(),
    actualReps: integer("actual_reps"),
    weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
    rpe: integer("rpe"),
    completed: boolean("completed").notNull().default(false),
    notes: text("notes"),
  },
  (table) => ({
    sessionExerciseIdx: index("set_records_session_exercise_idx").on(table.sessionExerciseId),
  })
);

/**
 * Sessions — opaque DB-backed bearer tokens.
 * The token sent to the client is never stored; only its scrypt hash is.
 * `tokenHash` is unique and used for lookup. `tenantId` records the tenant
 * the session was issued for; membership status is validated per request.
 */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  })
);

/**
 * AI Provider — valid provider identifiers for the AI generation pipeline.
 */
export const aiProviderEnum = pgEnum("ai_provider", [
  "openrouter",
  "openai",
  "anthropic",
  "google",
  "opencode-go",
]);

/**
 * AI Provider Config — singleton table storing the active AI provider and model.
 * At most one row should exist at any time; the repository enforces this by deleting
 * all existing rows before each insert (delete+insert, since there is no fixed anchor
 * key for ON CONFLICT DO UPDATE).
 * If no row exists the generation pipeline falls back to OPENROUTER_API_KEY env var.
 */
export const aiProviderConfig = pgTable("ai_provider_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: aiProviderEnum("provider").notNull(),
  model: text("model").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
