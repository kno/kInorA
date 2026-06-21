import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
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