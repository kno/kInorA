import { describe, expect, it, vi } from "vitest";
import type { BillingFeature } from "@kinora/contracts";
import type { EntitlementDecision } from "../types.js";
import {
  CheckAndConsumeQuota,
  type QuotaLedgerConsumeInput,
  type QuotaLedgerConsumeResult,
  type QuotaLedgerPort,
} from "../quota-consumption.js";

const NOW = new Date("2026-07-23T12:00:00.000Z");
const PERIOD = "2026-07";

/**
 * In-memory ledger that faithfully models the production atomic transaction:
 *   - idempotency ledger keyed by (tenant,user,feature,period,operationKey)
 *   - a tenant aggregate counter + optional per-member allocation counter
 *   - BOTH counters must have room before EITHER is incremented (all-or-nothing)
 *
 * The critical section in `consume` runs to completion with NO `await` between
 * read and write, so two "concurrent" Promise.all calls are each atomic — this
 * models Postgres `SELECT ... FOR UPDATE` + conditional `UPDATE ... WHERE
 * used < limit`. It is the unit-level proof of the concurrency invariant.
 */
class FakeLedger implements QuotaLedgerPort {
  private ledger = new Map<string, { decision: "allowed" | "denied"; reason?: string }>();
  private tenantUsed = new Map<string, number>();
  memberAllocations = new Map<string, number>();
  private memberUsed = new Map<string, number>();
  consumeSpy = vi.fn();

  private tenantKey(i: QuotaLedgerConsumeInput) {
    return `${i.scope.tenantId}:${i.feature}:${i.period}`;
  }
  private memberKey(i: QuotaLedgerConsumeInput) {
    return `${i.scope.tenantId}:${i.scope.userId}:${i.feature}:${i.period}`;
  }
  private opKey(i: QuotaLedgerConsumeInput) {
    return `${this.memberKey(i)}:${i.operationKey}`;
  }

  setMemberAllocation(tenantId: string, userId: string, feature: BillingFeature, period: string, limit: number) {
    this.memberAllocations.set(`${tenantId}:${userId}:${feature}:${period}`, limit);
  }
  tenantUsage(tenantId: string, feature: BillingFeature, period: string) {
    return this.tenantUsed.get(`${tenantId}:${feature}:${period}`) ?? 0;
  }
  memberUsage(tenantId: string, userId: string, feature: BillingFeature, period: string) {
    return this.memberUsed.get(`${tenantId}:${userId}:${feature}:${period}`) ?? 0;
  }

  async consume(input: QuotaLedgerConsumeInput): Promise<QuotaLedgerConsumeResult> {
    this.consumeSpy(input);
    // --- begin atomic critical section (no await inside) ---
    const opKey = this.opKey(input);
    const existing = this.ledger.get(opKey);
    if (existing) {
      return { outcome: "replayed", prior: existing.decision, reason: existing.reason as never };
    }

    const tKey = this.tenantKey(input);
    const mKey = this.memberKey(input);
    const tUsed = this.tenantUsed.get(tKey) ?? 0;
    const allocation = this.memberAllocations.get(mKey);
    const mUsed = this.memberUsed.get(mKey) ?? 0;

    // Capacity-exhaustion denials are TRANSIENT and are NOT persisted to the
    // idempotency ledger (mirrors QuotaLedgerRepository.consume): nothing was
    // consumed, so a same-key retry after an upgrade/allocation bump is safely
    // re-evaluated against current entitlement instead of replaying a stale 403.
    if (tUsed >= input.tenantLimit) {
      return { outcome: "denied", reason: "tenant_quota_exhausted" };
    }
    if (allocation !== undefined && mUsed >= allocation) {
      // member cap reached — tenant counter MUST NOT move (all-or-nothing)
      return { outcome: "denied", reason: "member_allocation_exhausted" };
    }

    this.tenantUsed.set(tKey, tUsed + 1);
    if (allocation !== undefined) {
      this.memberUsed.set(mKey, mUsed + 1);
    }
    this.ledger.set(opKey, { decision: "allowed" });
    return { outcome: "consumed" };
    // --- end atomic critical section ---
  }
}

function allowEntitlement(tier: "free" | "pro" = "free") {
  return {
    check: vi.fn(async (): Promise<EntitlementDecision> => ({
      allowed: true,
      tier,
      source: tier === "pro" ? "system" : "backfill",
    })),
  };
}

