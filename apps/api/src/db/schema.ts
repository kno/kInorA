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
  customType,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { DefaultVectorMemoryEmbeddingConfig } from "@kinora/contracts";

const DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG = {
  provider: "openai",
  model: "text-embedding-3-small",
  version: "text-embedding-3-small",
  dimension: 1536,
} satisfies DefaultVectorMemoryEmbeddingConfig;

const pgVector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG.dimension})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    const raw = value.trim();
    if (raw === "[]") return [];
    return raw
      .slice(1, -1)
      .split(",")
      .map((entry) => Number(entry.trim()));
  },
});

/**
 * Goal enum for the user profile (10a-user-profile).
 * Mirrors the `PlanGoal` contract value set: strength / hypertrophy /
 * fat_loss / general_fitness. Stored as a nullable column on `user_profiles`
 * so legacy rows (no goal chosen) keep NULL — additive, never defaulted.
 */
export const goalEnum = pgEnum("goal", [
  "strength",
  "hypertrophy",
  "fat_loss",
  "general_fitness",
]);

/**
 * Experience-level enum for the user profile (10a-user-profile).
 * beginner / intermediate / advanced. Nullable on `user_profiles` for the
 * same additive reason as `goal`.
 */
export const experienceLevelEnum = pgEnum("experience_level", [
  "beginner",
  "intermediate",
  "advanced",
]);

/**
 * Self-described sex/gender enum for the user profile (17c-profile-body-metrics).
 * ONE merged field (see the change's decision 9) feeding plan generation.
 * `prefer_not_to_say` is a distinct stored member, never a reuse of `null`:
 * `null` means "never asked/answered", `prefer_not_to_say` means "asked, and
 * declined". Both degrade identically for generation and volume — see
 * `heightCm`'s sibling column and `BodyProfilePromptInput` (17c PR3).
 */
export const selfDescribedSexEnum = pgEnum("self_described_sex", [
  "female",
  "male",
  "non_binary",
  "other",
  "prefer_not_to_say",
]);

/**
 * Membership role: owner is the tenant creator; member is an invited user.
 * Extensible for future roles (e.g., admin).
 *
 * `trainer` (15a-v2-trainer-account-access, Slice 1) is appended additively —
 * existing ordinals are preserved (`ALTER TYPE ... ADD VALUE`). It is dark in
 * this slice: nothing grants it or checks for it yet. The authorization seam
 * (`resolveAuthorizedOwner`) that gates on this role lands in Slice 2.
 */
export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "member",
  "trainer",
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
 * `trainer` (15a-v2-trainer-account-access, Slice 1) is appended additively,
 * mirroring `membershipRoleEnum`. `resolveTenantFeatureLimit` (plan-limits.ts)
 * knows about it via `TRAINER_TIER_LIMITS`, but no route gates a capability on
 * it in this slice — see design.md's Slice Plan.
 *
 * `gym` (16a-v3-gym-white-label, Slice 1) is appended additively after
 * `trainer` (same `ALTER TYPE ... ADD VALUE` pattern, existing ordinals
 * preserved). It is dark in this slice: `resolveTenantFeatureLimit` knows
 * about it, but no route grants or gates a capability on it yet — the
 * `assertGymEntitled` authorization seam lands in Slice 3.
 */
export const billingTierEnum = pgEnum("billing_tier", ["free", "pro", "trainer", "gym"]);

export const billingStatusEnum = pgEnum("billing_status", [
  "active",
  "trialing",
  "expired",
  "overridden",
]);

export const billingSourceEnum = pgEnum("billing_source", [
  "system",
  "backfill",
  "admin_override",
  // 11b-v1-billing-stripe-integration: the webhook is the first writer to map a
  // paid Stripe subscription onto the existing status/tier contract. Appended
  // last so the 11a values keep their ordinals (additive `ALTER TYPE ... ADD
  // VALUE`); `resolveEffectiveTier` never branches on `source`.
  "stripe",
]);

