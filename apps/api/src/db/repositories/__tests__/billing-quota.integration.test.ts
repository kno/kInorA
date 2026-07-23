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
import { createDbClient } from "../../client.js";
import { memberships, tenants, users } from "../../schema.js";
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
});

describe.skipIf(hasDb)("QuotaLedgerRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
