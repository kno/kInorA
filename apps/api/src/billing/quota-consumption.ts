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

/**
 * Input for the compensation (void) of a prior FRESH `allowed` consume. Keyed
 * identically to the consume it reverses; `tenantLimit` is irrelevant to a
 * void, so it is intentionally absent.
 */
export interface QuotaLedgerRefundInput {
  scope: BillingScope;
  feature: BillingFeature;
  period: string;
  operationKey: string;
}

/**
 * Outcome of a void:
 *   - `refunded` — an `allowed` ledger row existed; it was deleted and BOTH
 *      counters were decremented (all-or-nothing, same transaction)
 *   - `noop`     — no `allowed` ledger row for the key (never consumed, already
 *      voided, or a non-allowed/denied row): nothing to reverse. This makes a
 *      double-void safe and guarantees a counter is never driven negative.
 */
export type QuotaLedgerRefundResult = { outcome: "refunded" | "noop" };

export interface QuotaLedgerPort {
  consume(input: QuotaLedgerConsumeInput): Promise<QuotaLedgerConsumeResult>;
  refund(input: QuotaLedgerRefundInput): Promise<QuotaLedgerRefundResult>;
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
      return { allowed: true, tier: entitlement.tier, source: entitlement.source, period, replayed: false };
    }

    if (result.outcome === "replayed") {
      return result.prior === "allowed"
        ? { allowed: true, tier: entitlement.tier, source: entitlement.source, period, replayed: true }
        : { allowed: false, reason: result.reason ?? "tenant_quota_exhausted" };
    }

    return { allowed: false, reason: result.reason };
  }

  /**
   * Compensation for the memory_write path (#174): release a unit that a FRESH
   * consume reserved but whose downstream operation (embed+store) failed
   * terminally, so a fact that is never retried does not leak a unit forever.
   *
   * Callers MUST invoke this only for a decision whose `replayed` was `false`
   * (a fresh consume), and MUST pass the `period` from THAT SAME decision —
   * never a freshly re-derived one (#174 FIX B). Re-deriving from the current
   * wall clock is wrong: if the request crosses a billing-period boundary
   * between the consume and this compensating void, re-deriving would target
   * the NEW period, find no ledger row there, return `noop`, and leak the
   * OLD period's unit forever — reintroducing exactly the bug #174 exists to
   * fix, in that boundary window. Threading the decision's own `period`
   * guarantees the void always targets the period that was actually charged.
   *
   * Otherwise independent of entitlement — voiding never needs to re-resolve
   * a tier — and the ledger enforces atomicity plus a no-op guard so a
   * double-void or a never-consumed key cannot corrupt the counters.
   */
  async refund(
    scope: BillingScope,
    feature: BillingFeature,
    operationKey: string,
    period: string,
  ): Promise<QuotaLedgerRefundResult> {
    if (!operationKey || operationKey.trim() === "") {
      return { outcome: "noop" };
    }

    return this.ledger.refund({ scope, feature, period, operationKey });
  }
}
