import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { MembershipRole } from "@kinora/contracts";
import type { Database } from "../client.js";
import { billingAuditEvents, memberships, tenantBillingOverrides, tenants } from "../schema.js";
import type {
  ActiveTierOverrideRow,
  GrantTierOverrideInput,
  RevokeTierOverrideInput,
  TenantBillingOverrideRow,
  TierOverrideAdminPort,
} from "../../billing/tier-override-admin.js";
import type { ObservabilityLogger } from "../../observability/event-logger.js";

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
  constructor(
    private readonly db: Database,
    /**
     * Optional observability seam (#310). Emits a PII-free
     * `tier_override.granted` / `.revoked` event (ids + tier ONLY) AFTER the
     * grant/revoke transaction commits — IN ADDITION to (never replacing) the
     * existing `billing_audit_events` row written inside the transaction.
     * Fire-and-forget; recorded post-commit so it is never coupled to the
     * domain transaction.
     */
    private readonly observability?: ObservabilityLogger,
  ) {}

  async loadTenant(tenantId: string): Promise<{ id: string } | null> {
    const [row] = await this.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    return row ?? null;
  }

  async loadActiveOverride(tenantId: string, now: Date): Promise<ActiveTierOverrideRow | null> {
    const [row] = await this.db
      .select({ id: tenantBillingOverrides.id, tier: tenantBillingOverrides.tier })
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
   * Transitions the tenant OWNER membership's role (#449). Scoped
   * `WHERE tenant_id = $1 AND role = $2` so it can only ever move the ONE
   * `from`-role membership row for this tenant — it never matches `member`
   * rows (invited clients live in the same tenant). Returns the affected row
   * count; `0` is a normal idempotent outcome, not an error.
   *
   * Placement (design decision, #449): `GrantTenantTierOverride` /
   * `RevokeTenantTierOverride` call this as a SEPARATE port round-trip AFTER
   * `grantTierOverride`/`revokeTierOverride` resolves successfully — it is
   * NOT nested inside those methods' `db.transaction(...)` blocks. This
   * mirrors the existing use-case shape, where `loadTenant`,
   * `loadActiveOverride`, and `grantTierOverride` are already three separate
   * round trips orchestrated by the pure (db-free) use case rather than one
   * combined adapter call. A crash between the override write and this call
   * leaves the tenant granted-but-not-yet-promoted; that state self-heals on
   * the next replay of the SAME grant (operationKey) or on any admin
   * re-grant, since this update is idempotent (0 rows when already at `to`).
   */
  async setTenantOwnerRole(tenantId: string, from: MembershipRole, to: MembershipRole): Promise<number> {
    const updated = await this.db
      .update(memberships)
      .set({ role: to })
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, from)))
      .returning({ id: memberships.id });
    return updated.length;
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
    const result = await this.db.transaction(async (tx) => {
      // Serializes concurrent grants for this tenant. `hashtext` collapses
      // the uuid to a single bigint lock key; the lock is transaction-scoped
      // and released automatically on commit/rollback.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.tenantId}))`);

      // Idempotency replay (#313): under the lock, an override already
      // carrying this operation key is the committed result of a prior
      // (possibly timed-out) attempt — return it verbatim. No new row, no
      // audit row, no observability event.
      if (input.operationKey) {
        const [existingByKey] = await tx
          .select({
            id: tenantBillingOverrides.id,
            startsAt: tenantBillingOverrides.startsAt,
            endsAt: tenantBillingOverrides.endsAt,
          })
          .from(tenantBillingOverrides)
          .where(
            and(
              eq(tenantBillingOverrides.tenantId, input.tenantId),
              eq(tenantBillingOverrides.operationKey, input.operationKey),
            ),
          );
        if (existingByKey) {
          return { row: existingByKey, replayed: true };
        }
      }

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
          operationKey: input.operationKey ?? null,
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

      return { row: created!, replayed: false };
    });

    // Post-commit observability only for a freshly-inserted grant. A null
    // result = lost the advisory-lock race (no override written); a replayed
    // result already emitted its event on the original attempt. Ids + tier
    // only — never `reason`.
    if (result && !result.replayed) {
      this.observability?.recordEvent({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        level: "info",
        event: "tier_override.granted",
        metadata: { tier: input.tier, overrideId: result.row.id },
      });
    }

    return result?.row ?? null;
  }

  async revokeTierOverride(input: RevokeTierOverrideInput): Promise<{ id: string; endsAt: Date }> {
    const result = await this.db.transaction(async (tx) => {
      // Mirror the grant fix (#315): serialize concurrent revokes for this
      // tenant with a per-tenant advisory lock, then guard the UPDATE with
      // `ends_at > now` so a SECOND concurrent revoke of the same override
      // matches zero rows.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.tenantId}))`);

      const [updated] = await tx
        .update(tenantBillingOverrides)
        .set({ endsAt: input.now })
        .where(
          and(
            eq(tenantBillingOverrides.id, input.overrideId),
            gt(tenantBillingOverrides.endsAt, input.now),
          ),
        )
        .returning({ id: tenantBillingOverrides.id, endsAt: tenantBillingOverrides.endsAt });

      if (updated) {
        // Only the revoke that actually flipped the row writes the audit event.
        await tx.insert(billingAuditEvents).values({
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          action: "admin_override_expired",
          metadata: { overrideId: updated.id },
        });
        return { row: updated, revoked: true };
      }

      // Zero rows updated: a concurrent revoke already expired this override.
      // Return its current (already-past) endsAt as an idempotent success —
      // no duplicate audit row, no duplicate observability event.
      const [existing] = await tx
        .select({ id: tenantBillingOverrides.id, endsAt: tenantBillingOverrides.endsAt })
        .from(tenantBillingOverrides)
        .where(eq(tenantBillingOverrides.id, input.overrideId));
      return { row: existing!, revoked: false };
    });

    if (result.revoked) {
      this.observability?.recordEvent({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        level: "info",
        event: "tier_override.revoked",
        metadata: { overrideId: result.row.id },
      });
    }

    return result.row;
  }
}
