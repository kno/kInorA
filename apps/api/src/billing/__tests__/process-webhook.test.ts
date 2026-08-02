import { describe, it, expect, vi } from "vitest";
import {
  ProcessStripeWebhook,
  mapSubscriptionToWrite,
  resolveBillingStatus,
  shouldAcceptStoreWrite,
  type BillingStateWrite,
  type RecordEventInput,
  type RecordEventOutcome,
  type StripeEventStorePort,
} from "../process-webhook.js";
import {
  StripeGatewayUnconfiguredError,
  StripeSignatureError,
  type StripeGateway,
  type StripeSubscriptionSnapshot,
  type StripeWebhookEvent,
} from "../stripe-gateway.js";
import { GUARD_MATRIX, type GuardTsRelation } from "./stripe-webhook-guard-matrix.fixture.js";

// ---------------------------------------------------------------------------
// Slice 2 — Stripe webhook subscription lifecycle (hottest path).
//
// These tests cover the design Threat Matrix + the spec scenarios against a
// FakeStripeGateway and an in-memory store. The pure mapping (subscription →
// billing-state write) is asserted directly (no mocks); the orchestration
// (signature verify, idempotency, out-of-order, fail-closed) is asserted
// through ProcessStripeWebhook against fakes.
//
// Invariants proven here:
//   - invalid/absent signature → 400-equivalent, NO state write (Threat: spoof/replay/tamper)
//   - duplicate event id → exactly-once, no second side effect
//   - stale (out-of-order) subscription timestamp → ignored, no regression
//   - any handler error → propagates (route maps to 5xx), NEVER grants Pro (fail-closed)
//   - active subscription (monthly AND annual) → status active / tier pro / source stripe
//   - cancel_at_period_end keeps Pro until current_period_end, then expired
//   - subscription deletion → expired
//   - payment-failed grace (past_due) keeps Pro; Stripe-reports-not-entitled → expired
// ---------------------------------------------------------------------------

const TENANT = "11111111-0000-0000-0000-000000000001";

