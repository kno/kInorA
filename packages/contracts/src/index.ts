/**
 * Shared contract types for the kInorA monorepo.
 *
 * All workspace-internal types that cross app boundaries
 * MUST be defined here so both apps import from a single source of truth.
 *
 * No database imports are allowed in this package — only stable IDs,
 * DTOs, and cross-boundary types.
 */

export interface HealthResponse {
  status: "ok";
}

export type PlanGoal = "strength" | "hypertrophy" | "fat_loss" | "general_fitness";

export type TrainingLocation = "home" | "gym" | "outdoor";

export interface PlanSpec {
  goal: PlanGoal;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  location: TrainingLocation;
  equipment: string[];
  limitations: string[];
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
