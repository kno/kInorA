import { eq, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { stripeProcessedEvents, tenantBillingStates, tenants } from "../schema.js";
import type {
  RecordEventInput,
  RecordEventOutcome,
  StripeEventStorePort,
} from "../../billing/process-webhook.js";

/**
 * Drizzle adapter for the Stripe webhook store (11b-v1, Slice 2). Lives under
 * `db/` so the pure `process-webhook.ts` use case depends only on the
 * {@link StripeEventStorePort} interface (the dependency-cruiser forbids drizzle
 * outside the infra layer). Mirrors the 11a `billing-quota.ts` transactional
 * pattern: a single `db.transaction` enforces, in order, idempotency →
 * atomic out-of-order/tie-break-guarded upsert, so a failure rolls everything
 * back and Stripe safely retries (fail-closed).
 *
 * 4R fix (resilience + reliability): the guard used to be a separate
 * `SELECT ... FOR UPDATE` read followed by a JS decision, then a write. That
 * `FOR UPDATE` locks NOTHING when the tenant has no `tenant_billing_states` row
 * yet, so two concurrent FIRST-time deliveries for a brand-new tenant both
 * read `undefined`, both skipped the stale check, and Postgres serialized only
 * the physical row — an OLDER event committing last silently WON and regressed
 * the stored `stripe_event_ts`. The guard is now enforced ENTIRELY inside the
 * single `INSERT ... ON CONFLICT DO UPDATE ... WHERE` statement's `setWhere`,
 * which Postgres evaluates against the conflicting row's ALREADY-COMMITTED
 * values at conflict-resolution time — a second concurrent inserter blocks on
 * Postgres's own conflict-resolution lock until the first commits, then
 * re-evaluates the `WHERE` against the winner's row. Correctness is therefore
 * atomic and lock-independent of whether a row pre-existed, and the explicit
 * `SELECT ... FOR UPDATE` is no longer needed (removed — it added an extra
 * round trip while contributing no correctness the conditional upsert
 * doesn't already provide).
 *
 * The `setWhere` predicate mirrors {@link shouldAcceptStoreWrite} exactly (kept
 * in sync manually — that pure function is the unit-tested source of truth for
 * the decision semantics; the real-Postgres integration suite asserts this SQL
 * reproduces it end-to-end):
 *   - accept when the existing row's `stripe_event_ts` is NULL (no Stripe event
 *     recorded yet — including a brand-new row from THIS statement's own
 *     insert branch, which never hits the `WHERE` at all)
 *   - reject a strictly OLDER incoming event
 *   - accept a strictly NEWER incoming event
 *   - at an EQUAL timestamp (Stripe's `created` is second-granularity — two
 *     distinct events can share a second), reject ONLY a non-terminal
 *     (`active`) write over an existing terminal (`expired`) state
 *
 * #290 unknown-tenant step: BETWEEN the idempotency insert (step 1) and the
 * billing-state upsert (step 2), the transaction checks whether `write.tenantId`
 * still has a row in `tenants`. A subscription's tenant CAN be deleted after
 * checkout but before Stripe delivers the event — that upsert would otherwise
 * violate the `tenant_billing_states_tenant_id_tenants_id_fk` FK and throw,
 * propagating to a 5xx that Stripe retries FOREVER (a missing tenant is a
 * PERMANENT condition, not transient) and risking Stripe auto-disabling the
 * webhook endpoint in live mode — which would silently break Pro activation
 * for ALL customers. When the tenant is missing, the transaction returns
 * `unknown_tenant` and COMMITS with only the idempotency row (step 1) — the
 * event is recorded so Stripe stops retrying, and no billing write is
 * attempted.
 */
export class StripeEventStoreRepository implements StripeEventStorePort {
  constructor(private readonly db: Database) {}

  async recordEventAndApply(input: RecordEventInput): Promise<RecordEventOutcome> {
    const { eventId, type, eventTs, write } = input;

    return this.db.transaction(async (tx) => {
      // 1. Idempotency: insert-on-conflict-do-nothing keyed by the Stripe event
      // id (mirrors the billing_usage_ledger operation-key replay). A conflict
      // means this exact event was already processed → no-op, exactly-once.
      const inserted = await tx
        .insert(stripeProcessedEvents)
        .values({ eventId, type, stripeEventTs: eventTs })
        .onConflictDoNothing()
        .returning({ eventId: stripeProcessedEvents.eventId });
      if (inserted.length === 0) {
        return { outcome: "duplicate" };
      }

      // 1b. #290: a missing tenant is PERMANENT (deleted after checkout,
      // before Stripe delivered this event) — the upsert below would violate
      // the `tenants` FK and throw, causing a 5xx Stripe retries forever. The
      // idempotency row above already committed, so acknowledge and skip.
      const tenantExists = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, write.tenantId))
        .limit(1);
      if (tenantExists.length === 0) {
        return { outcome: "unknown_tenant" };
      }

      // 2. Atomic upsert. `resolveEffectiveTier` stays the single source of
      // truth — this only writes `status`/`tier` (+ additive Stripe metadata)
      // and NEVER touches `tenant_billing_overrides`, so an active admin
      // override still wins at read time (#172). The initial INSERT branch
      // (no conflict — first-ever row for this tenant) always applies and is
      // always returned; the `WHERE` on `DO UPDATE` only gates the conflict
      // branch, per Postgres semantics for `ON CONFLICT DO UPDATE ... WHERE
      // ... RETURNING`: when the condition is false the row is left unchanged
      // AND excluded from `RETURNING` — that is exactly how the guard-rejected
      // case is detected below (empty `returning()` result).
      const now = new Date();
      const result = await tx
        .insert(tenantBillingStates)
        .values({
          tenantId: write.tenantId,
          tier: write.tier,
          status: write.status,
          source: write.source,
          stripeCustomerId: write.stripeCustomerId,
          stripeSubscriptionId: write.stripeSubscriptionId,
          stripeSubscriptionStatus: write.stripeSubscriptionStatus,
          billingCycle: write.billingCycle,
          currentPeriodEnd: write.currentPeriodEnd,
          cancelAtPeriodEnd: write.cancelAtPeriodEnd,
          // 16c-v3-b2b-seat-billing Slice B: additive seat-count metadata,
          // written alongside the other Stripe-derived columns under the
          // same out-of-order/exactly-once guard.
          seatCount: write.seatCount,
          stripeEventTs: eventTs,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: tenantBillingStates.tenantId,
          set: {
            tier: write.tier,
            status: write.status,
            source: write.source,
            stripeCustomerId: write.stripeCustomerId,
            stripeSubscriptionId: write.stripeSubscriptionId,
            stripeSubscriptionStatus: write.stripeSubscriptionStatus,
            billingCycle: write.billingCycle,
            currentPeriodEnd: write.currentPeriodEnd,
            cancelAtPeriodEnd: write.cancelAtPeriodEnd,
            seatCount: write.seatCount,
            stripeEventTs: eventTs,
            updatedAt: now,
          },
          setWhere: sql`(
            ${tenantBillingStates.stripeEventTs} IS NULL
            OR ${tenantBillingStates.stripeEventTs} < excluded.stripe_event_ts
            OR (
              ${tenantBillingStates.stripeEventTs} = excluded.stripe_event_ts
              AND NOT (${tenantBillingStates.status} = 'expired' AND excluded.status = 'active')
            )
          )`,
        })
        .returning({ tenantId: tenantBillingStates.tenantId });

      if (result.length === 0) {
        // The guard rejected the write: either strictly stale, or a
        // same-second non-terminal write that would have regressed a stored
        // terminal state. Recorded in step 1 so a retry safely no-ops.
        return { outcome: "stale" };
      }
      return { outcome: "processed" };
    });
  }
}
