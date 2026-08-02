import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { billingAuditEvents, tenantBillingOverrides, tenants } from "../schema.js";
import type {
  GrantTierOverrideInput,
  RevokeTierOverrideInput,
  TenantBillingOverrideRow,
  TierOverrideAdminPort,
} from "../../billing/tier-override-admin.js";

/**
 * Drizzle adapter for the tier-override-admin port. Lives under `db/` because
 * `.dependency-cruiser.cjs` forbids importing drizzle/pg outside the infra
 * layer; the pure `GrantTenantTierOverride` / `RevokeTenantTierOverride` use
 * cases in `billing/` depend only on the port interface.
 *
 * `grantTierOverride` / `revokeTierOverride` each run ONE transaction pairing
 * the `tenant_billing_overrides` write with its `billing_audit_events` row —
 * mirrors `BillingAdminRepository.writeMemberAllocation`. The audit actor FK
 * (`billing_audit_events.actor_user_id -> users.id`, relaxed in migration
 * 0020) is a plain `users.id` reference, so a global superadmin acting on a
 * tenant they hold zero `memberships` rows for is a valid audit actor.
 */
export class TierOverrideAdminRepository implements TierOverrideAdminPort {
  constructor(private readonly db: Database) {}

  async loadTenant(tenantId: string): Promise<{ id: string } | null> {
    const [row] = await this.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    return row ?? null;
  }

  async loadActiveOverride(tenantId: string, now: Date): Promise<{ id: string } | null> {
    const [row] = await this.db
      .select({ id: tenantBillingOverrides.id })
      .from(tenantBillingOverrides)
      .where(
        and(
          eq(tenantBillingOverrides.tenantId, tenantId),
          lte(tenantBillingOverrides.startsAt, now),
          gt(tenantBillingOverrides.endsAt, now),
        ),
      )
      .orderBy(tenantBillingOverrides.endsAt);
    return row ?? null;
  }

  /**
   * `loadActiveOverride` + `grantTierOverride` are called as two SEPARATE
   * round-trips by `GrantTenantTierOverride.execute` (a check-then-act
   * pattern) — that fast-path check alone cannot prevent two concurrent
   * grants for the same tenant both observing "no active override" and both
   * inserting. A DB-level partial-unique index cannot enforce this either,
   * because "active" is a time WINDOW (`startsAt<=now<endsAt`), not an
   * immutable status column.
   *
   * Instead, this method serializes concurrent grants per tenant with a
   * transaction-scoped Postgres advisory lock (`pg_advisory_xact_lock`,
   * auto-released at commit/rollback): the lock is taken FIRST, the active
   * override is RE-CHECKED under the lock, and only then is the row
   * inserted. A second concurrent caller blocks on the lock until the first
   * commits, then observes the first's committed row and backs off — it
   * resolves `null` (does not insert, does not throw) so the use case can
   * map it to the existing `active_override_exists` 409 conflict.
   */
  async grantTierOverride(input: GrantTierOverrideInput): Promise<TenantBillingOverrideRow | null> {
    return this.db.transaction(async (tx) => {
      // Serializes concurrent grants for this tenant. `hashtext` collapses
      // the uuid to a single bigint lock key; the lock is transaction-scoped
      // and released automatically on commit/rollback.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.tenantId}))`);

      const [existingActive] = await tx
        .select({ id: tenantBillingOverrides.id })
        .from(tenantBillingOverrides)
        .where(
          and(
            eq(tenantBillingOverrides.tenantId, input.tenantId),
            lte(tenantBillingOverrides.startsAt, input.startsAt),
            gt(tenantBillingOverrides.endsAt, input.startsAt),
          ),
        )
        .orderBy(tenantBillingOverrides.endsAt);

      if (existingActive) {
        return null;
      }

      const [created] = await tx
        .insert(tenantBillingOverrides)
        .values({
          tenantId: input.tenantId,
          tier: input.tier,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          createdByUserId: input.actorUserId,
          reason: input.reason,
        })
        .returning({
          id: tenantBillingOverrides.id,
          startsAt: tenantBillingOverrides.startsAt,
          endsAt: tenantBillingOverrides.endsAt,
        });

      await tx.insert(billingAuditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "admin_override_created",
        metadata: { tier: input.tier, reason: input.reason, overrideId: created!.id },
      });

      return created!;
    });
  }

  async revokeTierOverride(input: RevokeTierOverrideInput): Promise<{ id: string; endsAt: Date }> {
    return this.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(tenantBillingOverrides)
        .set({ endsAt: input.now })
        .where(eq(tenantBillingOverrides.id, input.overrideId))
        .returning({ id: tenantBillingOverrides.id, endsAt: tenantBillingOverrides.endsAt });

      await tx.insert(billingAuditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "admin_override_expired",
        metadata: { overrideId: revoked!.id },
      });

      return revoked!;
    });
  }
}
