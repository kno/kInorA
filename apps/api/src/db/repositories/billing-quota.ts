import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  billingUsageLedger,
  memberQuotaAllocations,
  memberQuotaCounters,
  memberships,
  tenantBillingOverrides,
  tenantBillingStates,
  tenantQuotaCounters,
} from "../schema.js";
import type {
  EntitlementContext,
  EntitlementReaderPort,
} from "../../billing/entitlement.js";
import type {
  QuotaLedgerConsumeInput,
  QuotaLedgerConsumeResult,
  QuotaLedgerPort,
  QuotaLedgerRefundInput,
  QuotaLedgerRefundResult,
} from "../../billing/quota-consumption.js";
import type { BillingScope } from "../../billing/types.js";

/**
 * The transaction handle Drizzle passes to a `db.transaction(cb)` callback.
 * Extracted as a named alias so the doubly-nested `Parameters<...>` type is
 * declared once and reused wherever a `tx` is threaded through a helper.
 */
type BillingTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Drizzle adapter for the entitlement reader port. Lives under `db/` because
 * `.dependency-cruiser.cjs` forbids importing drizzle/pg outside the infra
 * layer; the pure use cases in `billing/` depend only on this port interface.
 */
export class BillingStateReaderRepository implements EntitlementReaderPort {
  constructor(private readonly db: Database) {}

  async loadContext(scope: BillingScope): Promise<EntitlementContext> {
    const now = new Date();

    const [membershipRow] = await this.db
      .select({ status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.userId, scope.userId)));

    const [billingRow] = await this.db
      .select({
        tier: tenantBillingStates.tier,
        status: tenantBillingStates.status,
        source: tenantBillingStates.source,
        trialStartedAt: tenantBillingStates.trialStartedAt,
        trialEndsAt: tenantBillingStates.trialEndsAt,
      })
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, scope.tenantId));

    const [overrideRow] = await this.db
      .select({ tier: tenantBillingOverrides.tier })
      .from(tenantBillingOverrides)
      .where(
        and(
          eq(tenantBillingOverrides.tenantId, scope.tenantId),
          lte(tenantBillingOverrides.startsAt, now),
          gt(tenantBillingOverrides.endsAt, now),
        ),
      )
      .orderBy(tenantBillingOverrides.endsAt);

    return {
      membershipStatus: membershipRow?.status ?? null,
      billing: billingRow
        ? {
            tier: billingRow.tier,
            status: billingRow.status,
            source: billingRow.source,
            trialStartedAt: billingRow.trialStartedAt,
            trialEndsAt: billingRow.trialEndsAt,
          }
        : null,
      activeOverrideTier: overrideRow?.tier ?? null,
    };
  }
}

/**
 * Drizzle adapter for the atomic quota ledger. `consume` runs a single
 * transaction that enforces, in order:
 *   1. idempotency — a prior ledger row for the operation key replays its decision
 *   2. fail-closed membership re-check inside the transaction
 *   3. all-or-nothing: BOTH the tenant aggregate counter and (when a per-member
 *      allocation exists) the member counter must have room before EITHER moves
 *
 * Counter rows are locked with `SELECT ... FOR UPDATE` so two concurrent
 * consumers racing the final tenant unit serialize — the second observes the
 * committed increment and is denied, never over-consuming.
 */
export class QuotaLedgerRepository implements QuotaLedgerPort {
  constructor(private readonly db: Database) {}