/**
 * Billing cycle for a paid Stripe subscription (11b-v1). Nullable metadata on
 * `tenant_billing_states`: Free/trial tenants have no cycle. Monthly and annual
 * map to two config-driven Stripe Prices; both, once paid, resolve to `pro`.
 */
export const billingCycleEnum = pgEnum("billing_cycle", ["monthly", "annual"]);

export const billingFeatureEnum = pgEnum("billing_feature", [
  "plan_generation",
  "plan_regeneration",
  "memory_write",
  "memory_retrieval",
]);

export const billingDecisionEnum = pgEnum("billing_decision", [
  "allowed",
  "denied",
]);

export const billingAuditActionEnum = pgEnum("billing_audit_action", [
  "member_allocation_set",
  "admin_override_created",
  "admin_override_expired",
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

export const tenantBillingStates = pgTable(
  "tenant_billing_states",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tier: billingTierEnum("tier").notNull(),
    status: billingStatusEnum("status").notNull(),
    source: billingSourceEnum("source").notNull(),
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    // 11b-v1-billing-stripe-integration: additive, nullable Stripe metadata.
    // These columns are pure metadata for the webhook/portal/invoice flows and
    // are NEVER read by `resolveEffectiveTier` (entitlement.ts) — the webhook
    // still writes `status`/`tier` as the single source of truth. All columns
    // carry safe defaults (nullable, or a defaulted boolean) so the ADD COLUMN
    // migration is metadata-only with no table rewrite.
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeSubscriptionStatus: text("stripe_subscription_status"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    billingCycle: billingCycleEnum("billing_cycle"),
    // 11b-v1 Slice 2: per-tenant high-water mark for the webhook out-of-order
    // guard. The webhook applies a subscription write only when the incoming
    // Stripe event timestamp is >= this stored value, so a stale, reordered
    // delivery can never overwrite newer state. Additive + nullable (null until
    // the first Stripe event is applied); never read by `resolveEffectiveTier`.
    stripeEventTs: timestamp("stripe_event_ts", { withTimezone: true }),
    // 16c-v3-b2b-seat-billing Slice B: nullable seat count; null for
    // non-seat tiers. Written ONLY by the `customer.subscription.updated`
    // webhook (Stripe quantity is authoritative). Never read by
    // `resolveEffectiveTier` — only by `resolveTenantFeatureLimit` (Slice D).
    seatCount: integer("seat_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    trialWindowCheck: check(
      "tenant_billing_states_trial_window_chk",
      sql`${table.trialStartedAt} is null or ${table.trialEndsAt} is null or ${table.trialEndsAt} > ${table.trialStartedAt}`,
    ),
  }),
);

/**
 * Stripe processed-events store (11b-v1-billing-stripe-integration).
 * Idempotency + out-of-order guard for the webhook: keyed by the Stripe
 * `event_id` (PK), an insert-on-conflict-do-nothing makes each event apply at
 * most once (mirrors the `billing_usage_ledger` operation-key replay pattern).
 * `stripe_event_ts` records the source subscription/event timestamp so a stale,
 * out-of-order delivery never overwrites newer state. Purely additive — no 11a
 * table is touched.
 */
export const stripeProcessedEvents = pgTable("stripe_processed_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  stripeEventTs: timestamp("stripe_event_ts", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantBillingOverrides = pgTable(
  "tenant_billing_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tier: billingTierEnum("tier").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /**
     * Attribution, not ownership (#354): `ON DELETE SET NULL`, never `CASCADE`.
     * An override must outlive the admin who granted it — an admin leaving must
     * not silently reset a tenant's entitlements. Nullable because "who granted
     * this" can legitimately become unknown once the account is erased (GDPR
     * deletion), while the grant itself stays auditable.
     */
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
    /**
     * Optional caller-supplied idempotency key (#313). A grant retry after a
     * network timeout carries the same key so the server returns the original
     * override instead of a spurious `active_override_exists` 409. Enforced by
     * the partial unique index below (scoped per tenant, NULLs unconstrained).
     */
    operationKey: text("operation_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activeWindowIdx: index("tenant_billing_overrides_active_window_idx").on(
      table.tenantId,
      table.startsAt,
      table.endsAt,
    ),
    activeWindowCheck: check(
      "tenant_billing_overrides_active_window_chk",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    operationKeyUnique: uniqueIndex("tenant_billing_overrides_operation_key_uq")
      .on(table.tenantId, table.operationKey)
      .where(sql`${table.operationKey} IS NOT NULL`),
  }),
);

