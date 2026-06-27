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
} from "drizzle-orm/pg-core";

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