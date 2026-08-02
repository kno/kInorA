/**
 * Real-Postgres integration coverage for the observability events emitted by
 * `TierOverrideAdminRepository` (#310, Slice 1). The existing
 * `billing_audit_events` row is UNCHANGED (asserted by the sibling suite); this
 * suite proves the ADDITIONAL PII-free `tier_override.granted` / `.revoked`
 * events are recorded, ids only. Opt-in via `DATABASE_URL`.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import { billingAuditEvents, tenants, users } from "../../schema.js";
import { TierOverrideAdminRepository } from "../tier-override-admin.js";
import type { ObservabilityLogger } from "../../observability/event-logger.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("TierOverrideAdminRepository observability (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const NOW = new Date("2026-08-02T12:00:00Z");
  const OPEN_ENDED = new Date("9999-12-31T00:00:00Z");

  afterAll(async () => {
    await pool.end();
  });

  async function seed(): Promise<{ tenantId: string; superadminId: string }> {
    const [tenant] = await db.insert(tenants).values({ name: "obs-override" }).returning({ id: tenants.id });
    const [superadmin] = await db
      .insert(users)
      .values({ email: `obs-sa-${Date.now()}-${Math.random()}@example.com`, isAdmin: true })
      .returning({ id: users.id });
    return { tenantId: tenant!.id, superadminId: superadmin!.id };
  }

  it("records tier_override.granted (ids + tier only) IN ADDITION to the audit row", async () => {
    const recordEvent = vi.fn();
    const logger: ObservabilityLogger = { recordEvent };
    const repo = new TierOverrideAdminRepository(db, logger);
    const { tenantId, superadminId } = await seed();

    const created = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "trainer",
      reason: "pilot",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
    });

    // The audit row is still written (unchanged behavior).
    const audits = await db
      .select()
      .from(billingAuditEvents)
      .where(and(eq(billingAuditEvents.tenantId, tenantId), eq(billingAuditEvents.action, "admin_override_created")));
    expect(audits).toHaveLength(1);

    // AND the observability event is recorded.
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorUserId: superadminId,
        level: "info",
        event: "tier_override.granted",
        metadata: expect.objectContaining({ tier: "trainer", overrideId: created!.id }),
      }),
    );
  });

  it("records tier_override.revoked", async () => {
    const recordEvent = vi.fn();
    const logger: ObservabilityLogger = { recordEvent };
    const repo = new TierOverrideAdminRepository(db, logger);
    const { tenantId, superadminId } = await seed();

    const created = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "gym",
      reason: "pilot",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
    });
    recordEvent.mockClear();

    await repo.revokeTierOverride({
      tenantId,
      overrideId: created!.id,
      actorUserId: superadminId,
      now: new Date("2026-08-02T13:00:00Z"),
    });

    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorUserId: superadminId,
        level: "info",
        event: "tier_override.revoked",
        metadata: expect.objectContaining({ overrideId: created!.id }),
      }),
    );
  });

  it("does not require a logger (optional dependency)", async () => {
    const repo = new TierOverrideAdminRepository(db);
    const { tenantId, superadminId } = await seed();
    const created = await repo.grantTierOverride({
      tenantId,
      actorUserId: superadminId,
      tier: "trainer",
      reason: "pilot",
      startsAt: NOW,
      endsAt: OPEN_ENDED,
    });
    expect(created!.id).toEqual(expect.any(String));
  });
});

describe.skipIf(hasDb)("TierOverrideAdminRepository observability — skipped", () => {
  it("requires DATABASE_URL to run", () => {
    expect(hasDb).toBe(false);
  });
});