export const tenantQuotaCounters = pgTable(
  "tenant_quota_counters",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    feature: billingFeatureEnum("feature").notNull(),
    period: text("period").notNull(),
    used: integer("used").notNull().default(0),
    limit: integer("limit").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopeUnique: uniqueIndex("tenant_quota_counters_scope_unique").on(
      table.tenantId,
      table.feature,
      table.period,
    ),
    periodIdx: index("tenant_quota_counters_period_idx").on(table.tenantId, table.period),
    usedNonNegativeCheck: check(
      "tenant_quota_counters_used_non_negative_chk",
      sql`${table.used} >= 0`,
    ),
    limitNonNegativeCheck: check(
      "tenant_quota_counters_limit_non_negative_chk",
      sql`${table.limit} >= 0`,
    ),
    usageWithinLimitCheck: check(
      "tenant_quota_counters_usage_within_limit_chk",
      sql`${table.used} <= ${table.limit}`,
    ),
  }),
);

export const memberQuotaAllocations = pgTable(
  "member_quota_allocations",
  {
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    feature: billingFeatureEnum("feature").notNull(),
    period: text("period").notNull(),
    limit: integer("limit").notNull(),
    /**
     * Attribution, not ownership (#354): `ON DELETE SET NULL`, never `CASCADE`.
     * The allocation belongs to `(tenantId, userId)` — deleting the admin who
     * last changed the limit must drop only the credit for the change, never the
     * limit itself.
     */
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    membershipFk: foreignKey({
      name: "member_quota_allocations_tenant_user_memberships_fk",
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete("cascade"),
    scopeUnique: uniqueIndex("member_quota_allocations_scope_unique").on(
      table.tenantId,
      table.userId,
      table.feature,
      table.period,
    ),
    limitNonNegativeCheck: check(
      "member_quota_allocations_limit_non_negative_chk",
      sql`${table.limit} >= 0`,
    ),
  }),
);

export const memberQuotaCounters = pgTable(
  "member_quota_counters",
  {
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    feature: billingFeatureEnum("feature").notNull(),
    period: text("period").notNull(),
    used: integer("used").notNull().default(0),
    limit: integer("limit").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    membershipFk: foreignKey({
      name: "member_quota_counters_tenant_user_memberships_fk",
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete("cascade"),
    scopeUnique: uniqueIndex("member_quota_counters_scope_unique").on(
      table.tenantId,
      table.userId,
      table.feature,
      table.period,
    ),
    periodIdx: index("member_quota_counters_period_idx").on(
      table.tenantId,
      table.userId,
      table.period,
    ),
    usedNonNegativeCheck: check(
      "member_quota_counters_used_non_negative_chk",
      sql`${table.used} >= 0`,
    ),
    limitNonNegativeCheck: check(
      "member_quota_counters_limit_non_negative_chk",
      sql`${table.limit} >= 0`,
    ),
    usageWithinLimitCheck: check(
      "member_quota_counters_usage_within_limit_chk",
      sql`${table.used} <= ${table.limit}`,
    ),
  }),
);

export const billingUsageLedger = pgTable(
  "billing_usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    feature: billingFeatureEnum("feature").notNull(),
    period: text("period").notNull(),
    operationKey: text("operation_key").notNull(),
    decision: billingDecisionEnum("decision").notNull(),
    reason: text("reason").notNull(),
    // #174 refund symmetry (FIX A): records whether THIS consume incremented
    // the per-member counter, decided at consume time from allocation
    // existence at that instant. `refund` MUST reverse based on this recorded
    // fact — not by re-reading current allocation existence — so an admin
    // adding/removing a per-member allocation between consume and a
    // compensating void can never desync the tenant/member mirror.
    memberCounterCredited: boolean("member_counter_credited").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    membershipFk: foreignKey({
      name: "billing_usage_ledger_tenant_user_memberships_fk",
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete("cascade"),
    operationUnique: uniqueIndex("billing_usage_ledger_operation_unique").on(
      table.tenantId,
      table.userId,
      table.feature,
      table.period,
      table.operationKey,
    ),
    periodIdx: index("billing_usage_ledger_period_idx").on(
      table.tenantId,
      table.userId,
      table.period,
    ),
  }),
);

export const billingAuditEvents = pgTable(
  "billing_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Plain FK to `users.id` (16d-admin-tier-provisioning) — NOT a tenant-scoped
    // composite FK. A global superadmin (`users.is_admin`) may act on a tenant
    // they hold zero `memberships` rows for (e.g. granting a tier override), so
    // the audit actor must be recordable independent of tenant membership.
    //
    // Attribution, not ownership (#354): both are `ON DELETE SET NULL`, never
    // `CASCADE`. An audit event exists precisely to outlive the thing it
    // describes — erasing the billing trail along with the account would drop it
    // exactly when it is needed (chargeback, "why was I charged"). An event with
    // an unknown actor still says what happened and to which tenant.
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    action: billingAuditActionEnum("action").notNull(),
    feature: billingFeatureEnum("feature"),
    period: text("period"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCreatedIdx: index("billing_audit_events_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
    ),
  }),
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
    /**
     * Optimistic-concurrency guard (#215). Monotonically bumped on every write
     * to the row. A read-modify-write chat turn commits only if this value is
     * unchanged since it read, so two overlapping turns cannot lost-update each
     * other. Additive with a server default of 0 so existing rows are safe.
     */
    version: integer("version").notNull().default(0),
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
    /**
     * 17d PR B: when the user retired this plan from their active list. NULL
     * = active. Orthogonal to `status` above, which is a GENERATION
     * lifecycle — a plan may be `failed` and archived at once. Additive and
     * nullable, like `name` above: rollback is a column drop with zero data
     * loss, because archiving never deletes anything (`workout_sessions`
     * cascades from this row's DELETE, which is exactly why this change
     * introduces no DELETE route).
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * #421: the optimistic-concurrency token for `updateProgram`, and the ONLY
     * thing that guards it.
     *
     * `updated_at` used to play this role and produced two defects in a row,
     * both from the same root cause: a timestamp is a CLOCK READING, so using
     * it as a version makes clock precision a correctness property. Postgres
     * stores `timestamptz` to microseconds, a JS `Date` and an ISO-8601 string
     * carry milliseconds, and two writes inside one millisecond are
     * indistinguishable — first every edit conflicted, then a stale token
     * could be replayed over a fresh edit.
     *
     * A monotonic counter has no such window: it advances by exactly one on
     * every guarded write, regardless of how fast the writes arrive. This
     * mirrors `plan_drafts.version` / `commitWithVersion` (#215).
     *
     * Existing rows backfill to 1, which is correct: any token a client is
     * holding from before this column existed was a timestamp and is no longer
     * accepted by the API, so no in-flight edit can be validated against it.
     */
    version: integer("version").notNull().default(1),
  },
  (table) => ({
    tenantSpecIdx: index("workout_plans_tenant_spec_idx").on(
      table.tenantId,
      table.planSpecId
    ),
  })
);

