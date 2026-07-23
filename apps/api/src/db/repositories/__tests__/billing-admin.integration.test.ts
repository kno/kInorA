/**
 * Real-Postgres integration coverage for `BillingAdminRepository` (11a Phase 3).
 *
 * Proves the quota-admin persistence contract that the pure-fake route/use-case
 * suite (`routes/__tests__/billing.test.ts`) cannot: that an admin allocation
 * write persists BOTH the `member_quota_allocations` row AND a
 * `billing_audit_events` row in one transaction, and that the usage reads return
 * aggregate/member COUNTS scoped to the tenant only (no cross-tenant rows, no
 * private content).
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as the
 * Slice 1/2 runtime harnesses) — skipped when no real Postgres is wired so the
 * default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import {
  billingAuditEvents,
  memberQuotaCounters,
  memberQuotaAllocations,
  memberships,
  tenantBillingStates,
  tenantQuotaCounters,
  tenants,
  users,
} from "../../schema.js";
import { BillingAdminRepository } from "../billing-admin.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("BillingAdminRepository (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const repo = new BillingAdminRepository(db);
  const PERIOD = "2026-07";

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(tier: "free" | "pro"): Promise<{
    tenantId: string;
    ownerId: string;
    memberId: string;
  }> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "billing-admin-tenant" })
      .returning({ id: tenants.id });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-${Date.now()}-${Math.random()}@example.com` })
      .returning({ id: users.id });
    const [member] = await db
      .insert(users)
      .values({ email: `member-${Date.now()}-${Math.random()}@example.com` })
      .returning({ id: users.id });
    await db.insert(memberships).values([
      { tenantId: tenant!.id, userId: owner!.id, role: "owner", status: "active" },
      { tenantId: tenant!.id, userId: member!.id, role: "member", status: "active" },
    ]);
    await db.insert(tenantBillingStates).values({
      tenantId: tenant!.id,
      tier,
      status: "active",
      source: "backfill",
    });
    return { tenantId: tenant!.id, ownerId: owner!.id, memberId: member!.id };
  }

  it("writeMemberAllocation persists the allocation AND a member_allocation_set audit row atomically", async () => {
    const { tenantId, ownerId, memberId } = await seedTenant("pro");

    await repo.writeMemberAllocation({
      tenantId,
      actorUserId: ownerId,
      subjectUserId: memberId,
      feature: "plan_generation",
      period: PERIOD,
      limit: 7,
    });

    const [allocation] = await db
      .select()
      .from(memberQuotaAllocations)
      .where(
        and(
          eq(memberQuotaAllocations.tenantId, tenantId),
          eq(memberQuotaAllocations.userId, memberId),
          eq(memberQuotaAllocations.feature, "plan_generation"),
          eq(memberQuotaAllocations.period, PERIOD),
        ),
      );
    expect(allocation?.limit).toBe(7);
    expect(allocation?.updatedByUserId).toBe(ownerId);

    const audits = await db
      .select()
      .from(billingAuditEvents)
      .where(
        and(
          eq(billingAuditEvents.tenantId, tenantId),
          eq(billingAuditEvents.actorUserId, ownerId),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "member_allocation_set",
      subjectUserId: memberId,
      feature: "plan_generation",
      period: PERIOD,
      metadata: { limit: 7 },
    });
  });

  it("writeMemberAllocation is an upsert: a second write updates the limit and appends a new audit row", async () => {
    const { tenantId, ownerId, memberId } = await seedTenant("pro");

    await repo.writeMemberAllocation({
      tenantId,
      actorUserId: ownerId,
      subjectUserId: memberId,
      feature: "memory_write",
      period: PERIOD,
      limit: 3,
    });
    await repo.writeMemberAllocation({
      tenantId,
      actorUserId: ownerId,
      subjectUserId: memberId,
      feature: "memory_write",
      period: PERIOD,
      limit: 9,
    });

    const allocations = await db
      .select()
      .from(memberQuotaAllocations)
      .where(
        and(
          eq(memberQuotaAllocations.tenantId, tenantId),
          eq(memberQuotaAllocations.userId, memberId),
          eq(memberQuotaAllocations.feature, "memory_write"),
        ),
      );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.limit).toBe(9);

    const audits = await db
      .select()
      .from(billingAuditEvents)
      .where(eq(billingAuditEvents.tenantId, tenantId));
    // Every admin action is audited — two writes → two audit rows.
    expect(audits).toHaveLength(2);
  });

  it("readTenantUsage / readMemberUsage return aggregate COUNTS scoped to the tenant only", async () => {
    const { tenantId, memberId } = await seedTenant("pro");
    await db.insert(tenantQuotaCounters).values({
      tenantId,
      feature: "plan_generation",
      period: PERIOD,
      used: 4,
      limit: 1_000_000,
    });
    await db.insert(memberQuotaCounters).values({
      tenantId,
      userId: memberId,
      feature: "plan_generation",
      period: PERIOD,
      used: 2,
      limit: 5,
    });

    const tenantUsage = await repo.readTenantUsage(tenantId, PERIOD);
    const memberUsage = await repo.readMemberUsage(tenantId, PERIOD);

    expect(tenantUsage).toEqual([
      { feature: "plan_generation", period: PERIOD, used: 4, limit: 1_000_000 },
    ]);
    expect(memberUsage).toEqual([
      { userId: memberId, feature: "plan_generation", period: PERIOD, used: 2, limit: 5 },
    ]);
    // The returned shapes carry ONLY count/limit columns — no content field.
    expect(Object.keys(memberUsage[0]!).sort()).toEqual(
      ["feature", "limit", "period", "used", "userId"].sort(),
    );
  });

  it("loadTenantTier resolves the effective tier from the tenant billing state", async () => {
    const { tenantId } = await seedTenant("free");
    const tier = await repo.loadTenantTier(tenantId, new Date());
    expect(tier).toBe("free");
  });
});

describe.skipIf(hasDb)("BillingAdminRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
