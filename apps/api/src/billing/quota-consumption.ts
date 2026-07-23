import type { BillingDenialReason, BillingFeature } from "@kinora/contracts";
import type { BillingScope, ConsumeDecision, EntitlementDecision } from "./types.js";
import { currentBillingPeriod, resolveTenantFeatureLimit } from "./plan-limits.js";

/**
 * Input for the atomic ledger operation. The port owns the transaction that
 * guarantees idempotency plus all-or-nothing tenant + member counter increments.
 */
export interface QuotaLedgerConsumeInput {
  scope: BillingScope;
  feature: BillingFeature;
  period: string;
  operationKey: string;
  /** Resolved tenant aggregate limit for `(tier, feature)`. */
  tenantLimit: number;
}

/**
 * Outcome of the atomic ledger operation:
 *   - `consumed`  — both counters advanced, an allowed ledger row was written
 *   - `denied`    — a counter had no room; NO counter advanced (all-or-nothing)
 *   - `replayed`  — this operation key already has a ledger row; return its decision
 */
export type QuotaLedgerConsumeResult =
  | { outcome: "consumed" }
  | { outcome: "denied"; reason: BillingDenialReason }
  | { outcome: "replayed"; prior: "allowed" | "denied"; reason?: BillingDenialReason };

export interface QuotaLedgerPort {
  consume(input: QuotaLedgerConsumeInput): Promise<QuotaLedgerConsumeResult>;
}

interface EntitlementChecker {
  check(scope: BillingScope, feature: BillingFeature, now: Date): Promise<EntitlementDecision>;
}

/**
 * Check-and-consume use case. Orchestrates the data flow from design.md:
 *   1. reject an empty operation key (idempotency is mandatory) BEFORE any work
 *   2. resolve entitlement — deny (fail-closed) without consuming when denied
 *   3. delegate the atomic increment + idempotency ledger to the port
 *
 * Retried operation keys return the original decision without consuming again.
 */
export class CheckAndConsumeQuota {
  constructor(
    private readonly entitlement: EntitlementChecker,
    private readonly ledger: QuotaLedgerPort,
  ) {}

  async checkAndConsume(
    scope: BillingScope,
    feature: BillingFeature,
    operationKey: string,
    now: Date = new Date(),
  ): Promise<ConsumeDecision> {
    if (!operationKey || operationKey.trim() === "") {
      return { allowed: false, reason: "operation_key_required" };
    }

    const entitlement = await this.entitlement.check(scope, feature, now);
    if (!entitlement.allowed) {
      return entitlement;
    }

    const period = currentBillingPeriod(now);
    const tenantLimit = resolveTenantFeatureLimit(entitlement.tier, feature);

    const result = await this.ledger.consume({
      scope,
      feature,
      period,
      operationKey,
      tenantLimit,
    });

    if (result.outcome === "consumed") {
      return { allowed: true, tier: entitlement.tier, source: entitlement.source, period };
    }

    if (result.outcome === "replayed") {
      return result.prior === "allowed"
        ? { allowed: true, tier: entitlement.tier, source: entitlement.source, period }
        : { allowed: false, reason: result.reason ?? "tenant_quota_exhausted" };
    }

    return { allowed: false, reason: result.reason };
  }
}