  async consume(input: QuotaLedgerConsumeInput): Promise<QuotaLedgerConsumeResult> {
    const { scope, feature, period, operationKey, tenantLimit } = input;

    return this.db.transaction(async (tx) => {
      // 1. Ensure + lock the tenant aggregate counter FIRST. Locking here
      // (keyed by tenantId+feature+period) serializes EVERY consume attempt
      // for this scope — including concurrent duplicates of the SAME
      // operationKey. This makes the idempotency re-check below (step 2)
      // race-free: a losing duplicate blocks on this lock until the winner
      // commits, then observes the winner's committed ledger row and replays
      // instead of double-consuming (fixes CRITICAL 1).
      await tx
        .insert(tenantQuotaCounters)
        .values({ tenantId: scope.tenantId, feature, period, used: 0, limit: tenantLimit })
        .onConflictDoNothing();
      const [tenantCounter] = await tx
        .select({ used: tenantQuotaCounters.used })
        .from(tenantQuotaCounters)
        .where(
          and(
            eq(tenantQuotaCounters.tenantId, scope.tenantId),
            eq(tenantQuotaCounters.feature, feature),
            eq(tenantQuotaCounters.period, period),
          ),
        )
        .for("update");

      // 2. Idempotency re-check — now INSIDE the lock. A concurrent duplicate
      // of the same operationKey is guaranteed to see the winner's ledger row.
      const [existing] = await tx
        .select({ decision: billingUsageLedger.decision, reason: billingUsageLedger.reason })
        .from(billingUsageLedger)
        .where(
          and(
            eq(billingUsageLedger.tenantId, scope.tenantId),
            eq(billingUsageLedger.userId, scope.userId),
            eq(billingUsageLedger.feature, feature),
            eq(billingUsageLedger.period, period),
            eq(billingUsageLedger.operationKey, operationKey),
          ),
        );
      if (existing) {
        return {
          outcome: "replayed",
          prior: existing.decision,
          reason: existing.decision === "denied" ? (existing.reason as never) : undefined,
        };
      }

      // 3. Fail-closed membership re-check. `inactive_membership` is a TRANSIENT
      // denial, exactly like the capacity denials below: a suspended member can
      // be reactivated mid-period, so the denial reflects only the state at this
      // instant. It is therefore NOT persisted to the idempotency ledger —
      // persisting it would replay the stale 403 under the deterministic
      // operation key forever, locking a reactivated member out for the rest of
      // the period. No counter advanced, so there is nothing to make idempotent;
      // the retry is safely re-evaluated against current membership.
      const [membershipRow] = await tx
        .select({ status: memberships.status })
        .from(memberships)
        .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.userId, scope.userId)));
      if (!membershipRow || membershipRow.status !== "active") {
        return { outcome: "denied", reason: "inactive_membership" };
      }

      // 4. Resolve the optional per-member allocation and lock its counter.
      const [allocationRow] = await tx
        .select({ limit: memberQuotaAllocations.limit })
        .from(memberQuotaAllocations)
        .where(
          and(
            eq(memberQuotaAllocations.tenantId, scope.tenantId),
            eq(memberQuotaAllocations.userId, scope.userId),
            eq(memberQuotaAllocations.feature, feature),
            eq(memberQuotaAllocations.period, period),
          ),
        );
      const allocationLimit = allocationRow?.limit ?? null;

      let memberCounterUsed = 0;
      if (allocationLimit !== null) {
        await tx
          .insert(memberQuotaCounters)
          .values({
            tenantId: scope.tenantId,
            userId: scope.userId,
            feature,
            period,
            used: 0,
            limit: allocationLimit,
          })
          .onConflictDoNothing();
        const [memberCounter] = await tx
          .select({ used: memberQuotaCounters.used })
          .from(memberQuotaCounters)
          .where(
            and(
              eq(memberQuotaCounters.tenantId, scope.tenantId),
              eq(memberQuotaCounters.userId, scope.userId),
              eq(memberQuotaCounters.feature, feature),
              eq(memberQuotaCounters.period, period),
            ),
          )
          .for("update");
        memberCounterUsed = memberCounter?.used ?? 0;
      }

