import { and, eq, gt, lte } from "drizzle-orm";
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

  async grantTierOverride(input: GrantTierOverrideInput): Promise<TenantBillingOverrideRow> {
    return this.db.transaction(async (tx) => {
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