function snapshot(overrides: Partial<StripeSubscriptionSnapshot> = {}): StripeSubscriptionSnapshot {
  return {
    tenantId: TENANT,
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    cycle: "monthly",
    currentPeriodEnd: new Date("2026-08-25T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    seatQuantity: null,
    ...overrides,
  };
}

function event(overrides: Partial<StripeWebhookEvent> = {}): StripeWebhookEvent {
  return {
    id: "evt_1",
    type: "customer.subscription.updated",
    eventTs: new Date("2026-07-25T10:00:00.000Z"),
    subscription: snapshot(),
    ...overrides,
  };
}

/**
 * In-memory store mirroring the real adapter's exactly-once guard AND the
 * atomic out-of-order + same-second terminal-precedence guard via the SAME
 * pure `shouldAcceptStoreWrite` predicate the real SQL WHERE clause encodes
 * (`stripe-events.ts`) — so orchestration-level tests exercise the real
 * decision semantics, not a re-invented approximation.
 */
function fakeStore() {
  const processedEventIds = new Set<string>();
  const highWater = new Map<string, { stripeEventTs: Date; status: "active" | "expired" }>();
  const applied: BillingStateWrite[] = [];
  const port: StripeEventStorePort = {
    recordEventAndApply: vi.fn(async (input: RecordEventInput): Promise<RecordEventOutcome> => {
      if (processedEventIds.has(input.eventId)) return { outcome: "duplicate" };
      processedEventIds.add(input.eventId);
      const existing = highWater.get(input.write.tenantId) ?? null;
      if (!shouldAcceptStoreWrite(existing ? { stripeEventTs: existing.stripeEventTs, status: existing.status } : null, {
        stripeEventTs: input.eventTs,
        status: input.write.status,
      })) {
        return { outcome: "stale" };
      }
      highWater.set(input.write.tenantId, { stripeEventTs: input.eventTs, status: input.write.status });
      applied.push(input.write);
      return { outcome: "processed" };
    }),
  };
  return { port, applied };
}

function fakeGateway(result: StripeWebhookEvent | Error): StripeGateway {
  return {
    verifyAndParseEvent: vi.fn(() => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

const NOW = new Date("2026-07-25T12:00:00.000Z");

describe("resolveBillingStatus (pure mapping)", () => {
  it("active subscription resolves to active", () => {
    expect(resolveBillingStatus("customer.subscription.updated", snapshot({ status: "active" }), NOW)).toBe("active");
  });

  it("trialing subscription resolves to active (Pro)", () => {
    expect(resolveBillingStatus("customer.subscription.updated", snapshot({ status: "trialing" }), NOW)).toBe("active");
  });

  it("past_due keeps Pro (grace) — resolves to active", () => {
    expect(resolveBillingStatus("customer.subscription.updated", snapshot({ status: "past_due" }), NOW)).toBe("active");
  });

  it("canceled / unpaid / incomplete_expired resolve to expired", () => {
    expect(resolveBillingStatus("customer.subscription.updated", snapshot({ status: "canceled" }), NOW)).toBe("expired");
    expect(resolveBillingStatus("customer.subscription.updated", snapshot({ status: "unpaid" }), NOW)).toBe("expired");
    expect(resolveBillingStatus("customer.subscription.updated", snapshot({ status: "incomplete_expired" }), NOW)).toBe(
      "expired",
    );
  });

  it("subscription.deleted event resolves to expired regardless of reported status", () => {
    expect(resolveBillingStatus("customer.subscription.deleted", snapshot({ status: "active" }), NOW)).toBe("expired");
  });

  it("cancel_at_period_end keeps Pro before period end, expires at/after period end", () => {
    const periodEnd = new Date("2026-08-01T00:00:00.000Z");
    const before = new Date("2026-07-25T00:00:00.000Z");
    const after = new Date("2026-08-02T00:00:00.000Z");
    const sub = snapshot({ status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd });
    expect(resolveBillingStatus("customer.subscription.updated", sub, before)).toBe("active");
    expect(resolveBillingStatus("customer.subscription.updated", sub, after)).toBe("expired");
  });

  it("unknown status fails closed to expired", () => {
    // Guards a future/unknown Stripe status from silently granting Pro.
    expect(resolveBillingStatus("customer.subscription.updated", snapshot({ status: "paused" }), NOW)).toBe("expired");
  });
});

describe("mapSubscriptionToWrite (pure mapping)", () => {
  it("active monthly subscription → active/pro/stripe with monthly cycle + period metadata", () => {
    const ev = event({ subscription: snapshot({ cycle: "monthly" }) });
    const write = mapSubscriptionToWrite(ev, ev.subscription!, NOW);
    expect(write).toMatchObject({
      tenantId: TENANT,
      tier: "pro",
      status: "active",
      source: "stripe",
      billingCycle: "monthly",
      stripeSubscriptionStatus: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      cancelAtPeriodEnd: false,
    });
    expect(write.currentPeriodEnd?.toISOString()).toBe("2026-08-25T00:00:00.000Z");
  });

  it("active annual subscription → pro with annual cycle", () => {
    const ev = event({ subscription: snapshot({ cycle: "annual" }) });
    const write = mapSubscriptionToWrite(ev, ev.subscription!, NOW);
    expect(write.tier).toBe("pro");
    expect(write.billingCycle).toBe("annual");
  });

  it("past_due grace → status active, tier pro, records past_due metadata", () => {
    const ev = event({ subscription: snapshot({ status: "past_due" }) });
    const write = mapSubscriptionToWrite(ev, ev.subscription!, NOW);
    expect(write.status).toBe("active");
    expect(write.tier).toBe("pro");
    expect(write.stripeSubscriptionStatus).toBe("past_due");
  });

  it("deletion → status expired", () => {
    const ev = event({ type: "customer.subscription.deleted", subscription: snapshot({ status: "canceled" }) });
    const write = mapSubscriptionToWrite(ev, ev.subscription!, NOW);
    expect(write.status).toBe("expired");
  });

  // 16c Slice B: the webhook persists the Stripe seat quantity as-is, but the
  // design (Q5) confirms NO price→tier mapping — tier stays "pro" regardless
  // of seatQuantity; the trainer/gym tier is granted ONLY by the 16d admin
  // override (`resolveEffectiveTier` gives it unconditional precedence).
  it("seatCount mirrors the snapshot's seatQuantity while tier stays pro (no price→tier mapping)", () => {
    const ev = event({ subscription: snapshot({ seatQuantity: 5 }) });
    const write = mapSubscriptionToWrite(ev, ev.subscription!, NOW);
    expect(write.seatCount).toBe(5);
    expect(write.tier).toBe("pro");
  });

  it("seatCount is null when the snapshot has no seatQuantity (non-seat subscription)", () => {
    const ev = event({ subscription: snapshot({ seatQuantity: null }) });
    const write = mapSubscriptionToWrite(ev, ev.subscription!, NOW);
    expect(write.seatCount).toBeNull();
    expect(write.tier).toBe("pro");
  });
});

describe("ProcessStripeWebhook (orchestration)", () => {
  it("rejects an invalid/absent signature without any state write (spoof/replay/tamper)", async () => {
    const store = fakeStore();
    const uc = new ProcessStripeWebhook(fakeGateway(new StripeSignatureError()), store.port);

    const result = await uc.process(Buffer.from("{}"), "t=1,v1=forged", NOW);

    expect(result).toEqual({ status: "invalid_signature" });
    expect(store.port.recordEventAndApply).not.toHaveBeenCalled();
    expect(store.applied).toHaveLength(0);
  });

  it("active subscription grants Pro exactly once", async () => {
    const store = fakeStore();
    const uc = new ProcessStripeWebhook(fakeGateway(event()), store.port);

    const first = await uc.process(Buffer.from("raw"), "sig", NOW);
    const second = await uc.process(Buffer.from("raw"), "sig", NOW);

    expect(first).toEqual({ status: "ok", outcome: "processed" });
    expect(second).toEqual({ status: "ok", outcome: "duplicate" });
    // Exactly one billing-state write despite two deliveries of the same event.
    expect(store.applied).toHaveLength(1);
    expect(store.applied[0]).toMatchObject({ tier: "pro", status: "active", source: "stripe" });
  });

  it("ignores a stale out-of-order event without regressing newer state", async () => {
    const store = fakeStore();
    const newer = event({ id: "evt_new", eventTs: new Date("2026-07-25T10:00:00.000Z") });
    const older = event({ id: "evt_old", eventTs: new Date("2026-07-24T10:00:00.000Z") });

    const gateway: StripeGateway = {
      verifyAndParseEvent: vi
        .fn()
        .mockReturnValueOnce(newer)
        .mockReturnValueOnce(older),
    };
    const uc = new ProcessStripeWebhook(gateway, store.port);

    await uc.process(Buffer.from("a"), "sig", NOW);
    const stale = await uc.process(Buffer.from("b"), "sig", NOW);

    expect(stale).toEqual({ status: "ok", outcome: "stale" });
    // Only the newer event applied a write.
    expect(store.applied).toHaveLength(1);
  });

  it("fails closed: a store failure propagates and never grants Pro", async () => {
    const failing: StripeEventStorePort = {
      recordEventAndApply: vi.fn(async () => {
        throw new Error("db unavailable");
      }),
    };
    const uc = new ProcessStripeWebhook(fakeGateway(event()), failing);

    await expect(uc.process(Buffer.from("raw"), "sig", NOW)).rejects.toThrow("db unavailable");
  });

  it("fails closed: a non-signature gateway error propagates (never silently grants Pro)", async () => {
    const store = fakeStore();
    const uc = new ProcessStripeWebhook(fakeGateway(new Error("boom")), store.port);

    await expect(uc.process(Buffer.from("raw"), "sig", NOW)).rejects.toThrow("boom");
    expect(store.applied).toHaveLength(0);
  });

  // FIX 3 (resilience, 4R follow-up): an UNCONFIGURED gateway (operator/server
  // fault — missing STRIPE_WEBHOOK_SECRET) must NEVER be treated the same as a
  // spoofed/invalid signature (client fault). `StripeGatewayUnconfiguredError`
  // is deliberately NOT a `StripeSignatureError`, so it propagates here (route
  // → 5xx, Stripe retries) instead of being mapped to the permanent
  // `invalid_signature` (400) that would silently drop real billing events for
  // the whole misconfiguration window.
  it("propagates a StripeGatewayUnconfiguredError instead of mapping it to invalid_signature", async () => {
    const store = fakeStore();
    const uc = new ProcessStripeWebhook(fakeGateway(new StripeGatewayUnconfiguredError()), store.port);

    await expect(uc.process(Buffer.from("raw"), "sig", NOW)).rejects.toBeInstanceOf(StripeGatewayUnconfiguredError);
    expect(store.applied).toHaveLength(0);
  });

  it("StripeGatewayUnconfiguredError is NOT an instance of StripeSignatureError", () => {
    // Guards against a future refactor accidentally re-coupling the two error
    // types, which would silently regress FIX 3 back to a permanent 400 drop.
    expect(new StripeGatewayUnconfiguredError()).not.toBeInstanceOf(StripeSignatureError);
  });

  it("ignores an event with no resolvable tenant (no write, acknowledged)", async () => {
    const store = fakeStore();
    const ev = event({ subscription: snapshot({ tenantId: null }) });
    const uc = new ProcessStripeWebhook(fakeGateway(ev), store.port);

    const result = await uc.process(Buffer.from("raw"), "sig", NOW);

    expect(result).toEqual({ status: "ok", outcome: "ignored" });
    expect(store.applied).toHaveLength(0);
  });

  // #290: a missing tenant (deleted after checkout, before Stripe delivered
  // the subscription webhook) is a PERMANENT condition — the FK on
  // `tenant_billing_states` would otherwise throw, propagate to a 5xx, and
  // have Stripe retry forever (risking auto-disabling the webhook endpoint in
  // live mode). Acknowledge (200) and skip the billing write instead, exactly
  // like the existing no-tenant-in-payload "ignored" path.
  it("acknowledges (200/ignored) when the store reports an unknown tenant, without throwing", async () => {
    const store: StripeEventStorePort = {
      recordEventAndApply: vi.fn(async (): Promise<RecordEventOutcome> => ({ outcome: "unknown_tenant" })),
    };
    const uc = new ProcessStripeWebhook(fakeGateway(event()), store);

    const result = await uc.process(Buffer.from("raw"), "sig", NOW);

    expect(result).toEqual({ status: "ok", outcome: "ignored" });
  });

  it("still verifies the signature and does not affect processed/duplicate/stale mapping", async () => {
    const store = fakeStore();
    const uc = new ProcessStripeWebhook(fakeGateway(event()), store.port);

    const result = await uc.process(Buffer.from("raw"), "sig", NOW);

    expect(result).toEqual({ status: "ok", outcome: "processed" });
    expect(store.applied).toHaveLength(1);
  });

  it("cancellation with cancel_at_period_end keeps Pro before period end", async () => {
    const store = fakeStore();
    const periodEnd = new Date("2026-08-01T00:00:00.000Z");
    const ev = event({ subscription: snapshot({ cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd }) });
    const uc = new ProcessStripeWebhook(fakeGateway(ev), store.port);

    await uc.process(Buffer.from("raw"), "sig", new Date("2026-07-25T00:00:00.000Z"));

    expect(store.applied[0]).toMatchObject({ status: "active", tier: "pro", cancelAtPeriodEnd: true });
  });

  it("subscription deletion reconciles to expired (Free at read time)", async () => {
    const store = fakeStore();
    const ev = event({ type: "customer.subscription.deleted", subscription: snapshot({ status: "canceled" }) });
    const uc = new ProcessStripeWebhook(fakeGateway(ev), store.port);

    await uc.process(Buffer.from("raw"), "sig", NOW);

    expect(store.applied[0]).toMatchObject({ status: "expired" });
  });

  // FIX 2 (reliability, 4R follow-up): Stripe's `created` is second-granularity,
  // so a deletion and a later-arriving update from the SAME second are
  // possible. A same-second non-terminal (`active`) write must NEVER regress
  // an already-stored terminal (`expired`) state — tested in BOTH arrival
  // orders since the guard must be order-independent.
  it("same-second tie-break: an expired-then-active pair (either arrival order) ends expired", async () => {
    const ts = new Date("2026-07-25T10:00:00.000Z");
    const deletion = event({
      id: "evt_del",
      type: "customer.subscription.deleted",
      eventTs: ts,
      subscription: snapshot({ status: "canceled" }),
    });
    const update = event({ id: "evt_upd", type: "customer.subscription.updated", eventTs: ts, subscription: snapshot({ status: "active" }) });

    // Order A: deletion arrives first, then the same-second update.
    const storeA = fakeStore();
    await new ProcessStripeWebhook(fakeGateway(deletion), storeA.port).process(Buffer.from("a"), "sig", NOW);
    await new ProcessStripeWebhook(fakeGateway(update), storeA.port).process(Buffer.from("b"), "sig", NOW);
    expect(storeA.applied.at(-1)).toMatchObject({ status: "expired" });

    // Order B: the same-second update arrives first, then the deletion.
    const storeB = fakeStore();
    await new ProcessStripeWebhook(fakeGateway(update), storeB.port).process(Buffer.from("c"), "sig", NOW);
    await new ProcessStripeWebhook(fakeGateway(deletion), storeB.port).process(Buffer.from("d"), "sig", NOW);
    expect(storeB.applied.at(-1)).toMatchObject({ status: "expired" });
  });
});

describe("shouldAcceptStoreWrite (pure guard predicate — mirrors the SQL WHERE clause)", () => {
  const T1 = new Date("2026-07-25T10:00:00.000Z");
  const T0 = new Date("2026-07-24T10:00:00.000Z");

  it("accepts when there is no existing high-water mark (first-ever write for the tenant)", () => {
    // FIX 1: correctness must NOT depend on a pre-existing row.
    expect(shouldAcceptStoreWrite(null, { stripeEventTs: T1, status: "active" })).toBe(true);
  });

  it("accepts when the existing row has a null stripe_event_ts (pre-Stripe 11a row)", () => {
    expect(shouldAcceptStoreWrite({ stripeEventTs: null, status: "active" }, { stripeEventTs: T1, status: "active" })).toBe(true);
  });

  it("rejects a strictly older incoming event (out-of-order guard)", () => {
    expect(shouldAcceptStoreWrite({ stripeEventTs: T1, status: "active" }, { stripeEventTs: T0, status: "expired" })).toBe(false);
  });

  it("accepts a strictly newer incoming event", () => {
    expect(shouldAcceptStoreWrite({ stripeEventTs: T0, status: "active" }, { stripeEventTs: T1, status: "expired" })).toBe(true);
  });

  it("FIX 2: at an EQUAL timestamp, rejects a non-terminal write over a stored terminal state", () => {
    expect(shouldAcceptStoreWrite({ stripeEventTs: T1, status: "expired" }, { stripeEventTs: T1, status: "active" })).toBe(false);
  });

  it("at an EQUAL timestamp, accepts a terminal write over a stored terminal state (idempotent)", () => {
    expect(shouldAcceptStoreWrite({ stripeEventTs: T1, status: "expired" }, { stripeEventTs: T1, status: "expired" })).toBe(true);
  });

  it("at an EQUAL timestamp, accepts a terminal write over a stored non-terminal state", () => {
    expect(shouldAcceptStoreWrite({ stripeEventTs: T1, status: "active" }, { stripeEventTs: T1, status: "expired" })).toBe(true);
  });

  it("at an EQUAL timestamp, accepts a non-terminal write over a stored non-terminal state", () => {
    expect(shouldAcceptStoreWrite({ stripeEventTs: T1, status: "active" }, { stripeEventTs: T1, status: "active" })).toBe(true);
  });
});

// #201: drift guard between this pure predicate and the real SQL `setWhere`
// clause (`db/repositories/stripe-events.ts`). This suite and the
// real-Postgres `stripe-webhook.integration.test.ts` suite drive the SAME
// `GUARD_MATRIX` fixture through their respective predicate — a one-sided
// edit to either side deterministically fails one of the two suites.
describe("shouldAcceptStoreWrite — full GUARD_MATRIX (drift guard vs. the SQL setWhere clause, #201)", () => {
  const INCOMING_TS = new Date("2026-07-25T10:00:00.000Z");
  const EARLIER_TS = new Date("2026-07-24T10:00:00.000Z");
  const LATER_TS = new Date("2026-07-26T10:00:00.000Z");

  function existingTsFor(relation: GuardTsRelation): Date | null {
    switch (relation) {
      case "none":
        return null; // handled as `existing: null` entirely below
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

  it.each(GUARD_MATRIX)("$name", (testCase) => {
    const existing =
      testCase.tsRelation === "none"
        ? null
        : { stripeEventTs: existingTsFor(testCase.tsRelation), status: testCase.existingStatus! };

    const accepted = shouldAcceptStoreWrite(existing, {
      stripeEventTs: INCOMING_TS,
      status: testCase.incomingStatus,
    });

    expect(accepted).toBe(testCase.expectAccept);
  });
});
