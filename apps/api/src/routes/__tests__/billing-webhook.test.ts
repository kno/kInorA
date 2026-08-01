import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Stripe from "stripe";
import { stripeWebhookRoutes } from "../billing.js";
import { StripeApiGateway, UnconfiguredStripeGateway } from "../../db/repositories/stripe-gateway.js";
import {
  ProcessStripeWebhook,
  type BillingStateWrite,
  type RecordEventInput,
  type RecordEventOutcome,
  type StripeEventStorePort,
} from "../../billing/process-webhook.js";

// ---------------------------------------------------------------------------
// Slice 2 — RAW-body signature verification (hermetic, no live Stripe, no DB).
//
// The webhook route is UNAUTHENTICATED: the Stripe signature IS the auth. This
// suite exercises the REAL StripeApiGateway (which calls
// stripe.webhooks.constructEvent) against events signed with a known test
// secret via stripe.webhooks.generateTestHeaderString — fully hermetic. It
// proves: a validly signed event drives an active→pro write; a tampered raw
// body fails verification (400, no write); a missing signature is rejected
// (400, no write).
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = "whsec_test_51H8qL... (hermetic-known-secret)";
const TENANT = "22222222-0000-0000-0000-000000000001";
const stripe = new Stripe("sk_test_hermetic");

function subscriptionEventPayload(overrides: {
  id?: string;
  type?: string;
  status?: string;
  interval?: "month" | "year";
  cancelAtPeriodEnd?: boolean;
  tenantId?: string | null;
} = {}): string {
  const sub = {
    id: "sub_hermetic_1",
    object: "subscription",
    status: overrides.status ?? "active",
    customer: "cus_hermetic_1",
    cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
    current_period_end: 1_787_000_000,
    items: {
      object: "list",
      data: [{ price: { recurring: { interval: overrides.interval ?? "month" } } }],
    },
    metadata: overrides.tenantId === null ? {} : { tenantId: overrides.tenantId ?? TENANT },
  };
  const event = {
    id: overrides.id ?? "evt_hermetic_1",
    object: "event",
    type: overrides.type ?? "customer.subscription.updated",
    created: 1_785_000_000,
    data: { object: sub },
  };
  return JSON.stringify(event);
}

function sign(payload: string): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

function fakeStore() {
  const processed = new Set<string>();
  const applied: BillingStateWrite[] = [];
  const port: StripeEventStorePort = {
    recordEventAndApply: vi.fn(async (input: RecordEventInput): Promise<RecordEventOutcome> => {
      if (processed.has(input.eventId)) return { outcome: "duplicate" };
      processed.add(input.eventId);
      applied.push(input.write);
      return { outcome: "processed" };
    }),
  };
  return { port, applied };
}

async function buildWebhookApp(store: StripeEventStorePort): Promise<FastifyInstance> {
  return buildWebhookAppWithGateway(new StripeApiGateway("sk_test_hermetic", WEBHOOK_SECRET, stripe), store);
}

async function buildWebhookAppWithGateway(
  gateway: ConstructorParameters<typeof ProcessStripeWebhook>[0],
  store: StripeEventStorePort,
): Promise<FastifyInstance> {
  const app = Fastify();
  const processWebhook = new ProcessStripeWebhook(gateway, store);
  await app.register(stripeWebhookRoutes, { processWebhook });
  await app.ready();
  return app;
}

