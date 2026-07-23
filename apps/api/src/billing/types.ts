import type { BillingDenialReason, BillingFeature, BillingSource, BillingTier } from "@kinora/contracts";

export type { BillingDenialReason, BillingFeature, BillingSource, BillingTier };

/**
 * Tenant-scoped actor identity used for every billing decision. Billing state,
 * quotas, and usage are always keyed by `(tenantId, userId)` — usage never
 * follows a user between tenants.
 */
export interface BillingScope {
  tenantId: string;
  userId: string;
}

/**
 * Result of an entitlement check: whether the resolved tenant tier grants the
 * feature at all (limit > 0). Quota consumption is a separate, later step.
 */
export type EntitlementDecision =
  | { allowed: true; tier: BillingTier; source: BillingSource }
  | { allowed: false; reason: BillingDenialReason };

/**
 * Result of an atomic check-and-consume: allowed carries the resolved tier and
 * billing period; denied carries the reason the route/service maps to a
 * fail-closed response.
 *
 * `replayed` distinguishes a FRESH consume (this call advanced the counter and
 * wrote the ledger row) from an idempotent REPLAY of a prior decision (this
 * call advanced nothing). A caller that compensates a failed operation (e.g.
 * the memory_write void, #174) MUST void only what it freshly consumed — a
 * replay's unit belongs to the prior/in-flight attempt and must never be voided.
 */
export type ConsumeDecision =
  | { allowed: true; tier: BillingTier; source: BillingSource; period: string; replayed: boolean }
  | { allowed: false; reason: BillingDenialReason };
