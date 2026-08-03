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
import { GUARD_MATRIX, type GuardTsRelation } from "../../../billing/__tests__/stripe-webhook-guard-matrix.fixture.js";
import type {
  StripeGateway,
  StripeSubscriptionSnapshot,
  StripeWebhookEvent,
} from "../../../billing/stripe-gateway.js";

const hasDb = Boolean(process.env.DATABASE_URL);

// #282: `stripe_processed_events` is keyed GLOBALLY by event id (not per
// tenant). Against a persistent local Postgres that is NOT reset between
// test runs, a hardcoded event id from a previous run would already be
// recorded, turning a would-be "processed" outcome into "duplicate" and
// breaking every assertion that expects a fresh delivery. Suffixing every
// event id with a per-run token makes each run's ids unique, so reruns
// against the same persistent DB never collide.
const RUN = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

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
      seatQuantity: null,
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
    const evtId = `evt_int_1_${RUN}`;

    const first = await store.recordEventAndApply({ eventId: evtId, type: "customer.subscription.updated", eventTs: newerTs, write });
    const retry = await store.recordEventAndApply({ eventId: evtId, type: "customer.subscription.updated", eventTs: newerTs, write });

    expect(first).toEqual({ outcome: "processed" });
    expect(retry).toEqual({ outcome: "duplicate" });

    // Exactly one processed-events row for that id.
    const events = await db.select().from(stripeProcessedEvents).where(eq(stripeProcessedEvents.eventId, evtId));
    expect(events).toHaveLength(1);

    // A strictly OLDER event (different id) must be ignored without regressing.
    const staleTs = new Date("2026-07-24T10:00:00.000Z");
    const staleWrite = { ...write, status: "expired" as const, stripeSubscriptionStatus: "canceled" };
    const staleEvtId = `evt_int_stale_${RUN}`;
    const stale = await store.recordEventAndApply({ eventId: staleEvtId, type: "customer.subscription.deleted", eventTs: staleTs, write: staleWrite });
    expect(stale).toEqual({ outcome: "stale" });

    const [row] = await db.select().from(tenantBillingStates).where(eq(tenantBillingStates.tenantId, tenantId));
    // State stayed at the NEWER active/pro write — the stale deletion did not win.
    expect(row?.status).toBe("active");
    expect(row?.tier).toBe("pro");
    expect(row?.source).toBe("stripe");
    expect(row?.stripeEventTs?.toISOString()).toBe(newerTs.toISOString());
  });

  // #290: a webhook event whose tenantId has NO row in `tenants` (e.g. a
  // checkout whose tenant was later deleted) is a PERMANENT condition — the
  // FK on `tenant_billing_states` would otherwise throw, propagate as a 5xx,
  // and have Stripe retry forever. The store must instead record the
  // idempotency row (so Stripe stops retrying) and skip the billing write
  // entirely, without throwing.
  it("#290: an unknown tenantId is recorded (idempotency) and skipped, no throw, no billing write", async () => {
    const unknownTenantId = "00000000-0000-0000-0000-000000000099";
    const evtId = `evt_int_unknown_tenant_${Date.now()}_${Math.random()}`;
    const write = {
      tenantId: unknownTenantId,
      tier: "pro" as const,
      status: "active" as const,
      source: "stripe" as const,
      stripeCustomerId: "cus_unknown_1",
      stripeSubscriptionId: "sub_unknown_1",
      stripeSubscriptionStatus: "active",
      billingCycle: "monthly" as const,
      currentPeriodEnd: new Date("2026-08-25T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    };
    const eventTs = new Date("2026-07-25T10:00:00.000Z");

    const result = await store.recordEventAndApply({
      eventId: evtId,
      type: "customer.subscription.updated",
      eventTs,
      write,
    });
    expect(result).toEqual({ outcome: "unknown_tenant" });

    // Idempotency row IS written (so a retry safely no-ops).
    const events = await db
      .select()
      .from(stripeProcessedEvents)
      .where(eq(stripeProcessedEvents.eventId, evtId));
    expect(events).toHaveLength(1);

    // No billing-state row was written for the unknown tenant.
    const rows = await db.select().from(tenantBillingStates).where(eq(tenantBillingStates.tenantId, unknownTenantId));
    expect(rows).toHaveLength(0);

    // A retry of the SAME event id is idempotent (duplicate), still no write.
    const retry = await store.recordEventAndApply({
      eventId: evtId,
      type: "customer.subscription.updated",
      eventTs,
      write,
    });
    expect(retry).toEqual({ outcome: "duplicate" });
    const rowsAfterRetry = await db
      .select()
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, unknownTenantId));
    expect(rowsAfterRetry).toHaveLength(0);
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
      store.recordEventAndApply({ eventId: `evt_race_old_${RUN}`, type: "customer.subscription.deleted", eventTs: olderTs, write: olderWrite }),
      store.recordEventAndApply({ eventId: `evt_race_new_${RUN}`, type: "customer.subscription.updated", eventTs: newerTs, write: newerWrite }),
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

      const delEvtId = `evt_tie_del_${order}_${RUN}`;
      const updEvtId = `evt_tie_upd_${order}_${RUN}`;
      if (order === "delete-then-update") {
        await store.recordEventAndApply({ eventId: delEvtId, type: "customer.subscription.deleted", eventTs: sameTs, write: deletionWrite });
        await store.recordEventAndApply({ eventId: updEvtId, type: "customer.subscription.updated", eventTs: sameTs, write: updateWrite });
      } else {
        await store.recordEventAndApply({ eventId: updEvtId, type: "customer.subscription.updated", eventTs: sameTs, write: updateWrite });
        await store.recordEventAndApply({ eventId: delEvtId, type: "customer.subscription.deleted", eventTs: sameTs, write: deletionWrite });
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
      id: `evt_int_active_${RUN}`,
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
      id: `evt_int_delete_${RUN}`,
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

  // 16c-v3-b2b-seat-billing Slice B: the webhook upsert persists `seatCount`
  // alongside the other Stripe-derived columns, under the SAME exactly-once/
  // out-of-order guard, and a later event updates the persisted value.
  it("16c Slice B: persists seat_count on write, and updates it on a later event", async () => {
    const { tenantId } = await seedTenantWithMember();

    const firstEvent: StripeWebhookEvent = {
      id: `evt_seat_first_${RUN}`,
      type: "customer.subscription.updated",
      eventTs: new Date("2026-07-25T09:00:00.000Z"),
      subscription: snapshot(tenantId, { status: "active", seatQuantity: 3 }),
    };
    const uc = new ProcessStripeWebhook(fixedGateway(firstEvent), store);
    const firstResult = await uc.process(Buffer.from("raw"), "sig");
    expect(firstResult).toEqual({ status: "ok", outcome: "processed" });

    const [afterFirst] = await db
      .select()
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, tenantId));
    expect(afterFirst?.seatCount).toBe(3);
    // No price→tier mapping — tier stays pro (Decision Q5).
    expect(afterFirst?.tier).toBe("pro");

    const laterEvent: StripeWebhookEvent = {
      id: `evt_seat_later_${RUN}`,
      type: "customer.subscription.updated",
      eventTs: new Date("2026-07-26T09:00:00.000Z"),
      subscription: snapshot(tenantId, { status: "active", seatQuantity: 7 }),
    };
    const laterUc = new ProcessStripeWebhook(fixedGateway(laterEvent), store);
    const laterResult = await laterUc.process(Buffer.from("raw"), "sig");
    expect(laterResult).toEqual({ status: "ok", outcome: "processed" });

    const [afterLater] = await db
      .select()
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, tenantId));
    expect(afterLater?.seatCount).toBe(7);
    expect(afterLater?.tier).toBe("pro");
  });

  // 16c-v3-b2b-seat-billing Slice F (design "Downgrade / lapse behavior"): a
  // canceled Stripe subscription object can still report its last-known item
  // quantity, so the webhook must explicitly zero the PERSISTED seat_count on
  // cancel/expiry — it must never linger to inflate the seat-scaled limit
  // formula for a sponsor whose Stripe billing has ended.
  it("16c Slice F: a customer.subscription.deleted event zeroes the persisted seat_count", async () => {
    const { tenantId } = await seedTenantWithMember();

    const activeEvent: StripeWebhookEvent = {
      id: `evt_seat_lapse_active_${RUN}`,
      type: "customer.subscription.updated",
      eventTs: new Date("2026-07-25T09:00:00.000Z"),
      subscription: snapshot(tenantId, { status: "active", seatQuantity: 4 }),
    };
    await new ProcessStripeWebhook(fixedGateway(activeEvent), store).process(Buffer.from("raw"), "sig");

    const [beforeLapse] = await db
      .select()
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, tenantId));
    expect(beforeLapse?.seatCount).toBe(4);
    expect(beforeLapse?.status).toBe("active");

    // Stripe still reports the LAST-KNOWN quantity (4) on the deleted
    // subscription object — the webhook must zero seat_count regardless.
    const deletedEvent: StripeWebhookEvent = {
      id: `evt_seat_lapse_deleted_${RUN}`,
      type: "customer.subscription.deleted",
      eventTs: new Date("2026-07-26T09:00:00.000Z"),
      subscription: snapshot(tenantId, { status: "canceled", seatQuantity: 4 }),
    };
    await new ProcessStripeWebhook(fixedGateway(deletedEvent), store).process(Buffer.from("raw"), "sig");

    const [afterLapse] = await db
      .select()
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, tenantId));
    expect(afterLapse?.status).toBe("expired");
    expect(afterLapse?.seatCount).toBeNull();
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
      id: `evt_int_override_${RUN}`,
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

