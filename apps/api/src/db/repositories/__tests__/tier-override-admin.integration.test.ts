/**
 * Real-Postgres integration coverage for `TierOverrideAdminRepository`
 * (16d-admin-tier-provisioning, Phase 3).
 *
 * Proves the whole point of the Phase 1 audit-FK relaxation (Approach B):
 * a global superadmin who holds ZERO `memberships` rows for the target
 * tenant can still grant/revoke a tier override AND be recorded as the
 * `billing_audit_events.actor_user_id` — the composite tenant-membership FK
 * would have rejected this insert.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * `billing-admin.integration.test.ts`) — skipped when no real Postgres is
 * wired so the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import { billingAuditEvents, memberQuotaAllocations, memberships, tenants, users } from "../../schema.js";
import { BillingAdminRepository } from "../billing-admin.js";
import { TierOverrideAdminRepository } from "../tier-override-admin.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("TierOverrideAdminRepository (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const repo = new TierOverrideAdminRepository(db);
  const NOW = new Date("2026-08-02T12:00:00Z");
  const OPEN_ENDED = new Date("9999-12-31T00:00:00Z");

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenantAndSuperadmin(): Promise<{ tenantId: string; superadminId: string }> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "tier-override-tenant" })
      .returning({ id: tenants.id });
    // The superadmin has ZERO membership rows for this tenant — that is the
    // whole point of this suite.
    const [superadmin] = await db
      .insert(users)
      .values({
        email: `superadmin-${Date.now()}-${Math.random()}@example.com`,
        isAdmin: true,
      })
      .returning({ id: users.id });
    return { tenantId: tenant!.id, superadminId: superadmin!.id };
  }

  it("grants an override AND writes an admin_override_created audit row for a non-member superadmin", async () => {
    const { tenantId, superadminId } = await seedTenantAndSuperadmin();

    const membershipRows = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, superadminId)));
    expect(membershipRows).toHaveLength(0);

    const created = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "trainer",
      reason: "pilot program",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
    });

    expect(created.startsAt.getTime()).toBe(NOW.getTime());
    expect(created.endsAt.getTime()).toBe(OPEN_ENDED.getTime());

    const audits = await db
      .select()
      .from(billingAuditEvents)
      .where(
        and(eq(billingAuditEvents.tenantId, tenantId), eq(billingAuditEvents.actorUserId, superadminId)),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "admin_override_created",
      metadata: { tier: "trainer", reason: "pilot program", overrideId: created.id },
    });

    const active = await repo.loadActiveOverride(tenantId, NOW);
    expect(active?.id).toBe(created.id);
  });

  it("revoke updates endsAt=now and writes an admin_override_expired audit row, without deleting the row", async () => {
    const { tenantId, superadminId } = await seedTenantAndSuperadmin();
    const created = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "gym",
      reason: "gym pilot",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
    });

    const revokeTime = new Date("2026-08-02T13:00:00Z");
    const revoked = await repo.revokeTierOverride({
      tenantId,
      overrideId: created.id,
      actorUserId: superadminId,
      now: revokeTime,
    });

    expect(revoked.endsAt.getTime()).toBe(revokeTime.getTime());

    const rows = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    expect(rows).toHaveLength(1);

    // No longer active as of a time strictly after the revoke instant.
    const activeAfterRevoke = await repo.loadActiveOverride(
      tenantId,
      new Date(revokeTime.getTime() + 1000),
    );
    expect(activeAfterRevoke).toBeNull();

    const audits = await db
      .select()
      .from(billingAuditEvents)
      .where(
        and(eq(billingAuditEvents.tenantId, tenantId), eq(billingAuditEvents.action, "admin_override_expired")),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: superadminId,
      metadata: { overrideId: created.id },
    });
  });

  it("regression: writeMemberAllocation audit insert is unaffected by the relaxed FK (actor IS a tenant member)", async () => {
    const [tenant] = await db.insert(tenants).values({ name: "regression-tenant" }).returning({ id: tenants.id });
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

    const billingAdminRepo = new BillingAdminRepository(db);
    await billingAdminRepo.writeMemberAllocation({
      tenantId: tenant!.id,
      actorUserId: owner!.id,
      subjectUserId: member!.id,
      feature: "plan_generation",
      period: "2026-08",
      limit: 5,
    });

    const allocation = await db
      .select()
      .from(memberQuotaAllocations)
      .where(eq(memberQuotaAllocations.tenantId, tenant!.id));
    expect(allocation).toHaveLength(1);

    const audits = await db
      .select()
      .from(billingAuditEvents)
      .where(eq(billingAuditEvents.tenantId, tenant!.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "member_allocation_set", actorUserId: owner!.id });
  });
});

describe.skipIf(hasDb)("TierOverrideAdminRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
