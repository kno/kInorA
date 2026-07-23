/**
 * Real-Postgres integration coverage for `BillingVisibilityRepository` (11a
 * Phase 4).
 *
 * Proves the member-facing visibility persistence contract that the
 * pure-fake route/use-case suite (`routes/__tests__/billing-visibility.test.ts`)
 * cannot: that `loadContext` correctly resolves the tenant billing row + any
 * active override (including its `endsAt`), and that `readOwnMemberUsage` is
 * scoped to a single `(tenantId, userId)` pair — never another member's rows,
 * even when both members have counters in the same tenant/period.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * `billing-admin.integration.test.ts`) — skipped when no real Postgres is
 * wired so the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../client.js";
import {
  memberQuotaCounters,
  memberships,
  tenantBillingOverrides,
  tenantBillingStates,
  tenantQuotaCounters,
  tenants,
  users,
} from "../../schema.js";
import { BillingVisibilityRepository } from "../billing-visibility.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("BillingVisibilityRepository (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const repo = new BillingVisibilityRepository(db);
  const PERIOD = "2026-07";

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<{
    tenantId: string;
    memberAId: string;
    memberBId: string;
  }> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "billing-visibility-tenant" })
      .returning({ id: tenants.id });
    const [memberA] = await db
      .insert(users)
      .values({ email: `member-a-${Date.now()}-${Math.random()}@example.com` })
      .returning({ id: users.id });
    const [memberB] = await db
      .insert(users)
      .values({ email: `member-b-${Date.now()}-${Math.random()}@example.com` })
      .returning({ id: users.id });
    await db.insert(memberships).values([
      { tenantId: tenant!.id, userId: memberA!.id, role: "member", status: "active" },
      { tenantId: tenant!.id, userId: memberB!.id, role: "member", status: "active" },
    ]);
    return { tenantId: tenant!.id, memberAId: memberA!.id, memberBId: memberB!.id };
  }

  it("loadContext resolves the tenant billing row (no active override)", async () => {
    const { tenantId, memberAId } = await seedTenant();
    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "free",
      status: "active",
      source: "backfill",
    });

    const ctx = await repo.loadContext({ tenantId, userId: memberAId });

    expect(ctx.membershipStatus).toBe("active");
    expect(ctx.billing).toMatchObject({ tier: "free", status: "active", source: "backfill" });
    expect(ctx.activeOverrideTier).toBeNull();
    expect(ctx.activeOverrideEndsAt).toBeNull();
  });

  it("loadContext resolves an active admin override and its endsAt", async () => {
    const { tenantId, memberAId } = await seedTenant();
    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "free",
      status: "active",
      source: "backfill",
    });
    const now = new Date();
    const starts = new Date(now.getTime() - 60_000);
    const ends = new Date(now.getTime() + 60_000);
    await db.insert(tenantBillingOverrides).values({
      tenantId,
      tier: "pro",
      startsAt: starts,
      endsAt: ends,
      createdByUserId: memberAId,
      reason: "integration-test override",
    });

    const ctx = await repo.loadContext({ tenantId, userId: memberAId });

    expect(ctx.activeOverrideTier).toBe("pro");
    expect(ctx.activeOverrideEndsAt?.getTime()).toBe(ends.getTime());
  });

  it("readOwnMemberUsage returns ONLY the requested member's rows, never another member's", async () => {
    const { tenantId, memberAId, memberBId } = await seedTenant();
    await db.insert(memberQuotaCounters).values([
      { tenantId, userId: memberAId, feature: "plan_generation", period: PERIOD, used: 1, limit: 1 },
      { tenantId, userId: memberBId, feature: "plan_generation", period: PERIOD, used: 0, limit: 1 },
    ]);

    const usageA = await repo.readOwnMemberUsage(tenantId, memberAId, PERIOD);
    const usageB = await repo.readOwnMemberUsage(tenantId, memberBId, PERIOD);

    expect(usageA).toEqual([
      { userId: memberAId, feature: "plan_generation", period: PERIOD, used: 1, limit: 1 },
    ]);
    expect(usageB).toEqual([
      { userId: memberBId, feature: "plan_generation", period: PERIOD, used: 0, limit: 1 },
    ]);
    // Structural privacy proof: A's read never contains B's userId, and vice versa.
    expect(usageA.every((row) => row.userId === memberAId)).toBe(true);
    expect(usageB.every((row) => row.userId === memberBId)).toBe(true);
  });

  it("readTenantUsage returns aggregate counts scoped to the tenant only", async () => {
    const { tenantId } = await seedTenant();
    await db.insert(tenantQuotaCounters).values({
      tenantId,
      feature: "plan_generation",
      period: PERIOD,
      used: 5,
      limit: 1_000_000,
    });

    const tenantUsage = await repo.readTenantUsage(tenantId, PERIOD);

    expect(tenantUsage).toEqual([
      { feature: "plan_generation", period: PERIOD, used: 5, limit: 1_000_000 },
    ]);
  });
});

describe.skipIf(hasDb)("BillingVisibilityRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