      // 5. Decide all-or-nothing against the LOCKED usage rows and the
      // FRESHLY resolved tenantLimit — never the stored counter `limit`
      // column, which is only written once at first insert and can go stale
      // across a mid-period tier change (e.g. trial expiry). The caller
      // (CheckAndConsumeQuota) always re-resolves tenantLimit from the
      // current entitlement on every call, so comparing against it here
      // fixes CRITICAL 2.
      // Capacity-exhaustion denials (`tenant_quota_exhausted`,
      // `member_allocation_exhausted`) are TRANSIENT: they reflect the current
      // period usage against the currently-resolved limit, both of which can
      // change mid-period (upgrade, admin override, per-member allocation bump).
      // They are therefore NOT persisted to the idempotency ledger — persisting
      // them would replay the stale 403 on a legitimate retry even after the
      // tenant is entitled, locking the actor out for the rest of the period
      // under the deterministic confirm key. No counter advanced, so there is
      // nothing to make idempotent; the retry is safely re-evaluated against
      // current entitlement/quota. inactive_membership is treated the same way
      // (fail-closed deny, not persisted) so a reactivated member is
      // re-evaluated on retry rather than locked out by a replayed 403. Only
      // 'allowed' decisions are written to the idempotency ledger.
      const tenantUsed = tenantCounter?.used ?? 0;
      if (tenantUsed >= tenantLimit) {
        return { outcome: "denied", reason: "tenant_quota_exhausted" };
      }
      if (allocationLimit !== null && memberCounterUsed >= allocationLimit) {
        return { outcome: "denied", reason: "member_allocation_exhausted" };
      }