describe("CheckAndConsumeQuota", () => {
  it("rejects an empty operation key without touching the ledger (operation_key_required)", async () => {
    const ledger = new FakeLedger();
    const uc = new CheckAndConsumeQuota(allowEntitlement(), ledger);

    const decision = await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "   ", NOW);

    expect(decision).toEqual({ allowed: false, reason: "operation_key_required" });
    expect(ledger.consumeSpy).not.toHaveBeenCalled();
  });

  it("short-circuits and never consumes when entitlement is denied (fail-closed)", async () => {
    const ledger = new FakeLedger();
    const entitlement = {
      check: vi.fn(async (): Promise<EntitlementDecision> => ({ allowed: false, reason: "premium_required" })),
    };
    const uc = new CheckAndConsumeQuota(entitlement, ledger);

    const decision = await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "memory_retrieval", "op-1", NOW);

    expect(decision).toEqual({ allowed: false, reason: "premium_required" });
    expect(ledger.consumeSpy).not.toHaveBeenCalled();
  });

  it("meters the Free boundary: one generation is allowed and consumed once", async () => {
    const ledger = new FakeLedger();
    const uc = new CheckAndConsumeQuota(allowEntitlement("free"), ledger);

    const decision = await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "op-1", NOW);

    expect(decision).toMatchObject({ allowed: true, tier: "free", period: PERIOD });
    expect(ledger.tenantUsage("t", "plan_generation", PERIOD)).toBe(1);
  });

  it("denies the next Free generation with tenant_quota_exhausted once the pool is spent", async () => {
    const ledger = new FakeLedger();
    const uc = new CheckAndConsumeQuota(allowEntitlement("free"), ledger);

    await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "op-1", NOW);
    const second = await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "op-2", NOW);

    expect(second).toEqual({ allowed: false, reason: "tenant_quota_exhausted" });
    expect(ledger.tenantUsage("t", "plan_generation", PERIOD)).toBe(1);
  });

  it("returns the prior decision on idempotent retry without consuming again", async () => {
    const ledger = new FakeLedger();
    const uc = new CheckAndConsumeQuota(allowEntitlement("free"), ledger);

    const first = await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "op-K", NOW);
    const retry = await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "op-K", NOW);

    expect(first).toMatchObject({ allowed: true });
    expect(retry).toMatchObject({ allowed: true });
    // Retry replays — the counter is NOT incremented a second time.
    expect(ledger.tenantUsage("t", "plan_generation", PERIOD)).toBe(1);
    expect(ledger.consumeSpy).toHaveBeenCalledTimes(2);
  });

  it("denies member_allocation_exhausted while the tenant pool remains, leaving the tenant counter untouched", async () => {
    const ledger = new FakeLedger();
    // Pro tenant → large tenant pool, but this member's allocation is fully spent.
    ledger.setMemberAllocation("t", "u", "memory_write", PERIOD, 1);
    const uc = new CheckAndConsumeQuota(allowEntitlement("pro"), ledger);

    const first = await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "memory_write", "op-1", NOW);
    const second = await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "memory_write", "op-2", NOW);

    expect(first).toMatchObject({ allowed: true });
    expect(second).toEqual({ allowed: false, reason: "member_allocation_exhausted" });
    // Atomicity: the denied attempt did NOT advance the tenant aggregate beyond the allowed one.
    expect(ledger.tenantUsage("t", "memory_write", PERIOD)).toBe(1);
    expect(ledger.memberUsage("t", "u", "memory_write", PERIOD)).toBe(1);
  });

  it("does not cache a capacity-exhaustion denial: a same-key retry after an upgrade is re-evaluated and consumes", async () => {
    const ledger = new FakeLedger();
    // Free tenant with a plan_generation pool of 1.
    const free = new CheckAndConsumeQuota(allowEntitlement("free"), ledger);

    // Spec A consumes the sole Free unit; spec B is denied (pool exhausted).
    const specA = await free.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "plan_generation:A", NOW);
    const specBDenied = await free.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "plan_generation:B", NOW);
    expect(specA).toMatchObject({ allowed: true });
    expect(specBDenied).toEqual({ allowed: false, reason: "tenant_quota_exhausted" });

    // Mid-period upgrade to Pro over the SAME ledger. Retrying spec B with the
    // SAME deterministic key must be re-evaluated (Pro pool has room) and
    // consume — NOT replay the stale capacity denial.
    const pro = new CheckAndConsumeQuota(allowEntitlement("pro"), ledger);
    const specBRetry = await pro.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "plan_generation:B", NOW);

    expect(specBRetry).toMatchObject({ allowed: true, tier: "pro" });
    // specA + the re-evaluated specB.
    expect(ledger.tenantUsage("t", "plan_generation", PERIOD)).toBe(2);
  });

  it("is race-safe: two members contending for the final tenant unit yield exactly one success", async () => {
    const ledger = new FakeLedger();
    // Free tenant → aggregate pool of 1 plan_generation for the whole tenant.
    const ucA = new CheckAndConsumeQuota(allowEntitlement("free"), ledger);
    const ucB = new CheckAndConsumeQuota(allowEntitlement("free"), ledger);

    const [a, b] = await Promise.all([
      ucA.checkAndConsume({ tenantId: "t", userId: "member-a" }, "plan_generation", "op-a", NOW),
      ucB.checkAndConsume({ tenantId: "t", userId: "member-b" }, "plan_generation", "op-b", NOW),
    ]);

    const allowed = [a, b].filter((d) => d.allowed);
    const denied = [a, b].filter((d) => !d.allowed);
    expect(allowed).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ reason: "tenant_quota_exhausted" });
    // The aggregate counter is never over-consumed.
    expect(ledger.tenantUsage("t", "plan_generation", PERIOD)).toBe(1);
  });
});