/**
 * Workout session status — active while the workout is in progress, completed
 * once closed, or abandoned once auto-closed (age) or explicitly discarded by
 * the user (17b-stale-session-recovery). Appended last to preserve existing
 * ordinals — additive, like `billingSourceEnum`'s `"stripe"`.
 */
export const workoutSessionStatusEnum = pgEnum("workout_session_status", [
  "active",
  "completed",
  "abandoned",
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
 * `title` produced by `deriveExerciseMuscleGroup` (09c-v1
 * progress-dashboard-stats, Slice 1b; catalog taxonomy added in #352 slice C)
 * — carries no user-logged information,
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

export const userMemoryStatusEnum = pgEnum("user_memory_status", [
  "candidate",
  "confirmed",
  "embedding_pending",
  "active",
  "rejected",
  "failed",
  "deleted",
]);

export const userMemoryEligibilityEnum = pgEnum("user_memory_eligibility", [
  "eligible",
  "secret",
  "raw_transcript",
  "full_plan",
  "sensitive_health",
  "other",
]);

export const userMemoryConsentEnum = pgEnum("user_memory_consent", [
  "granted",
  "revoked",
]);

/**
 * Vector memory settings — tenant+user scoped enable/disable state.
 * Existing records stay reviewable even when `enabled=false`; the flag only
 * blocks new writes/retrieval in later slices.
 */
export const vectorMemorySettings = pgTable(
  "vector_memory_settings",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    settingsVersion: integer("settings_version").notNull().default(1),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserUnique: uniqueIndex("vector_memory_settings_tenant_user_unique").on(
      table.tenantId,
      table.userId,
    ),
  }),
);

/**
 * User memory vectors — tenant+user scoped durable facts with embedding metadata.
 * Records are soft-deletable/soft-disablable for immediate retrieval exclusion.
 */
export const userMemoryVectors = pgTable(
  "user_memory_vectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    source: text("source").notNull(),
    status: userMemoryStatusEnum("status").notNull(),
    eligibility: userMemoryEligibilityEnum("eligibility").notNull(),
    consentStatus: userMemoryConsentEnum("consent_status").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    schemaVersion: text("schema_version").notNull().default("1"),
    embeddingProvider: text("embedding_provider").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    embeddingVersion: text("embedding_version").notNull(),
    embeddingDimension: integer("embedding_dimension").notNull(),
    embedding: pgVector("embedding", {
      dimensions: DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG.dimension,
    }).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerStatusIdx: index("user_memory_vectors_owner_status_idx").on(
      table.tenantId,
      table.userId,
      table.status,
    ),
    ownerEmbeddingMetadataIdx: index(
      "user_memory_vectors_owner_embedding_metadata_idx",
    ).on(
      table.tenantId,
      table.userId,
      table.embeddingProvider,
      table.embeddingModel,
      table.embeddingVersion,
      table.embeddingDimension,
    ),
    tenantUserIdempotencyUnique: uniqueIndex(
      "user_memory_vectors_tenant_user_idempotency_unique",
    ).on(table.tenantId, table.userId, table.idempotencyKey),
    tenantUserFingerprintActiveUnique: uniqueIndex(
      "user_memory_vectors_tenant_user_fingerprint_active_unique",
    )
      .on(table.tenantId, table.userId, table.fingerprint)
      .where(sql`${table.deletedAt} is null`),
  }),
);

