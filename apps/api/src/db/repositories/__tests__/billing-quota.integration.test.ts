/**
 * Real-Postgres integration coverage for `QuotaLedgerRepository.consume`.
 *
 * Reproduces two review-confirmed CRITICAL defects that the pure-fake unit
 * suite (`billing/__tests__/quota-consumption.test.ts`) could not surface
 * because its `FakeLedger` decided against the passed `tenantLimit` directly
 * and had no real transaction/lock semantics:
 *
 *   1. Concurrent same-key double-consume — the idempotency replay SELECT ran
 *      BEFORE the tenant-counter `SELECT ... FOR UPDATE`, so two concurrent
 *      requests with the SAME operationKey both passed the replay check and
 *      both incremented.
 *   2. Stale counter limit — the decision compared `used` against the STORED
 *      counter `limit` column (fixed at first insert) instead of the freshly
 *      resolved `tenantLimit`, so a tenant whose effective tier downgrades
 *      mid-period (e.g. trial expiry) kept the old, higher cap for the rest
 *      of the period.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern used
 * in the Slice 1 runtime harness) — skipped when no real Postgres is wired so
 * the default `vitest run` stays hermetic.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import {
  billingUsageLedger,
  memberQuotaAllocations,
  memberQuotaCounters,
  memberships,
  tenants,
  users,
} from "../../schema.js";
import { QuotaLedgerRepository } from "../billing-quota.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("QuotaLedgerRepository (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const repo = new QuotaLedgerRepository(db);
  const PERIOD = "2026-07";

  afterAll(async () => {
    await pool.end();
  });

  async function seedActiveTenant(): Promise<{ tenantId: string; userId: string }> {
    const [tenant] = await db.insert(tenants).values({ name: "billing-fix-tenant" }).returning({ id: tenants.id });
    const [user] = await db
      .insert(users)
      .values({ email: `billing-fix-${Date.now()}-${Math.random()}@example.com` })
      .returning({ id: users.id });
    await db.insert(memberships).values({
      tenantId: tenant!.id,
      userId: user!.id,
      role: "owner",
      status: "active",
    });
    return { tenantId: tenant!.id, userId: user!.id };
  }

  it("CRITICAL 1: two concurrent requests with the SAME operation key consume exactly once", async () => {
    const { tenantId, userId } = await seedActiveTenant();
    const scope = { tenantId, userId };

    const [first, second] = await Promise.all([
      repo.consume({ scope, feature: "memory_write", period: PERIOD, operationKey: "same-key", tenantLimit: 1_000_000 }),
      repo.consume({ scope, feature: "memory_write", period: PERIOD, operationKey: "same-key", tenantLimit: 1_000_000 }),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    // Exactly one call actually consumed; the concurrent duplicate replays the
    // winner's decision — it must NEVER also report "consumed".
    expect(outcomes).toEqual(["consumed", "replayed"]);
    const replayed = first.outcome === "replayed" ? first : second;
    expect(replayed).toMatchObject({ outcome: "replayed", prior: "allowed" });

    const [counter] = await db.query.tenantQuotaCounters.findMany({
      where: (t, { and: andOp, eq: eqOp }) => andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "memory_write")),
    });
    // The aggregate counter must reflect exactly ONE consumption, not two.
    expect(counter?.used).toBe(1);
  });

  it("CRITICAL 1: a retried same-key request after the first commits replays without consuming again", async () => {
    const { tenantId, userId } = await seedActiveTenant();
    const scope = { tenantId, userId };

    const first = await repo.consume({
      scope,
      feature: "plan_generation",
      period: PERIOD,
      operationKey: "retry-key",
      tenantLimit: 1,
    });
    const retry = await repo.consume({
      scope,
      feature: "plan_generation",
      period: PERIOD,
      operationKey: "retry-key",
      tenantLimit: 1,
    });

    expect(first.outcome).toBe("consumed");
    expect(retry).toEqual({ outcome: "replayed", prior: "allowed", reason: undefined });

    const [counter] = await db.query.tenantQuotaCounters.findMany({
      where: (t, { and: andOp, eq: eqOp }) => andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "plan_generation")),
    });
    expect(counter?.used).toBe(1);
  });

  it("a capacity-exhaustion denial is NOT cached: a same-key retry after an upgrade is re-evaluated and consumes", async () => {
    const { tenantId, userId } = await seedActiveTenant();
    const scope = { tenantId, userId };

    // Spec A consumes the sole Free plan_generation unit.
    const specA = await repo.consume({
      scope,
      feature: "plan_generation",
      period: PERIOD,
      operationKey: "plan_generation:spec-A",
      tenantLimit: 1,
    });
    expect(specA.outcome).toBe("consumed");

    // Spec B is denied — the Free tenant pool is exhausted. The confirm route
    // uses a DETERMINISTIC operation key (`plan_generation:<specId>`), so this
    // denial must NOT be cached as an idempotent outcome.
    const specBDenied = await repo.consume({
      scope,
      feature: "plan_generation",
      period: PERIOD,
      operationKey: "plan_generation:spec-B",
      tenantLimit: 1,
    });
    expect(specBDenied).toEqual({ outcome: "denied", reason: "tenant_quota_exhausted" });

    // Mid-period upgrade to Pro → a fresh, higher tenantLimit. Retrying spec B
    // with the SAME deterministic key must now be RE-EVALUATED against current
    // entitlement and consume — not replay the stale capacity denial.
    const specBRetry = await repo.consume({
      scope,
      feature: "plan_generation",
      period: PERIOD,
      operationKey: "plan_generation:spec-B",
      tenantLimit: 1_000_000,
    });
    expect(specBRetry.outcome).toBe("consumed");

    const [counter] = await db.query.tenantQuotaCounters.findMany({
      where: (t, { and: andOp, eq: eqOp }) => andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "plan_generation")),
    });
    // specA + the re-evaluated specB = 2 consumed units.
    expect(counter?.used).toBe(2);
  });

  it("#171: an inactive-membership denial is NOT cached; reactivation lets the SAME operation key be re-evaluated and consume", async () => {
    const { tenantId, userId } = await seedActiveTenant();
    const scope = { tenantId, userId };
    const operationKey = "plan_generation:reactivate";

    // Suspend the member AFTER the entitlement read would have passed — the
    // in-transaction fail-closed re-check inside consume() catches it and denies.
    await db
      .update(memberships)
      .set({ status: "suspended" })
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));

    const denied = await repo.consume({
      scope,
      feature: "plan_generation",
      period: PERIOD,
      operationKey,
      tenantLimit: 1,
    });
    expect(denied).toEqual({ outcome: "denied", reason: "inactive_membership" });

    // The transient denial MUST NOT be persisted to the idempotency ledger —
    // otherwise the deterministic operation key would replay this stale 403
    // forever, locking a reactivated member out for the rest of the period.
    const ledgerRows = await db
      .select()
      .from(billingUsageLedger)
      .where(
        and(
          eq(billingUsageLedger.tenantId, tenantId),
          eq(billingUsageLedger.userId, userId),
          eq(billingUsageLedger.operationKey, operationKey),
        ),
      );
    expect(ledgerRows).toHaveLength(0);

    // Reactivate the membership and retry with the SAME deterministic key. It
    // must be RE-EVALUATED (now active + pool has room) and consume — not replay
    // the stale inactive_membership denial.
    await db
      .update(memberships)
      .set({ status: "active" })
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));

    const retry = await repo.consume({
      scope,
      feature: "plan_generation",
      period: PERIOD,
      operationKey,
      tenantLimit: 1,
    });
    expect(retry.outcome).toBe("consumed");

    const [counter] = await db.query.tenantQuotaCounters.findMany({
      where: (t, { and: andOp, eq: eqOp }) => andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "plan_generation")),
    });
    expect(counter?.used).toBe(1);
  });

  it("CRITICAL 2: a mid-period tier downgrade (fresh lower tenantLimit) is enforced, not the stale stored limit", async () => {
    const { tenantId, userId } = await seedActiveTenant();
    const scope = { tenantId, userId };

    // First consume while the tenant is still Pro-trial: counter row is
    // created (and, pre-fix, permanently fixed) with a generous limit.
    const proConsume = await repo.consume({
      scope,
      feature: "memory_write",
      period: PERIOD,
      operationKey: "op-pro",
      tenantLimit: 1_000_000,
    });
    expect(proConsume.outcome).toBe("consumed");

    // Trial expires mid-period → effective tier is now Free → the entitlement
    // use case resolves a fresh, much lower tenantLimit for the SAME period.
    const freeConsume = await repo.consume({
      scope,
      feature: "memory_write",
      period: PERIOD,
      operationKey: "op-free",
      tenantLimit: 1,
    });

    // used=1 already >= the freshly-resolved Free limit of 1 → must deny.
    expect(freeConsume).toEqual({ outcome: "denied", reason: "tenant_quota_exhausted" });
  });

  // #174 memory_write compensation: a terminal embed/store failure after a
  // FRESH consume must NOT permanently spend a unit. `refund` reverses exactly
  // what a single consume did — atomically deletes the idempotency ledger row
  // and decrements the counters — so the unit is released.
  describe("refund (memory_write compensation)", () => {
    it("atomically releases a freshly consumed unit: counter back to zero, ledger row gone", async () => {
      const { tenantId, userId } = await seedActiveTenant();
      const scope = { tenantId, userId };
      const operationKey = "memory_write:fact-refund";

      const consumed = await repo.consume({
        scope,
        feature: "memory_write",
        period: PERIOD,
        operationKey,
        tenantLimit: 1_000_000,
      });
      expect(consumed.outcome).toBe("consumed");

      const refund = await repo.refund({ scope, feature: "memory_write", period: PERIOD, operationKey });
      expect(refund).toEqual({ outcome: "refunded" });

      const [counter] = await db.query.tenantQuotaCounters.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "memory_write")),
      });
      expect(counter?.used).toBe(0);

      const ledgerRows = await db
        .select()
        .from(billingUsageLedger)
        .where(
          and(
            eq(billingUsageLedger.tenantId, tenantId),
            eq(billingUsageLedger.userId, userId),
            eq(billingUsageLedger.operationKey, operationKey),
          ),
        );
      expect(ledgerRows).toHaveLength(0);
    });

    it("lets a later attempt for the SAME fact re-consume and store — net exactly one unit", async () => {
      const { tenantId, userId } = await seedActiveTenant();
      const scope = { tenantId, userId };
      const operationKey = "memory_write:fact-retry";

      await repo.consume({ scope, feature: "memory_write", period: PERIOD, operationKey, tenantLimit: 5 });
      await repo.refund({ scope, feature: "memory_write", period: PERIOD, operationKey });

      // The voided ledger row means this is a FRESH consume again, not a replay.
      const retry = await repo.consume({
        scope,
        feature: "memory_write",
        period: PERIOD,
        operationKey,
        tenantLimit: 5,
      });
      expect(retry.outcome).toBe("consumed");

      const [counter] = await db.query.tenantQuotaCounters.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "memory_write")),
      });
      expect(counter?.used).toBe(1);
    });

    it("is a no-op for a never-consumed operation key and never drives the counter negative", async () => {
      const { tenantId, userId } = await seedActiveTenant();
      const scope = { tenantId, userId };

      const refund = await repo.refund({
        scope,
        feature: "memory_write",
        period: PERIOD,
        operationKey: "memory_write:never",
      });
      expect(refund).toEqual({ outcome: "noop" });

      const counters = await db.query.tenantQuotaCounters.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "memory_write")),
      });
      // No consume happened, so no counter row should have been created either.
      expect(counters).toHaveLength(0);
    });

    it("guards double-refund: the second refund is a no-op and the counter never goes negative", async () => {
      const { tenantId, userId } = await seedActiveTenant();
      const scope = { tenantId, userId };
      const operationKey = "memory_write:double";

      await repo.consume({ scope, feature: "memory_write", period: PERIOD, operationKey, tenantLimit: 5 });
      const first = await repo.refund({ scope, feature: "memory_write", period: PERIOD, operationKey });
      const second = await repo.refund({ scope, feature: "memory_write", period: PERIOD, operationKey });

      expect(first).toEqual({ outcome: "refunded" });
      expect(second).toEqual({ outcome: "noop" });

      const [counter] = await db.query.tenantQuotaCounters.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "memory_write")),
      });
      expect(counter?.used).toBe(0);
    });

    it("also decrements the per-member allocation counter, mirroring consume", async () => {
      const { tenantId, userId } = await seedActiveTenant();
      const scope = { tenantId, userId };
      const operationKey = "memory_write:alloc";

      await db.insert(memberQuotaAllocations).values({
        tenantId,
        userId,
        feature: "memory_write",
        period: PERIOD,
        limit: 5,
        updatedByUserId: userId,
      });

      await repo.consume({ scope, feature: "memory_write", period: PERIOD, operationKey, tenantLimit: 1_000_000 });
      const [beforeMember] = await db
        .select()
        .from(memberQuotaCounters)
        .where(
          and(
            eq(memberQuotaCounters.tenantId, tenantId),
            eq(memberQuotaCounters.userId, userId),
            eq(memberQuotaCounters.feature, "memory_write"),
          ),
        );
      expect(beforeMember?.used).toBe(1);

      await repo.refund({ scope, feature: "memory_write", period: PERIOD, operationKey });

      const [afterMember] = await db
        .select()
        .from(memberQuotaCounters)
        .where(
          and(
            eq(memberQuotaCounters.tenantId, tenantId),
            eq(memberQuotaCounters.userId, userId),
            eq(memberQuotaCounters.feature, "memory_write"),
          ),
        );
      expect(afterMember?.used).toBe(0);

      const [tenantCounter] = await db.query.tenantQuotaCounters.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "memory_write")),
      });
      expect(tenantCounter?.used).toBe(0);
    });

    it("concurrent same-key consume yields one fresh unit; a single refund releases exactly it", async () => {
      const { tenantId, userId } = await seedActiveTenant();
      const scope = { tenantId, userId };
      const operationKey = "memory_write:concurrent";

      const [first, second] = await Promise.all([
        repo.consume({ scope, feature: "memory_write", period: PERIOD, operationKey, tenantLimit: 1_000_000 }),
        repo.consume({ scope, feature: "memory_write", period: PERIOD, operationKey, tenantLimit: 1_000_000 }),
      ]);
      expect([first.outcome, second.outcome].sort()).toEqual(["consumed", "replayed"]);

      const [afterConsume] = await db.query.tenantQuotaCounters.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "memory_write")),
      });
      expect(afterConsume?.used).toBe(1);

      // Only the fresh consumer compensates; a single refund brings it to zero
      // and a redundant refund is a no-op (never negative).
      const refund = await repo.refund({ scope, feature: "memory_write", period: PERIOD, operationKey });
      expect(refund).toEqual({ outcome: "refunded" });
      const redundant = await repo.refund({ scope, feature: "memory_write", period: PERIOD, operationKey });
      expect(redundant).toEqual({ outcome: "noop" });

      const [afterRefund] = await db.query.tenantQuotaCounters.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "memory_write")),
      });
      expect(afterRefund?.used).toBe(0);
    });

    // #174 FIX A: consume decides whether to touch the MEMBER counter based on
    // allocation existence AT CONSUME TIME. The void MUST reverse based on
    // that SAME recorded fact — never by re-reading current allocation
    // existence — or an admin changing the allocation between consume and
    // void desyncs the mirror.
    it("FIX A: an allocation ADDED after a no-allocation consume must NOT make the void decrement a counter this op never touched", async () => {
      const { tenantId, userId } = await seedActiveTenant();
      const scope = { tenantId, userId };
      const opNoAlloc = "memory_write:fixA-add-alloc-op1";
      const opWithAlloc = "memory_write:fixA-add-alloc-op2";

      // op1 consumes with NO allocation in effect — member counter untouched.
      const op1 = await repo.consume({
        scope,
        feature: "memory_write",
        period: PERIOD,
        operationKey: opNoAlloc,
        tenantLimit: 1_000_000,
      });
      expect(op1.outcome).toBe("consumed");

      // An admin adds a per-member allocation AFTER op1's consume.
      await db.insert(memberQuotaAllocations).values({
        tenantId,
        userId,
        feature: "memory_write",
        period: PERIOD,
        limit: 1,
        updatedByUserId: userId,
      });

      // op2 consumes WITH the allocation now in effect — spends the sole
      // member unit. This models "another operation's real usage" that a
      // buggy void of op1 must never corrupt.
      const op2 = await repo.consume({
        scope,
        feature: "memory_write",
        period: PERIOD,
        operationKey: opWithAlloc,
        tenantLimit: 1_000_000,
      });
      expect(op2.outcome).toBe("consumed");

      const [memberBefore] = await db
        .select()
        .from(memberQuotaCounters)
        .where(
          and(
            eq(memberQuotaCounters.tenantId, tenantId),
            eq(memberQuotaCounters.userId, userId),
            eq(memberQuotaCounters.feature, "memory_write"),
          ),
        );
      expect(memberBefore?.used).toBe(1);

      // Void op1 (never touched the member counter). A buggy void that
      // re-reads CURRENT allocation existence would wrongly decrement op2's
      // real usage here. The fix must leave the member counter untouched.
      const refundOp1 = await repo.refund({
        scope,
        feature: "memory_write",
        period: PERIOD,
        operationKey: opNoAlloc,
      });
      expect(refundOp1).toEqual({ outcome: "refunded" });

      const [memberAfter] = await db
        .select()
        .from(memberQuotaCounters)
        .where(
          and(
            eq(memberQuotaCounters.tenantId, tenantId),
            eq(memberQuotaCounters.userId, userId),
            eq(memberQuotaCounters.feature, "memory_write"),
          ),
        );
      // Op2's real usage must survive op1's void untouched.
      expect(memberAfter?.used).toBe(1);

      // The tenant aggregate DOES reflect op1's own reversal (2 consumed - 1 voided = 1).
      const [tenantCounter] = await db.query.tenantQuotaCounters.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantId, tenantId), eqOp(t.feature, "memory_write")),
      });
      expect(tenantCounter?.used).toBe(1);

      // Proves the allocation is still correctly enforced at exactly 1: a
      // third consume attempt must be denied (member_allocation_exhausted),
      // not silently allowed because a buggy void freed capacity op1 never held.
      const op3 = await repo.consume({
        scope,
        feature: "memory_write",
        period: PERIOD,
        operationKey: "memory_write:fixA-add-alloc-op3",
        tenantLimit: 1_000_000,
      });
      expect(op3).toEqual({ outcome: "denied", reason: "member_allocation_exhausted" });
    });

    it("FIX A: an allocation REMOVED after a with-allocation consume must still let the void release the member unit it incremented (no leak)", async () => {
      const { tenantId, userId } = await seedActiveTenant();
      const scope = { tenantId, userId };
      const operationKey = "memory_write:fixA-remove-alloc";

      await db.insert(memberQuotaAllocations).values({
        tenantId,
        userId,
        feature: "memory_write",
        period: PERIOD,
        limit: 5,
        updatedByUserId: userId,
      });

      const consumed = await repo.consume({
        scope,
        feature: "memory_write",
        period: PERIOD,
        operationKey,
        tenantLimit: 1_000_000,
      });
      expect(consumed.outcome).toBe("consumed");

      const [memberBefore] = await db
        .select()
        .from(memberQuotaCounters)
        .where(
          and(
            eq(memberQuotaCounters.tenantId, tenantId),
            eq(memberQuotaCounters.userId, userId),
            eq(memberQuotaCounters.feature, "memory_write"),
          ),
        );
      expect(memberBefore?.used).toBe(1);

      // Admin REMOVES the per-member allocation before the compensating void.
      await db
        .delete(memberQuotaAllocations)
        .where(
          and(
            eq(memberQuotaAllocations.tenantId, tenantId),
            eq(memberQuotaAllocations.userId, userId),
            eq(memberQuotaAllocations.feature, "memory_write"),
            eq(memberQuotaAllocations.period, PERIOD),
          ),
        );

      // A buggy void that re-reads CURRENT allocation existence would find
      // none and skip the decrement — leaking the member unit forever.
      const refund = await repo.refund({ scope, feature: "memory_write", period: PERIOD, operationKey });
      expect(refund).toEqual({ outcome: "refunded" });

      const [memberAfter] = await db
        .select()
        .from(memberQuotaCounters)
        .where(
          and(
            eq(memberQuotaCounters.tenantId, tenantId),
            eq(memberQuotaCounters.userId, userId),
            eq(memberQuotaCounters.feature, "memory_write"),
          ),
        );
      // The member counter row still exists (allocation row deletion doesn't
      // cascade to it) and must be correctly reversed to 0 — no leak.
      expect(memberAfter?.used).toBe(0);
    });
  });
});

describe.skipIf(hasDb)("QuotaLedgerRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