      // 6. Increment both counters — also refreshing the stored `limit` to the
      // resolved value (safe here: the deny checks above already guarantee
      // used < limit before this write, so the non-negative/`used <= limit`
      // check constraints cannot be violated) — and record the allowed
      // ledger row.
      await tx
        .update(tenantQuotaCounters)
        .set({ used: sql`${tenantQuotaCounters.used} + 1`, limit: tenantLimit, updatedAt: new Date() })
        .where(
          and(
            eq(tenantQuotaCounters.tenantId, scope.tenantId),
            eq(tenantQuotaCounters.feature, feature),
            eq(tenantQuotaCounters.period, period),
          ),
        );
      if (allocationLimit !== null) {
        await tx
          .update(memberQuotaCounters)
          .set({ used: sql`${memberQuotaCounters.used} + 1`, limit: allocationLimit, updatedAt: new Date() })
          .where(
            and(
              eq(memberQuotaCounters.tenantId, scope.tenantId),
              eq(memberQuotaCounters.userId, scope.userId),
              eq(memberQuotaCounters.feature, feature),
              eq(memberQuotaCounters.period, period),
            ),
          );
      }
      // #174 FIX A: record on the ledger row, AT THIS INSTANT, whether THIS
      // consume incremented the member counter. `refund` reverses based on
      // this recorded fact — never by re-reading current allocation
      // existence — so an admin adding/removing a per-member allocation
      // between consume and a compensating void can never desync the
      // tenant/member mirror.
      await this.writeLedger(tx, input, "allowed", "allowed", allocationLimit !== null);
      return { outcome: "consumed" };
    });
  }

  /**
   * Compensation for a FRESH `allowed` consume (#174). Runs a single
   * transaction that mirrors `consume` in reverse:
   *   1. lock the tenant counter FIRST (the same lock consume takes) so a void
   *      serializes with any concurrent consume/void for this scope
   *   2. find the ledger row; only an `allowed` row is voidable. A missing or
   *      non-`allowed` row is a no-op — this makes a double-void safe and means
   *      a transient (never-persisted) denial is never "refunded"
   *   3. delete the ledger row so a same-key retry is re-evaluated as a fresh
   *      consume (matching the deterministic-key self-heal)
   *   4. decrement the tenant counter, and — mirroring consume — the per-member
   *      counter when a per-member allocation exists. Both decrements are
   *      floored at 0 (`GREATEST(used - 1, 0)`) so the non-negative check
   *      constraint can never be violated even under an unexpected interleaving.
   */
  async refund(input: QuotaLedgerRefundInput): Promise<QuotaLedgerRefundResult> {
    const { scope, feature, period, operationKey } = input;

    return this.db.transaction(async (tx) => {
      // 1. Lock the tenant aggregate counter FIRST — same serialization point
      // as consume, so a void and a concurrent consume/void for this scope
      // never interleave mid-decrement.
      await tx
        .select({ used: tenantQuotaCounters.used })
        .from(tenantQuotaCounters)
        .where(
          and(
            eq(tenantQuotaCounters.tenantId, scope.tenantId),
            eq(tenantQuotaCounters.feature, feature),
            eq(tenantQuotaCounters.period, period),
          ),
        )
        .for("update");

      // 2. Only a FRESH allowed consume is voidable. A missing row (never
      // consumed / already voided) or a non-allowed row is a safe no-op.
      // `memberCounterCredited` is read here — the fact RECORDED AT CONSUME
      // TIME — so step 4 below reverses exactly what this operation did,
      // regardless of any allocation change since (#174 FIX A).
      const [existing] = await tx
        .select({
          decision: billingUsageLedger.decision,
          memberCounterCredited: billingUsageLedger.memberCounterCredited,
        })
        .from(billingUsageLedger)
        .where(
          and(
            eq(billingUsageLedger.tenantId, scope.tenantId),
            eq(billingUsageLedger.userId, scope.userId),
            eq(billingUsageLedger.feature, feature),
            eq(billingUsageLedger.period, period),
            eq(billingUsageLedger.operationKey, operationKey),
          ),
        );
      if (!existing || existing.decision !== "allowed") {
        return { outcome: "noop" };
      }

      // 3. Delete the ledger row so a retry re-consumes (self-heal) instead of
      // replaying — and so a concurrent double-void finds nothing to reverse.
      await tx
        .delete(billingUsageLedger)
        .where(
          and(
            eq(billingUsageLedger.tenantId, scope.tenantId),
            eq(billingUsageLedger.userId, scope.userId),
            eq(billingUsageLedger.feature, feature),
            eq(billingUsageLedger.period, period),
            eq(billingUsageLedger.operationKey, operationKey),
          ),
        );

      // 4. Reverse the tenant counter (floored at 0).
      await tx
        .update(tenantQuotaCounters)
        .set({
          used: sql`GREATEST(${tenantQuotaCounters.used} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tenantQuotaCounters.tenantId, scope.tenantId),
            eq(tenantQuotaCounters.feature, feature),
            eq(tenantQuotaCounters.period, period),
          ),
        );

      // 5. Reverse the member counter iff THIS op incremented it, per the
      // fact recorded on the ledger row at consume time (step 2) — NEVER by
      // re-reading current `memberQuotaAllocations` existence. Consume
      // decided whether to touch the member counter based on allocation
      // existence AT CONSUME TIME; if refund instead re-read allocation
      // existence AT VOID TIME, an admin change in that window would desync
      // the mirror two ways: adding an allocation after a no-allocation
      // consume would make refund decrement a member counter this op never
      // touched (corrupting another operation's real usage — an under-count
      // that lets the member exceed their allocation by one); removing an
      // allocation after a with-allocation consume would make refund skip
      // the decrement entirely (leaking the member unit forever). Keying off
      // the ledger-recorded fact keeps consume/void symmetric regardless of
      // any allocation change in between (#174 FIX A).
      if (existing.memberCounterCredited) {
        await tx
          .update(memberQuotaCounters)
          .set({
            used: sql`GREATEST(${memberQuotaCounters.used} - 1, 0)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(memberQuotaCounters.tenantId, scope.tenantId),
              eq(memberQuotaCounters.userId, scope.userId),
              eq(memberQuotaCounters.feature, feature),
              eq(memberQuotaCounters.period, period),
            ),
          );
      }

      return { outcome: "refunded" };
    });
  }

  private async writeLedger(
    tx: BillingTx,
    input: QuotaLedgerConsumeInput,
    decision: "allowed" | "denied",
    reason: string,
    memberCounterCredited = false,
  ): Promise<void> {
    await tx
      .insert(billingUsageLedger)
      .values({
        tenantId: input.scope.tenantId,
        userId: input.scope.userId,
        feature: input.feature,
        period: input.period,
        operationKey: input.operationKey,
        decision,
        reason,
        memberCounterCredited,
      })
      .onConflictDoNothing();
  }
}