/**
 * User Profiles — user-scoped structured memory (10a-user-profile).
 * One row per user, enforced by a unique index on `userId`.
 * `name` is NOT NULL (provisioned on registration from the email prefix);
 * `goal` and `experienceLevel` are nullable/additive — a row may exist with
 * NULL for either, leaving the user free to choose later. Inserted in the
 * same transaction as tenant/user/membership creation (R3 auto-provision).
 *
 * `selfDescribedSex` and `heightCm` (17c-profile-body-metrics) follow the
 * same "row may exist with NULL, user chooses later" contract — both are
 * nullable and additive, never backfilled.
 */
export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: goalEnum("goal"),
    experienceLevel: experienceLevelEnum("experience_level"),
    selfDescribedSex: selfDescribedSexEnum("self_described_sex"),
    heightCm: integer("height_cm"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdUnique: uniqueIndex("user_profiles_user_id_unique").on(table.userId),
  })
);

/**
 * User Weight Entries — dated bodyweight readings, a 1:MANY series keyed by
 * `userId` (17c-profile-body-metrics, PR 2). Deliberately NO unique index on
 * `userId` — unlike `userProfiles`/`userPreferences`, a user may have any
 * number of readings. `weightKg` is `numeric(5,2)`, matching
 * `set_records.weightKg`'s numeric choice (reads back as `string`; the
 * repository converts through a `toOptionalNumber`-style helper).
 * `ON DELETE CASCADE` follows the universal convention for user-scoped child
 * tables. The composite `(userId, recordedAt)` index serves both the
 * reverse-chronological list and the bodyweight-resolution query (PR 4) with
 * one structure.
 */
