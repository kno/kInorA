/**
 * #354 — real-Postgres proof that a user account can be deleted in ONE statement
 * while every attribution record survives with its configuration intact.
 *
 * Before this change four FKs into `users` were `ON DELETE NO ACTION`, so
 * `DELETE FROM users WHERE id = $1` failed on a constraint violation and GDPR
 * erasure required an operator running staged SQL against four tables in the
 * right order — getting the order wrong left the database half-purged.
 *
 * `SET NULL` is the point: the audit event still says what happened and to which
 * tenant, and the tenant keeps its configured limits and tier override. Only the
 * "who did it" reference is dropped. `CASCADE` would have deleted the billing
 * trail exactly when it is needed (chargeback, "why was I charged").
 *
 * Opt-in via `DATABASE_URL` (same podman pgvector:pg17 harness as
 * `billing-admin.integration.test.ts`) — skipped when no real Postgres is wired
 * so the default `vitest run` stays hermetic. The declared schema is pinned
 * hermetically by `db/__tests__/schema-user-attribution-fk.test.ts`.
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

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("user account deletion (real Postgres, #354)", () => {
  const { db, pool } = createDbClient();
  const PERIOD = "2026-08";

  afterAll(async () => {
    await pool.end();
  });

  function uniqueEmail(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random()}@example.com`;
  }

  /**
   * The admin is the account under deletion; the member is the *subject* whose
   * configuration must survive. Keeping them distinct matters: the member's
   * allocation is reached from `users` only through `updated_by_user_id`, so a
   * `CASCADE` regression would delete it while a `SET NULL` keeps it. The
   * admin's own allocation would legitimately disappear via the
   * `(tenant_id, user_id) -> memberships` cascade and proves nothing.
   */
  async function seed(): Promise<{ tenantId: string; adminId: string; memberId: string }> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "account-deletion-tenant" })
      .returning({ id: tenants.id });
    const [admin] = await db
      .insert(users)
      .values({ email: uniqueEmail("deletion-admin") })
      .returning({ id: users.id });
    const [member] = await db
      .insert(users)
      .values({ email: uniqueEmail("deletion-member") })
      .returning({ id: users.id });

    await db.insert(memberships).values([
      { tenantId: tenant!.id, userId: admin!.id, role: "owner", status: "active" },
      { tenantId: tenant!.id, userId: member!.id, role: "member", status: "active" },
    ]);

    return { tenantId: tenant!.id, adminId: admin!.id, memberId: member!.id };
  }

  it("deletes a user with audit events, an allocation and a tier override in one statement", async () => {
    const { tenantId, adminId, memberId } = await seed();
    const now = new Date();

    await db.insert(memberQuotaAllocations).values({
      tenantId,
      userId: memberId,
      feature: "plan_generation",
      period: PERIOD,
      limit: 7,
      updatedByUserId: adminId,
    });
    await db.insert(tenantBillingOverrides).values({
      tenantId,
      tier: "pro",
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 3_600_000),
      createdByUserId: adminId,
      reason: "account-deletion integration override",
    });
    await db.insert(billingAuditEvents).values([
      // The deleted user as actor…
      {
        tenantId,
        actorUserId: adminId,
        subjectUserId: memberId,
        action: "member_allocation_set",
        feature: "plan_generation",
        period: PERIOD,
      },
      // …and as subject, so both FKs are exercised in the same delete.
      {
        tenantId,
        actorUserId: memberId,
        subjectUserId: adminId,
        action: "admin_override_created",
      },
    ]);

    // The whole point of the issue: one statement, no manual pre-cleanup.
    await db.delete(users).where(eq(users.id, adminId));

    expect(await db.select().from(users).where(eq(users.id, adminId))).toHaveLength(0);

    const allocations = await db
      .select()
      .from(memberQuotaAllocations)
      .where(
        and(
          eq(memberQuotaAllocations.tenantId, tenantId),
          eq(memberQuotaAllocations.userId, memberId),
        ),
      );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      feature: "plan_generation",
      period: PERIOD,
      limit: 7,
      updatedByUserId: null,
    });

    const overrides = await db
      .select()
      .from(tenantBillingOverrides)
      .where(eq(tenantBillingOverrides.tenantId, tenantId));
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      tier: "pro",
      reason: "account-deletion integration override",
      createdByUserId: null,
    });

    const audits = await db
      .select()
      .from(billingAuditEvents)
      .where(eq(billingAuditEvents.tenantId, tenantId));
    expect(audits).toHaveLength(2);

    const allocationSet = audits.find((row) => row.action === "member_allocation_set");
    expect(allocationSet).toMatchObject({
      tenantId,
      actorUserId: null,
      subjectUserId: memberId,
      feature: "plan_generation",
      period: PERIOD,
    });

    const overrideCreated = audits.find((row) => row.action === "admin_override_created");
    expect(overrideCreated).toMatchObject({
      tenantId,
      actorUserId: memberId,
      subjectUserId: null,
    });
  });

  it("leaves no FK into users or tenants at NO ACTION, so nothing else blocks deletion", async () => {
    // Re-runs the query that found the four columns in the first place, against
    // the migrated database rather than a truncated hand-inspected list (#354).
    // `SET NULL` and `CASCADE` are both acceptable intents; `NO ACTION` /
    // `RESTRICT` is what makes an account undeletable.
    const { rows } = await pool.query<{
      table_name: string;
      constraint_name: string;
      delete_rule: string;
    }>(
      `SELECT tc.table_name, tc.constraint_name, rc.delete_rule
         FROM information_schema.referential_constraints rc
         JOIN information_schema.table_constraints tc
           ON tc.constraint_name = rc.constraint_name
          AND tc.constraint_schema = rc.constraint_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = rc.unique_constraint_name
          AND ccu.constraint_schema = rc.unique_constraint_schema
        WHERE tc.constraint_schema = 'public'
          AND ccu.table_name IN ('users', 'tenants')
          AND rc.delete_rule NOT IN ('CASCADE', 'SET NULL')`,
    );

    expect(rows).toEqual([]);
  });
});

describe.skipIf(hasDb)("user account deletion (real Postgres, #354) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
