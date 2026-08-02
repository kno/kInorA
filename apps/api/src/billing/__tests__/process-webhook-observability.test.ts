import { describe, it, expect, vi } from "vitest";
import { ProcessStripeWebhook, type StripeEventStorePort, type RecordEventOutcome } from "../process-webhook.js";
import type { StripeGateway, StripeWebhookEvent, StripeSubscriptionSnapshot } from "../stripe-gateway.js";
import type { ObservabilityLogger } from "../../observability/event-logger.js";

const TENANT = "33333333-0000-0000-0000-000000000001";

function buildSubscription(): StripeSubscriptionSnapshot {
  return {
    tenantId: TENANT,
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    cycle: "monthly",
    currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
  };
}

function buildEvent(overrides: Partial<StripeWebhookEvent> = {}): StripeWebhookEvent {
  return {
    id: "evt_1",
    type: "customer.subscription.updated",
    eventTs: new Date("2026-08-01T00:00:00Z"),
    subscription: buildSubscription(),
    ...overrides,
  };
}

function buildGateway(event: StripeWebhookEvent): StripeGateway {
  return {
    verifyAndParseEvent: vi.fn().mockReturnValue(event),
  } as unknown as StripeGateway;
}

function buildStore(outcome: RecordEventOutcome): StripeEventStorePort {
  return { recordEventAndApply: vi.fn().mockResolvedValue(outcome) };
}

function buildLogger(): ObservabilityLogger & { recordEvent: ReturnType<typeof vi.fn> } {
  return { recordEvent: vi.fn() };
}

describe("ProcessStripeWebhook observability", () => {
  it("records a PII-free billing.webhook event for a processed outcome", async () => {
    const logger = buildLogger();
    const proc = new ProcessStripeWebhook(
      buildGateway(buildEvent()),
      buildStore({ outcome: "processed" }),
      logger,
    );

    await proc.process(Buffer.from("{}"), "sig");

    expect(logger.recordEvent).toHaveBeenCalledTimes(1);
    expect(logger.recordEvent).toHaveBeenCalledWith({
      tenantId: TENANT,
      level: "info",
      event: "billing.webhook",
      outcome: "processed",
      metadata: { eventId: "evt_1", eventType: "customer.subscription.updated" },
    });
  });

  it.each(["duplicate", "stale"] as const)("records the %s outcome at info level", async (outcome) => {
    const logger = buildLogger();
    const proc = new ProcessStripeWebhook(
      buildGateway(buildEvent()),
      buildStore({ outcome }),
      logger,
    );

    await proc.process(Buffer.from("{}"), "sig");

    expect(logger.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info", event: "billing.webhook", outcome }),
    );
  });

  it("records unknown_tenant at warn level", async () => {
    const logger = buildLogger();
    const proc = new ProcessStripeWebhook(
      buildGateway(buildEvent()),
      buildStore({ outcome: "unknown_tenant" }),
      logger,
    );

    await proc.process(Buffer.from("{}"), "sig");

    expect(logger.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        level: "warn",
        event: "billing.webhook",
        outcome: "unknown_tenant",
      }),
    );
  });

  it("records an ignored outcome when the signed event has no actionable subscription", async () => {
    const logger = buildLogger();
    const event = buildEvent({ subscription: undefined });
    const proc = new ProcessStripeWebhook(buildGateway(event), buildStore({ outcome: "processed" }), logger);

    await proc.process(Buffer.from("{}"), "sig");

    expect(logger.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info", event: "billing.webhook", outcome: "ignored" }),
    );
  });

  it("does not require a logger (optional dependency) and still processes", async () => {
    const proc = new ProcessStripeWebhook(buildGateway(buildEvent()), buildStore({ outcome: "processed" }));
    const result = await proc.process(Buffer.from("{}"), "sig");
    expect(result).toEqual({ status: "ok", outcome: "processed" });
  });
});
