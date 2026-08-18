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
import {
  billingAuditEvents,
  memberQuotaAllocations,
  memberships,
  tenantBillingOverrides,
  tenants,
  users,
} from "../../schema.js";
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

  it("serializes two concurrent grants for the same tenant: exactly one succeeds, exactly one active override row exists", async () => {
    const { tenantId, superadminId } = await seedTenantAndSuperadmin();

    const grantInput = {
      tenantId,
      actorUserId: superadminId,
      reason: "concurrent grant race",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
    };

    const [first, second] = await Promise.all([
      repo.grantTierOverride({ ...grantInput, tier: "trainer" }),
      repo.grantTierOverride({ ...grantInput, tier: "gym" }),
    ]);

    const results = [first, second];
    const succeeded = results.filter((r) => r !== null);
    const conflicted = results.filter((r) => r === null);

    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(1);

    const activeRows = await db
      .select({ id: tenantBillingOverrides.id })
      .from(tenantBillingOverrides)
      .where(and(eq(tenantBillingOverrides.tenantId, tenantId), eq(tenantBillingOverrides.endsAt, OPEN_ENDED)));

    expect(activeRows).toHaveLength(1);
  });

  it("grant → revoke → grant again for the same tenant: the second grant succeeds and the revoked row persists (#314)", async () => {
    const { tenantId, superadminId } = await seedTenantAndSuperadmin();

    const first = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "trainer",
      reason: "first grant",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
    });

    const revokeTime = new Date("2026-08-02T13:00:00Z");
    await repo.revokeTierOverride({
      tenantId,
      overrideId: first.id,
      actorUserId: superadminId,
      now: revokeTime,
    });

    // Second grant starts strictly AFTER the revoke instant, so the adapter's
    // transactional active-window re-check sees no overlap and inserts.
    const secondStartsAt = new Date(revokeTime.getTime() + 60_000);
    const second = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "gym",
      reason: "second grant",
      startsAt: secondStartsAt,
      endsAt: OPEN_ENDED,
    });

    // The second grant succeeded and is the active override now.
    expect(second).not.toBeNull();
    expect(second.id).not.toBe(first.id);
    const active = await repo.loadActiveOverride(tenantId, new Date(secondStartsAt.getTime() + 1000));
    expect(active?.id).toBe(second.id);

    // The revoked row PERSISTS with ends_at in the past (never deleted).
    const allRows = await db
      .select({ id: tenantBillingOverrides.id, endsAt: tenantBillingOverrides.endsAt })
      .from(tenantBillingOverrides)
      .where(eq(tenantBillingOverrides.tenantId, tenantId));
    expect(allRows).toHaveLength(2);
    const revokedRow = allRows.find((r) => r.id === first.id);
    expect(revokedRow?.endsAt.getTime()).toBe(revokeTime.getTime());

    // Two creations + one expiry recorded.
    const createdAudits = await db
      .select()
      .from(billingAuditEvents)
      .where(
        and(
          eq(billingAuditEvents.tenantId, tenantId),
          eq(billingAuditEvents.action, "admin_override_created"),
        ),
      );
    expect(createdAudits).toHaveLength(2);
    const expiredAudits = await db
      .select()
      .from(billingAuditEvents)
      .where(
        and(
          eq(billingAuditEvents.tenantId, tenantId),
          eq(billingAuditEvents.action, "admin_override_expired"),
        ),
      );
    expect(expiredAudits).toHaveLength(1);
  });

  it("serializes two concurrent revokes of the same override: exactly ONE admin_override_expired audit row (#315)", async () => {
    const { tenantId, superadminId } = await seedTenantAndSuperadmin();
    const created = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "trainer",
      reason: "concurrent revoke race",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
    });

    // Same `now` for both so the second revoke's `ends_at > now` guard matches
    // zero rows once the first has set ends_at = now.
    const revokeTime = new Date("2026-08-02T13:00:00Z");
    const revokeInput = {
      tenantId,
      overrideId: created.id,
      actorUserId: superadminId,
      now: revokeTime,
    };

    const [a, b] = await Promise.all([
      repo.revokeTierOverride(revokeInput),
      repo.revokeTierOverride(revokeInput),
    ]);

    // Both resolve to the same already-revoked endsAt (idempotent success).
    expect(a.endsAt.getTime()).toBe(revokeTime.getTime());
    expect(b.endsAt.getTime()).toBe(revokeTime.getTime());

    const expiredAudits = await db
      .select()
      .from(billingAuditEvents)
      .where(
        and(
          eq(billingAuditEvents.tenantId, tenantId),
          eq(billingAuditEvents.action, "admin_override_expired"),
        ),
      );
    expect(expiredAudits).toHaveLength(1);
  });

  it("replays the original override for a repeated operationKey without a duplicate row or audit (#313)", async () => {
    const { tenantId, superadminId } = await seedTenantAndSuperadmin();
    const operationKey = `op-${Date.now()}-${Math.random()}`;

    const first = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "trainer",
      reason: "idempotent grant",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
      operationKey,
    });

    // Same key, even with different tier/reason — the replay returns the
    // ORIGINAL row and writes nothing new.
    const replay = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "gym",
      reason: "retry after timeout",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
      operationKey,
    });

    expect(replay).not.toBeNull();
    expect(replay.id).toBe(first.id);

    const rows = await db
      .select({ id: tenantBillingOverrides.id })
      .from(tenantBillingOverrides)
      .where(eq(tenantBillingOverrides.tenantId, tenantId));
    expect(rows).toHaveLength(1);

    const createdAudits = await db
      .select()
      .from(billingAuditEvents)
      .where(
        and(
          eq(billingAuditEvents.tenantId, tenantId),
          eq(billingAuditEvents.action, "admin_override_created"),
        ),
      );
    expect(createdAudits).toHaveLength(1);
  });

  it("returns null (409) for a genuine DIFFERENT operationKey while an override is active (#313)", async () => {
    const { tenantId, superadminId } = await seedTenantAndSuperadmin();

    await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "trainer",
      reason: "active grant",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
      operationKey: `op-first-${Date.now()}`,
    });

    const conflict = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "gym",
      reason: "different key while active",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
      operationKey: `op-second-${Date.now()}`,
    });

    expect(conflict).toBeNull();

    const rows = await db
      .select({ id: tenantBillingOverrides.id })
      .from(tenantBillingOverrides)
      .where(eq(tenantBillingOverrides.tenantId, tenantId));
    expect(rows).toHaveLength(1);
  });

  it("setTenantOwnerRole promotes the owner membership and is idempotent when replayed (#449)", async () => {
    const [tenant] = await db.insert(tenants).values({ name: "role-transition-tenant" }).returning({ id: tenants.id });
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

    const promoted = await repo.setTenantOwnerRole(tenant!.id, "owner", "trainer");
    expect(promoted).toBe(1);

    const rows = await db
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.tenantId, tenant!.id));
    const ownerRow = rows.find((r) => r.userId === owner!.id);
    const memberRow = rows.find((r) => r.userId === member!.id);
    expect(ownerRow?.role).toBe("trainer");
    // The `member` row must NEVER be touched by the role transition.
    expect(memberRow?.role).toBe("member");

    // Replaying the same transition matches zero rows (already `trainer`) —
    // idempotent, not an error.
    const replayed = await repo.setTenantOwnerRole(tenant!.id, "owner", "trainer");
    expect(replayed).toBe(0);

    // Demote back to owner.
    const demoted = await repo.setTenantOwnerRole(tenant!.id, "trainer", "owner");
    expect(demoted).toBe(1);
    const afterDemote = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenant!.id), eq(memberships.userId, owner!.id)));
    expect(afterDemote[0]?.role).toBe("owner");
  });

  it("grants a trainer override then revokes it: the owner membership round-trips owner -> trainer -> owner (#449)", async () => {
    const { tenantId, superadminId } = await seedTenantAndSuperadmin();
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-${Date.now()}-${Math.random()}@example.com` })
      .returning({ id: users.id });
    await db.insert(memberships).values({ tenantId, userId: owner!.id, role: "owner", status: "active" });

    const created = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "trainer",
      reason: "role round-trip",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
    });
    expect(created).not.toBeNull();

    // Mirrors the use-case orchestration: the port's grant write succeeds,
    // THEN the role transition runs as its own statement.
    const promoted = await repo.setTenantOwnerRole(tenantId, "owner", "trainer");
    expect(promoted).toBe(1);

    const afterGrant = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, owner!.id)));
    expect(afterGrant[0]?.role).toBe("trainer");

    const revokeTime = new Date("2026-08-02T13:00:00Z");
    await repo.revokeTierOverride({
      tenantId,
      overrideId: created.id,
      actorUserId: superadminId,
      now: revokeTime,
    });
    const demoted = await repo.setTenantOwnerRole(tenantId, "trainer", "owner");
    expect(demoted).toBe(1);

    const afterRevoke = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, owner!.id)));
    expect(afterRevoke[0]?.role).toBe("owner");
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
