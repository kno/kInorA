import { eq, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { tenantBillingStates } from "../schema.js";
import type { SponsorSeatStore } from "../../billing/seat-sync.js";

/**
 * Drizzle adapter for the seat-sync `SponsorSeatStore` port (16c-v3-b2b-seat-
 * billing, Slice C; design Q3). Lives under `db/` because `.dependency-
 * cruiser.cjs` forbids importing drizzle/pg outside the infra layer — the pure
 * `SeatSyncService` in `billing/` depends only on the port.
 *
 * `withSponsorLock` mirrors the tier-override advisory-lock pattern
 * (`db/repositories/tier-override-admin.ts`): a transaction-scoped
 * `pg_advisory_xact_lock(hashtext(tenantId))` serializes concurrent seat syncs
 * for the SAME sponsor so they can never settle Stripe on a stale quantity. The
 * lock is held for the whole callback — INCLUDING the outbound Stripe call the
 * callback makes — which is the deliberate serialization point (design Q3). The
 * lock auto-releases on commit/rollback.
 */
export class SeatSyncStore implements SponsorSeatStore {
  constructor(private readonly db: Database) {}

  async withSponsorLock<T>(
    tenantId: string,
    work: (sponsor: { stripeSubscriptionId: string | null }) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      // Serializes concurrent seat syncs for this sponsor. `hashtext` collapses
      // the uuid to a single bigint lock key; the lock is transaction-scoped
      // and released automatically on commit/rollback.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`);

      const [row] = await tx
        .select({ stripeSubscriptionId: tenantBillingStates.stripeSubscriptionId })
        .from(tenantBillingStates)
        .where(eq(tenantBillingStates.tenantId, tenantId));

      return work({ stripeSubscriptionId: row?.stripeSubscriptionId ?? null });
    });
  }

  /**
   * Sponsors whose desired Stripe quantity (`max(1, active-assignment count)`)
   * differs from the last-known persisted `seat_count` (the webhook-echoed
   * Stripe actual). Only tenants that ARE seat customers are considered: they
   * must hold a `stripe_subscription_id` AND have at least one
   * `trainer_client_assignments` row (the inner join). The `GREATEST(1, ...)`
   * mirrors the outbound zero-seat floor so a `count = 0 / seat_count = 1`
   * sponsor is correctly treated as converged, not drifted. `IS DISTINCT FROM`
   * also flags a never-synced `seat_count IS NULL` sponsor.
   */
  async findSponsorsWithSeatDrift(): Promise<string[]> {
    const result = await this.db.execute<{ tenant_id: string }>(sql`
      SELECT tbs.tenant_id AS tenant_id
      FROM tenant_billing_states tbs
      JOIN (
        SELECT tenant_id, count(*) FILTER (WHERE status = 'active') AS active_count
        FROM trainer_client_assignments
        GROUP BY tenant_id
      ) a ON a.tenant_id = tbs.tenant_id
      WHERE tbs.stripe_subscription_id IS NOT NULL
        AND GREATEST(1, a.active_count) IS DISTINCT FROM tbs.seat_count
    `);
    return result.rows.map((r) => r.tenant_id);
  }
}