describe("POST /billing/webhook — raw-body signature verification (hermetic)", () => {
  it("accepts a validly signed active subscription event and writes active/pro", async () => {
    const store = fakeStore();
    const app = await buildWebhookApp(store.port);

    const payload = subscriptionEventPayload({ status: "active", interval: "month" });
    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": sign(payload) },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(store.applied).toHaveLength(1);
    expect(store.applied[0]).toMatchObject({
      tenantId: TENANT,
      tier: "pro",
      status: "active",
      source: "stripe",
      billingCycle: "monthly",
      stripeCustomerId: "cus_hermetic_1",
      stripeSubscriptionId: "sub_hermetic_1",
    });

    await app.close();
  });

  // #290: the store reporting an unknown tenant (deleted after checkout,
  // before Stripe delivered the subscription event) must still ACK with 200,
  // not 500 — a 5xx here would have Stripe retry forever on a permanent
  // condition and risk auto-disabling the webhook endpoint in live mode.
  it("acknowledges with 200 (not 500) when the store reports an unknown tenant", async () => {
    const port: StripeEventStorePort = {
      recordEventAndApply: vi.fn(async (): Promise<RecordEventOutcome> => ({ outcome: "unknown_tenant" })),
    };
    const app = await buildWebhookApp(port);

    const payload = subscriptionEventPayload();
    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": sign(payload) },
      payload,
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it("maps an annual subscription to the annual cycle", async () => {
    const store = fakeStore();
    const app = await buildWebhookApp(store.port);

    const payload = subscriptionEventPayload({ interval: "year" });
    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": sign(payload) },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(store.applied[0]).toMatchObject({ tier: "pro", billingCycle: "annual" });

    await app.close();
  });

  it("rejects a tampered raw body with 400 and no state write", async () => {
    const store = fakeStore();
    const app = await buildWebhookApp(store.port);

    const payload = subscriptionEventPayload();
    const signature = sign(payload);
    // Mutate the body AFTER signing — the signature no longer matches the bytes.
    const tampered = payload.replace('"status":"active"', '"status":"canceled"');
    expect(tampered).not.toBe(payload);

    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      payload: tampered,
    });

    expect(response.statusCode).toBe(400);
    expect(store.applied).toHaveLength(0);

    await app.close();
  });

  it("rejects a request with no stripe-signature header with 400 and no state write", async () => {
    const store = fakeStore();
    const app = await buildWebhookApp(store.port);

    const payload = subscriptionEventPayload();
    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json" },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(store.applied).toHaveLength(0);

    await app.close();
  });

  it("rejects a forged signature with 400 and no state write", async () => {
    const store = fakeStore();
    const app = await buildWebhookApp(store.port);

    const payload = subscriptionEventPayload();
    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(store.applied).toHaveLength(0);

    await app.close();
  });
});

// FIX 3 (resilience, 4R follow-up): an UNCONFIGURED gateway (missing Stripe
// env — an OPERATOR/SERVER fault) must fail closed with a RETRYABLE 5xx, never
// the same permanent 400 a genuinely invalid/spoofed signature gets. A 400
// tells Stripe "do not retry" — misclassifying a misconfigured deployment as a
// spoof attempt would silently drop every real billing event for the whole
// misconfiguration window.
describe("POST /billing/webhook — unconfigured gateway fails closed retryably (hermetic)", () => {
  it("returns 5xx (not 400) and writes no state when Stripe is unconfigured", async () => {
    const store = fakeStore();
    const app = await buildWebhookAppWithGateway(new UnconfiguredStripeGateway(), store.port);

    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=irrelevant" },
      payload: subscriptionEventPayload(),
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(store.applied).toHaveLength(0);

    await app.close();
  });

  it("a genuinely invalid/forged signature against a CONFIGURED gateway still returns 400 (not 5xx)", async () => {
    // Regression guard: proves FIX 3 did not weaken the existing client-fault
    // path — only the unconfigured/operator-fault path changed.
    const store = fakeStore();
    const app = await buildWebhookApp(store.port);

    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      payload: subscriptionEventPayload(),
    });

    expect(response.statusCode).toBe(400);
    expect(store.applied).toHaveLength(0);

    await app.close();
  });
});

// The web reverse-proxy only forwards `/api/:path*` to the api (next.config.ts),
// while the api mounts routes unprefixed — so the webhook is ALSO registered
// under `/api` (app.ts) to be reachable by Stripe in prod. Prove the prefixed
// registration keeps the raw-body parser + signature verification intact.
describe("POST /api/billing/webhook — prefixed registration stays reachable (hermetic)", () => {
  async function buildPrefixedApp(store: StripeEventStorePort): Promise<FastifyInstance> {
    const app = Fastify();
    const processWebhook = new ProcessStripeWebhook(
      new StripeApiGateway("sk_test_hermetic", WEBHOOK_SECRET, stripe),
      store,
    );
    await app.register(stripeWebhookRoutes, { prefix: "/api", processWebhook });
    await app.ready();
    return app;
  }

  it("accepts a validly signed event at /api/billing/webhook and writes state", async () => {
    const store = fakeStore();
    const app = await buildPrefixedApp(store.port);

    const payload = subscriptionEventPayload({ status: "active", interval: "month" });
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": sign(payload) },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(store.applied).toHaveLength(1);
    expect(store.applied[0]).toMatchObject({ tenantId: TENANT, tier: "pro", source: "stripe" });

    await app.close();
  });

  it("rejects a forged signature at /api/billing/webhook with 400 and no write", async () => {
    const store = fakeStore();
    const app = await buildPrefixedApp(store.port);

    const response = await app.inject({
      method: "POST",
      url: "/api/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      payload: subscriptionEventPayload(),
    });

    expect(response.statusCode).toBe(400);
    expect(store.applied).toHaveLength(0);

    await app.close();
  });
});
