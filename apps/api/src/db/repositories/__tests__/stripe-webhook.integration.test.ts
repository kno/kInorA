/**
 * Real-Postgres integration coverage for the 11b Slice 2 Stripe webhook write
 * path (`StripeEventStoreRepository` + `ProcessStripeWebhook`).
 *
 * The pure-fake unit suites (`billing/__tests__/process-webhook.test.ts`,
 * `routes/__tests__/billing-webhook.test.ts`) prove the mapping and the raw
 * signature verification, but only a real Postgres can prove the transactional
 * guarantees the store adapter is responsible for:
 *
 *   1. Idempotency — the `stripe_processed_events` insert-on-conflict-do-nothing
 *      makes a retried delivery of the SAME event id an exactly-once no-op, and
 *      the out-of-order guard (per-tenant `stripe_event_ts` high-water mark)
 *      ignores a strictly older event without regressing newer state.
 *   2. Subscription → billing-state write — a verified active subscription
 *      drives `status='active'`/`tier='pro'`/`source='stripe'`, and a deletion
 *      reconciles to `status='expired'` (Free at read time).
 *   3. #172 override precedence — the webhook writes `status`/`tier` but NEVER
 *      touches `tenant_billing_overrides`, so an ACTIVE admin override still
 *      wins at read time via `resolveEffectiveTier` (unchanged source of truth).
 *
 * Isolation (4R resilience): every test seeds its OWN unique tenant/user and
 * does row-level DML only — no shared-table DDL — so it runs concurrently with
 * the other billing integration suites in the CI `billing-integration` job
 * against a single shared Postgres without lock contention (same rule the
 * Slice-1 rollback test follows).
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness) — skipped when no
 * real Postgres is wired so the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import {
  memberships,
  stripeProcessedEvents,
  tenantBillingOverrides,
  tenantBillingStates,
  tenants,
  users,
} from "../../schema.js";
import { StripeEventStoreRepository } from "../stripe-events.js";
import { BillingStateReaderRepository } from "../billing-quota.js";
import { ProcessStripeWebhook } from "../../../billing/process-webhook.js";
import { resolveEffectiveTier } from "../../../billing/entitlement.js";
import type {
  StripeGateway,
  StripeSubscriptionSnapshot,
  StripeWebhookEvent,
} from "../../../billing/stripe-gateway.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("StripeEventStoreRepository / ProcessStripeWebhook (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const store = new StripeEventStoreRepository(db);
  const reader = new BillingStateReaderRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenantWithMember(): Promise<{ tenantId: string; userId: string }> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `stripe-webhook-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    const [user] = await db
      .insert(users)
      .values({ email: `stripe-webhook-${Date.now()}-${Math.random()}@example.com` })
      .returning({ id: users.id });
    await db.insert(memberships).values({
      tenantId: tenant!.id,
      userId: user!.id,
      role: "owner",
      status: "active",
    });
    return { tenantId: tenant!.id, userId: user!.id };
  }

  function snapshot(tenantId: string, overrides: Partial<StripeSubscriptionSnapshot> = {}): StripeSubscriptionSnapshot {
    return {
      tenantId,
      stripeCustomerId: "cus_int_1",
      stripeSubscriptionId: "sub_int_1",
      status: "active",
      cycle: "monthly",
      currentPeriodEnd: new Date("2026-08-25T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      ...overrides,
    };
  }

  function fixedGateway(event: StripeWebhookEvent): StripeGateway {
    return { verifyAndParseEvent: () => event };
  }

  it("is exactly-once on retry and ignores a stale out-of-order event", async () => {
    const { tenantId } = await seedTenantWithMember();
    const write = {
      tenantId,
      tier: "pro" as const,
      status: "active" as const,
      source: "stripe" as const,
      stripeCustomerId: "cus_int_1",
      stripeSubscriptionId: "sub_int_1",
      stripeSubscriptionStatus: "active",
      billingCycle: "monthly" as const,
      currentPeriodEnd: new Date("2026-08-25T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    };
    const newerTs = new Date("2026-07-25T10:00:00.000Z");

    const first = await store.recordEventAndApply({ eventId: "evt_int_1", type: "customer.subscription.updated", eventTs: newerTs, write });
    const retry = await store.recordEventAndApply({ eventId: "evt_int_1", type: "customer.subscription.updated", eventTs: newerTs, write });

    expect(first).toEqual({ outcome: "processed" });
    expect(retry).toEqual({ outcome: "duplicate" });

    // Exactly one processed-events row for that id.
    const events = await db.select().from(stripeProcessedEvents).where(eq(stripeProcessedEvents.eventId, "evt_int_1"));
    expect(events).toHaveLength(1);

    // A strictly OLDER event (different id) must be ignored without regressing.
    const staleTs = new Date("2026-07-24T10:00:00.000Z");
    const staleWrite = { ...write, status: "expired" as const, stripeSubscriptionStatus: "canceled" };
    const stale = await store.recordEventAndApply({ eventId: "evt_int_stale", type: "customer.subscription.deleted", eventTs: staleTs, write: staleWrite });
    expect(stale).toEqual({ outcome: "stale" });

    const [row] = await db.select().from(tenantBillingStates).where(eq(tenantBillingStates.tenantId, tenantId));
    // State stayed at the NEWER active/pro write — the stale deletion did not win.
    expect(row?.status).toBe("active");
    expect(row?.tier).toBe("pro");
    expect(row?.source).toBe("stripe");
    expect(row?.stripeEventTs?.toISOString()).toBe(newerTs.toISOString());
  });

  // FIX 1 (resilience, 4R follow-up): the OLD guard read the tenant's
  // high-water mark via `SELECT ... FOR UPDATE`, which locks NOTHING when the
  // tenant has no `tenant_billing_states` row yet. Two concurrent FIRST-time
  // deliveries for a brand-new tenant both read "no row", both skipped the
  // stale check, and Postgres serialized only the physical row write — an
  // OLDER event committing last could silently WIN and regress the stored
  // `stripe_event_ts`. The fix moves the guard into the `INSERT ... ON
  // CONFLICT DO UPDATE ... WHERE` clause itself, which Postgres evaluates
  // atomically against the conflicting row's already-committed values. This
  // test fires the older and newer event CONCURRENTLY against a tenant with
  // NO pre-existing billing-state row and asserts the final state always
  // reflects the NEWER event, regardless of which promise settles first.
  it("FIX 1: two concurrent first-time deliveries for a brand-new tenant converge on the NEWER event", async () => {
    const { tenantId } = await seedTenantWithMember();
    const olderTs = new Date("2026-07-24T09:00:00.000Z");
    const newerTs = new Date("2026-07-25T09:00:00.000Z");

    const olderWrite = {
      tenantId,
      tier: "pro" as const,
      status: "expired" as const,
      source: "stripe" as const,
      stripeCustomerId: "cus_race_1",
      stripeSubscriptionId: "sub_race_1",
      stripeSubscriptionStatus: "canceled",
      billingCycle: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
    const newerWrite = {
      ...olderWrite,
      status: "active" as const,
      stripeSubscriptionStatus: "active",
      billingCycle: "monthly" as const,
      currentPeriodEnd: new Date("2026-08-25T00:00:00.000Z"),
    };

    const [olderResult, newerResult] = await Promise.all([
      store.recordEventAndApply({ eventId: "evt_race_old", type: "customer.subscription.deleted", eventTs: olderTs, write: olderWrite }),
      store.recordEventAndApply({ eventId: "evt_race_new", type: "customer.subscription.updated", eventTs: newerTs, write: newerWrite }),
    ]);

    // Which delivery wins the INSERT race is NOT deterministic — Postgres
    // decides that at the storage layer, not this test. Both outcomes are
    // valid depending on who commits first:
    //   - the NEWER tx wins the insert → the older then hits ON CONFLICT and
    //     is rejected by `setWhere` → per-delivery outcomes [processed, stale]
    //   - the OLDER tx wins the insert → the newer then hits ON CONFLICT and
    //     is ACCEPTED by `setWhere` (olderTs < newerTs) → outcomes
    //     [processed, processed]
    // Asserting the exact `["processed", "stale"]` multiset would be flaky
    // (fails red ~50% of the time on CORRECT code, whichever way the race
    // settles). What the fix DETERMINISTICALLY guarantees — regardless of
    // which tx wins the race — is that at least one delivery is accepted and
    // neither is rejected as invalid, AND the final stored state always
    // converges on the NEWER event. That convergence (asserted below) is the
    // real invariant this test protects.
    const outcomes = [olderResult.outcome, newerResult.outcome];
    expect(outcomes).toContain("processed");
    // Neither delivery is ever "duplicate" (they use distinct event ids) — the
    // guard's job is to accept/reject an ordering, never to dedupe here.
    expect(outcomes.every((outcome) => outcome === "processed" || outcome === "stale")).toBe(true);

    const [row] = await db.select().from(tenantBillingStates).where(eq(tenantBillingStates.tenantId, tenantId));
    // Regardless of arrival/commit order, the NEWER event's state always wins.
    expect(row?.status).toBe("active");
    expect(row?.stripeSubscriptionStatus).toBe("active");
    expect(row?.stripeEventTs?.toISOString()).toBe(newerTs.toISOString());
  });

  // FIX 2 (reliability, 4R follow-up): Stripe's `created` is second-granularity,
  // so a deletion and a same-second update can arrive in EITHER order. A
  // same-second terminal (`expired`) state must never be regressed by a
  // same-second non-terminal (`active`) write, tested in BOTH orders.
  it("FIX 2: same-second deletion + update tie-break ends expired regardless of arrival order", async () => {
    const sameTs = new Date("2026-07-25T10:00:00.000Z");

    async function runOrder(order: "delete-then-update" | "update-then-delete") {
      const { tenantId } = await seedTenantWithMember();
      const deletionWrite = {
        tenantId,
        tier: "pro" as const,
        status: "expired" as const,
        source: "stripe" as const,
        stripeCustomerId: "cus_tie_1",
        stripeSubscriptionId: "sub_tie_1",
        stripeSubscriptionStatus: "canceled",
        billingCycle: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      };
      const updateWrite = { ...deletionWrite, status: "active" as const, stripeSubscriptionStatus: "active" };

      if (order === "delete-then-update") {
        await store.recordEventAndApply({ eventId: `evt_tie_del_${order}`, type: "customer.subscription.deleted", eventTs: sameTs, write: deletionWrite });
        await store.recordEventAndApply({ eventId: `evt_tie_upd_${order}`, type: "customer.subscription.updated", eventTs: sameTs, write: updateWrite });
      } else {
        await store.recordEventAndApply({ eventId: `evt_tie_upd_${order}`, type: "customer.subscription.updated", eventTs: sameTs, write: updateWrite });
        await store.recordEventAndApply({ eventId: `evt_tie_del_${order}`, type: "customer.subscription.deleted", eventTs: sameTs, write: deletionWrite });
      }

      const [row] = await db.select().from(tenantBillingStates).where(eq(tenantBillingStates.tenantId, tenantId));
      return row?.status;
    }

    expect(await runOrder("delete-then-update")).toBe("expired");
    expect(await runOrder("update-then-delete")).toBe("expired");
  });

  it("writes subscription → active/pro then reconciles a deletion to expired (Free at read time)", async () => {
    const { tenantId, userId } = await seedTenantWithMember();

    const activeEvent: StripeWebhookEvent = {
      id: "evt_int_active",
      type: "customer.subscription.updated",
      eventTs: new Date("2026-07-25T09:00:00.000Z"),
      subscription: snapshot(tenantId, { status: "active", cycle: "annual" }),
    };
    const activeUc = new ProcessStripeWebhook(fixedGateway(activeEvent), store);
    const activeResult = await activeUc.process(Buffer.from("raw"), "sig");
    expect(activeResult).toEqual({ status: "ok", outcome: "processed" });

    const [afterActive] = await db.select().from(tenantBillingStates).where(eq(tenantBillingStates.tenantId, tenantId));
    expect(afterActive).toMatchObject({ status: "active", tier: "pro", source: "stripe", billingCycle: "annual" });

    // Effective tier resolves to Pro.
    const proCtx = await reader.loadContext({ tenantId, userId });
    expect(resolveEffectiveTier(proCtx, new Date("2026-07-25T12:00:00.000Z")).tier).toBe("pro");

    // A later deletion reconciles to expired → Free at read time.
    const deleteEvent: StripeWebhookEvent = {
      id: "evt_int_delete",
      type: "customer.subscription.deleted",
      eventTs: new Date("2026-07-26T09:00:00.000Z"),
      subscription: snapshot(tenantId, { status: "canceled" }),
    };
    const deleteUc = new ProcessStripeWebhook(fixedGateway(deleteEvent), store);
    await deleteUc.process(Buffer.from("raw"), "sig");

    const [afterDelete] = await db.select().from(tenantBillingStates).where(eq(tenantBillingStates.tenantId, tenantId));
    expect(afterDelete?.status).toBe("expired");

    const freeCtx = await reader.loadContext({ tenantId, userId });
    expect(resolveEffectiveTier(freeCtx, new Date("2026-07-26T12:00:00.000Z")).tier).toBe("free");
  });

  it("#172: an active admin override still wins over a paid-subscription webhook write", async () => {
    const { tenantId, userId } = await seedTenantWithMember();

    // Active admin override window contains "now".
    await db.insert(tenantBillingOverrides).values({
      tenantId,
      tier: "pro",
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-12-31T00:00:00.000Z"),
      createdByUserId: userId,
      reason: "manual grant",
    });

    // The webhook writes an EXPIRED subscription state (would resolve to Free
    // on its own) — proving the override still wins REGARDLESS of the write.
    const expiredEvent: StripeWebhookEvent = {
      id: "evt_int_override",
      type: "customer.subscription.deleted",
      eventTs: new Date("2026-07-25T09:00:00.000Z"),
      subscription: snapshot(tenantId, { status: "canceled" }),
    };
    const uc = new ProcessStripeWebhook(fixedGateway(expiredEvent), store);
    await uc.process(Buffer.from("raw"), "sig");

    const [row] = await db.select().from(tenantBillingStates).where(eq(tenantBillingStates.tenantId, tenantId));
    // The webhook DID write the expired billing state...
    expect(row?.status).toBe("expired");

    // ...but the overrides table is untouched and the active override wins.
    const ctx = await reader.loadContext({ tenantId, userId });
    expect(ctx.activeOverrideTier).toBe("pro");
    const effective = resolveEffectiveTier(ctx, new Date("2026-07-25T12:00:00.000Z"));
    expect(effective.tier).toBe("pro");
    expect(effective.source).toBe("admin_override");
  });
});

describe.skipIf(hasDb)("StripeEventStoreRepository / ProcessStripeWebhook (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