export const userWeightEntries = pgTable(
  "user_weight_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weightKg: numeric("weight_kg", { precision: 5, scale: 2 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userRecordedAtIdx: index("user_weight_entries_user_recorded_at_idx").on(
      table.userId,
      table.recordedAt,
    ),
  })
);

/**
 * User Preferences — user-scoped training context defaults (10b-user-preferences).
 * One row per user via unique `userId`.
 * All three data columns are nullable; a row present with NULLs is a valid
 * "I have visited the page but chosen no defaults" state. `defaultEquipment`
 * is stored as JSONB so it can be an empty array `[]` (R1: "MAY be an empty
 * array") distinct from NULL ("never answered"). Partial update semantics
 * live in the repository, not the schema.
 */
export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    defaultLocation: text("default_location"),
    defaultDuration: integer("default_duration"),
    defaultEquipment: jsonb("default_equipment").$type<string[]>(),
    // TTS opt-out (13-v1.1-interactive-voice-chat, A3). Nullable, no backfill:
    // NULL or true = TTS enabled (opt-out default ON); false = opted out.
    ttsEnabled: boolean("tts_enabled"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdUnique: uniqueIndex("user_preferences_user_id_unique").on(
      table.userId
    ),
  })
);

/**
 * Trainer/client assignment lifecycle (15a-v2-trainer-account-access):
 *   invited — the trainer has invited the client, not yet accepted
 *   active  — the client accepted; the trainer may act on their behalf
 *   revoked — the assignment no longer grants access (kept for audit)
 */
export const trainerAssignmentStatusEnum = pgEnum("trainer_assignment_status", [
  "invited",
  "active",
  "revoked",
]);

/**
 * Trainer/client assignments — the auditable link that lets an entitled
 * trainer act on an assigned client's training data (15a-v2, Slice 1: dark,
 * additive; no route wires this table yet — that lands in Slice 3/4).
 *
 * Both trainer and client are `memberships` rows in the SAME tenant (the
 * trainer's tenant); the client keeps a separate personal-tenant membership
 * untouched. `(tenant_id, client_user_id)` is unique per assignment record,
 * and the partial unique index on `client_user_id` (excluding `revoked`
 * rows) enforces the one-active-trainer-per-client invariant across the
 * whole table, not just within one tenant.
 */
export const trainerClientAssignments = pgTable(
  "trainer_client_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    trainerUserId: uuid("trainer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientUserId: uuid("client_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: trainerAssignmentStatusEnum("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantClientUnique: uniqueIndex("trainer_client_assignments_tenant_client_unique").on(
      table.tenantId,
      table.clientUserId,
    ),
    // One-active-trainer-per-client: only one non-revoked assignment row may
    // exist per client, across all trainers/tenants.
    clientActiveUnique: uniqueIndex("trainer_client_assignments_client_active_unique")
      .on(table.clientUserId)
      .where(sql`${table.status} <> 'revoked'`),
    trainerIdx: index("trainer_client_assignments_trainer_idx").on(
      table.tenantId,
      table.trainerUserId,
    ),
  }),
);

/**
 * Gym white-label branding (16a-v3-gym-white-label, Slice 1: dark, additive —
 * no route wires this table yet, that lands in Slice 3). One row per tenant
 * (PK on `tenant_id`), keyed for public lookup by a unique `subdomain_slug`.
 * `logo_storage_key` is a `LocalStorageAdapter`/`ObjectStoragePort` key (S2),
 * nullable until a logo is uploaded. The six palette columns are nullable hex
 * strings validated at the DB layer by a `^#[0-9a-fA-F]{6}$` CHECK constraint
 * (mirrored by the pure `apps/api/src/branding/palette.ts` validator used at
 * the application layer before any write) so an absent value renders via the
 * `var(--gym-x, var(--default))` CSS fallback (S4/S5) rather than an invalid
 * color ever reaching the database.
 */
