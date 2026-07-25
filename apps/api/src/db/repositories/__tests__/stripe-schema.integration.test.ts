/**
 * Real-Postgres integration coverage for the 11b Slice 1 additive Stripe
 * schema migration (`0012_stripe_billing.sql`).
 *
 * A pure schema-shape unit test (`db/__tests__/stripe-schema.test.ts`) proves
 * the Drizzle model and the migration SQL text, but only a real Postgres can
 * prove that:
 *
 *   1. The migration applies ADDITIVELY — the 11a `tenant_billing_states`
 *      columns and rows survive and the new Stripe columns land with their
 *      safe defaults (nullable / `cancel_at_period_end = false`).
 *   2. `stripe_processed_events` insert-on-conflict-do-nothing is exactly-once
 *      keyed by `event_id` (the webhook idempotency guard), and a duplicate
 *      never overwrites the first row.
 *   3. A rollback of ONLY the new objects (table + columns + `billing_cycle`
 *      enum) leaves the 11a billing schema fully intact.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as the
 * other billing integration suites) — skipped when no real Postgres is wired so
 * the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import { stripeProcessedEvents, tenantBillingStates, tenants } from "../../schema.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("stripe schema migration (real Postgres)", () => {
  const { db, pool } = createDbClient();

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `stripe-schema-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  it("applied additively: an 11a-shaped billing state row keeps its columns and gets safe Stripe defaults", async () => {
    const tenantId = await seedTenant();

    // Insert using ONLY the 11a columns — the migration's safe defaults must
    // fill the new Stripe columns without any value supplied.
    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "free",
      status: "active",
      source: "backfill",
    });

    const [row] = await db
      .select()
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, tenantId));

    // 11a columns intact.
    expect(row?.tier).toBe("free");
    expect(row?.status).toBe("active");
    expect(row?.source).toBe("backfill");
    // New additive Stripe metadata defaults.
    expect(row?.stripeCustomerId).toBeNull();
    expect(row?.stripeSubscriptionId).toBeNull();
    expect(row?.stripeSubscriptionStatus).toBeNull();
    expect(row?.currentPeriodEnd).toBeNull();
    expect(row?.billingCycle).toBeNull();
    expect(row?.cancelAtPeriodEnd).toBe(false);
  });

  it("accepts the new 'stripe' source and a billing_cycle enum value", async () => {
    const tenantId = await seedTenant();
    const periodEnd = new Date("2027-07-25T00:00:00.000Z");

    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "pro",
      status: "active",
      source: "stripe",
      stripeCustomerId: "cus_test_1",
      stripeSubscriptionId: "sub_test_1",
      stripeSubscriptionStatus: "active",
      billingCycle: "annual",
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
    });

    const [row] = await db
      .select()
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, tenantId));

    expect(row?.source).toBe("stripe");
    expect(row?.billingCycle).toBe("annual");
    expect(row?.stripeCustomerId).toBe("cus_test_1");
    expect(row?.cancelAtPeriodEnd).toBe(true);
    expect(row?.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString());
  });

  it("stripe_processed_events insert-on-conflict-do-nothing is exactly-once per event_id", async () => {
    const eventId = `evt_${Date.now()}_${Math.random()}`;

    const first = await db
      .insert(stripeProcessedEvents)
      .values({ eventId, type: "customer.subscription.updated", stripeEventTs: new Date("2026-07-25T10:00:00Z") })
      .onConflictDoNothing()
      .returning({ eventId: stripeProcessedEvents.eventId });

    // A retried delivery of the SAME event id must be a no-op, not a second row
    // and not an overwrite of the recorded type.
    const second = await db
      .insert(stripeProcessedEvents)
      .values({ eventId, type: "customer.subscription.deleted", stripeEventTs: new Date("2026-07-26T10:00:00Z") })
      .onConflictDoNothing()
      .returning({ eventId: stripeProcessedEvents.eventId });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);

    const rows = await db
      .select()
      .from(stripeProcessedEvents)
      .where(eq(stripeProcessedEvents.eventId, eventId));
    expect(rows).toHaveLength(1);
    // The winner's payload is preserved; the duplicate never overwrote it.
    expect(rows[0]?.type).toBe("customer.subscription.updated");
  });

  it("down-migration DDL drops ONLY the new objects, proven in an isolated schema (never locks the shared tenant_billing_states)", async () => {
    // Isolation rationale (4R resilience fix): the CI `billing-integration` job
    // runs all four billing integration files in ONE `vitest run` with
    // vitest's default parallel forks against a SINGLE shared Postgres. The
    // previous version of this test ran `ALTER TABLE ... DROP COLUMN` / `DROP
    // TABLE` / `DROP TYPE` directly on the SHARED `tenant_billing_states` table
    // (even inside a rolled-back transaction) — each of those statements takes
    // an ACCESS EXCLUSIVE lock on that table for the lifetime of the
    // transaction, which can conflict/deadlock with the concurrent row-level
    // DML the billing-quota/admin/visibility suites run against that same
    // table in sibling forks, causing intermittent flaky-red on the
    // payments-critical job. The pre-existing 11a suites only ever did
    // unique-tenant DML — never table DDL — so this lock behavior was newly
    // introduced by this test.
    //
    // Fix: exercise the EXACT down-migration DDL sequence (drop columns, drop
    // table, drop enum type) against a throwaway, uniquely-named schema that
    // mirrors the additive shape. This proves the down statements are valid
    // and non-destructive to pre-existing data WITHOUT ever taking a lock on
    // `public.tenant_billing_states` — so it can run concurrently with the
    // other billing integration suites with zero contention.
    const schema = `stripe_rollback_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const tenantId = "00000000-0000-4000-8000-000000000001";

    try {
      await db.execute(sql.raw(`CREATE SCHEMA "${schema}"`));
      await db.execute(sql.raw(`CREATE TYPE "${schema}"."billing_cycle" AS ENUM('monthly', 'annual')`));
      // Mirrors the additive 0012 shape: 11a columns + the 6 new Stripe columns.
      await db.execute(
        sql.raw(`
          CREATE TABLE "${schema}"."tenant_billing_states" (
            tenant_id uuid PRIMARY KEY,
            tier text NOT NULL,
            status text NOT NULL,
            source text NOT NULL,
            stripe_customer_id text,
            stripe_subscription_id text,
            stripe_subscription_status text,
            current_period_end timestamp with time zone,
            cancel_at_period_end boolean NOT NULL DEFAULT false,
            billing_cycle "${schema}"."billing_cycle"
          )
        `),
      );
      await db.execute(
        sql.raw(`
          CREATE TABLE "${schema}"."stripe_processed_events" (
            event_id text PRIMARY KEY,
            type text NOT NULL,
            stripe_event_ts timestamp with time zone,
            received_at timestamp with time zone NOT NULL DEFAULT now()
          )
        `),
      );
      await db.execute(
        sql.raw(`
          INSERT INTO "${schema}"."tenant_billing_states" (tenant_id, tier, status, source)
          VALUES ('${tenantId}', 'free', 'active', 'system')
        `),
      );

      // Exercise the exact down-migration DDL sequence, isolated from `public`.
      await db.execute(sql.raw(`ALTER TABLE "${schema}"."tenant_billing_states" DROP COLUMN "billing_cycle"`));
      await db.execute(sql.raw(`ALTER TABLE "${schema}"."tenant_billing_states" DROP COLUMN "cancel_at_period_end"`));
      await db.execute(sql.raw(`ALTER TABLE "${schema}"."tenant_billing_states" DROP COLUMN "current_period_end"`));
      await db.execute(
        sql.raw(`ALTER TABLE "${schema}"."tenant_billing_states" DROP COLUMN "stripe_subscription_status"`),
      );
      await db.execute(
        sql.raw(`ALTER TABLE "${schema}"."tenant_billing_states" DROP COLUMN "stripe_subscription_id"`),
      );
      await db.execute(sql.raw(`ALTER TABLE "${schema}"."tenant_billing_states" DROP COLUMN "stripe_customer_id"`));
      await db.execute(sql.raw(`DROP TABLE "${schema}"."stripe_processed_events"`));
      await db.execute(sql.raw(`DROP TYPE "${schema}"."billing_cycle"`));

      // The pre-existing (11a-shaped) row survives the drop untouched.
      const res = await db.execute<{ tier: string; status: string; source: string }>(
        sql.raw(
          `SELECT tier, status, source FROM "${schema}"."tenant_billing_states" WHERE tenant_id = '${tenantId}'`,
        ),
      );
      expect(res.rows[0]).toMatchObject({ tier: "free", status: "active", source: "system" });

      // The Stripe columns are gone from the catalog after the down.
      const cols = await db.execute<{ count: number }>(
        sql.raw(`
          SELECT count(*)::int AS count FROM information_schema.columns
          WHERE table_schema = '${schema}' AND table_name = 'tenant_billing_states'
            AND column_name IN ('stripe_customer_id','billing_cycle','cancel_at_period_end')
        `),
      );
      expect(Number(cols.rows[0]!.count)).toBe(0);
    } finally {
      // Cleanup drops only the throwaway schema — never touches `public`.
      await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
    }
  });
});

describe.skipIf(hasDb)("stripe schema migration (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