// #201: drift guard between the pure `shouldAcceptStoreWrite` predicate
// (`billing/process-webhook.ts`) and the real `INSERT ... ON CONFLICT DO
// UPDATE ... WHERE` clause it mirrors (`stripe-events.ts`). This suite drives
// the SAME `GUARD_MATRIX` fixture the pure-unit suite
// (`billing/__tests__/process-webhook.test.ts`) uses through the actual DB
// upsert, and asserts the real accept/reject outcome matches the fixture's
// expectation for every row — a one-sided edit to either predicate
// deterministically fails one of the two suites instead of silently drifting.
describe.skipIf(!hasDb)("StripeEventStoreRepository — GUARD_MATRIX vs. real Postgres setWhere (#201)", () => {
  const { db, pool } = createDbClient();
  const store = new StripeEventStoreRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  const INCOMING_TS = new Date("2026-07-25T10:00:00.000Z");
  const EARLIER_TS = new Date("2026-07-24T10:00:00.000Z");
  const LATER_TS = new Date("2026-07-26T10:00:00.000Z");

  function existingTsFor(relation: GuardTsRelation): Date | null {
    switch (relation) {
      case "none":
      case "null":
        return null;
      case "earlier":
        return EARLIER_TS;
      case "equal":
        return INCOMING_TS;
      case "later":
        return LATER_TS;
    }
  }

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `guard-matrix-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedExistingRow(tenantId: string, tsRelation: GuardTsRelation, status: "active" | "expired") {
    if (tsRelation === "none") return; // no pre-existing row for this case
    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "pro",
      status,
      source: "stripe",
      stripeEventTs: existingTsFor(tsRelation),
    });
  }

  it.each(GUARD_MATRIX)("$name", async (testCase) => {
    const tenantId = await seedTenant();
    await seedExistingRow(tenantId, testCase.tsRelation, testCase.existingStatus ?? "active");

    const write = {
      tenantId,
      tier: "pro" as const,
      status: testCase.incomingStatus,
      source: "stripe" as const,
      stripeCustomerId: "cus_matrix",
      stripeSubscriptionId: "sub_matrix",
      stripeSubscriptionStatus: testCase.incomingStatus === "active" ? "active" : "canceled",
      billingCycle: testCase.incomingStatus === "active" ? ("monthly" as const) : null,
      currentPeriodEnd: testCase.incomingStatus === "active" ? new Date("2026-08-25T00:00:00.000Z") : null,
      cancelAtPeriodEnd: false,
    };

    const result = await store.recordEventAndApply({
      eventId: `evt_matrix_${tenantId}_${RUN}`,
      type: "customer.subscription.updated",
      eventTs: INCOMING_TS,
      write,
    });

    // The real upsert's accept/reject decision must equal the fixture's
    // expectation — the same expectation the pure predicate is asserted
    // against in the unit suite.
    const accepted = result.outcome === "processed";
    expect(accepted).toBe(testCase.expectAccept);

    const [row] = await db.select().from(tenantBillingStates).where(eq(tenantBillingStates.tenantId, tenantId));
    if (testCase.expectAccept) {
      expect(row?.status).toBe(testCase.incomingStatus);
      expect(row?.stripeEventTs?.toISOString()).toBe(INCOMING_TS.toISOString());
    } else {
      // Rejected: the existing row (if any) must be left untouched.
      expect(row?.status).toBe(testCase.existingStatus);
    }
  });
});

describe.skipIf(hasDb)("StripeEventStoreRepository / ProcessStripeWebhook (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