export const tenantBranding = pgTable(
  "tenant_branding",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subdomainSlug: text("subdomain_slug").notNull(),
    logoStorageKey: text("logo_storage_key"),
    accent: text("accent"),
    accentFg: text("accent_fg"),
    surface: text("surface"),
    surface2: text("surface2"),
    fg: text("fg"),
    muted: text("muted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subdomainSlugUnique: uniqueIndex("tenant_branding_subdomain_slug_unique").on(
      table.subdomainSlug,
    ),
    accentHexCheck: check(
      "tenant_branding_accent_hex_chk",
      sql`${table.accent} is null or ${table.accent} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
    accentFgHexCheck: check(
      "tenant_branding_accent_fg_hex_chk",
      sql`${table.accentFg} is null or ${table.accentFg} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
    surfaceHexCheck: check(
      "tenant_branding_surface_hex_chk",
      sql`${table.surface} is null or ${table.surface} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
    surface2HexCheck: check(
      "tenant_branding_surface2_hex_chk",
      sql`${table.surface2} is null or ${table.surface2} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
    fgHexCheck: check(
      "tenant_branding_fg_hex_chk",
      sql`${table.fg} is null or ${table.fg} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
    mutedHexCheck: check(
      "tenant_branding_muted_hex_chk",
      sql`${table.muted} is null or ${table.muted} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
  }),
);

/**
 * Observability event severity (#310, Slice 1). A curated, low-cardinality set
 * mirroring the app logger levels: `info` (normal domain outcomes), `warn`
 * (denied/degraded but expected), `error` (unhandled request/server failure).
 */
export const observabilityLevelEnum = pgEnum("observability_level", [
  "info",
  "warn",
  "error",
]);

/**
 * Observability events (#310, Slice 1) — a persisted, superadmin-queryable
 * stream of curated STRUCTURED domain events that runs ALONGSIDE (never
 * replaces) the pino/stdout logs. Every write also emits a matching pino line
 * so `docker logs` stays authoritative; this table adds durable, filterable
 * history for the (later) /admin/logs view.
 *
 * HARD PRIVACY INVARIANT (AGENTS.md:72): rows carry ONLY non-sensitive
 * identifiers (tenantId, actorUserId, and ids inside `metadata` such as
 * planId/planSpecId/overrideId/eventId), enums/outcomes, an error name/message
 * (never arbitrary user content), and non-sensitive scalar metadata (tier,
 * limit, feature, status, route, statusCode). NEVER persist secrets, tokens,
 * credentials, health data, plan/exercise/program content, prompts, or PII.
 *
 * `tenantId` and `actorUserId` are BOTH nullable with NO foreign key: a
 * system-level event (e.g. `request.error` with no auth context) or an event
 * for a tenant/user later deleted must still be writable and retained — a
 * failed observability write must never break the request path, and an FK
 * cascade must never erase audit history.
 */
export const observabilityEvents = pgTable(
  "observability_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id"),
    actorUserId: uuid("actor_user_id"),
    level: observabilityLevelEnum("level").notNull(),
    event: text("event").notNull(),
    outcome: text("outcome"),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Millisecond precision (#310 keyset-pagination fix): matches JS `Date`
    // round-trip precision exactly. The paginated keyset cursor is encoded via
    // `Date.toISOString()` (ms) and node-pg already returns `Date` at ms
    // precision on read — storing at the default (microsecond) precision let a
    // row's microsecond remainder differ from every cursor value derived from
    // it, so `createdAt = cursor.createdAt` never matched and the `id`
    // tiebreak was silently unreachable for same-millisecond rows. Truncating
    // storage to ms makes the comparison lossless.
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantCreatedIdx: index("observability_events_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
    ),
    createdIdx: index("observability_events_created_idx").on(table.createdAt),
    levelCreatedIdx: index("observability_events_level_created_idx").on(
      table.level,
      table.createdAt,
    ),
  }),
);
