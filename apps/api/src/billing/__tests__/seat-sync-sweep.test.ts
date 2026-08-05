/**
 * Unit coverage for the observable seat-sync sweep (issue #330 step 5).
 *
 * Asserts the three recorded observations (started / completed / failed), that
 * a failure is BOTH recorded and rethrown (so the cron exits non-zero), and
 * that pending event writes are flushed before either terminal path returns.
 */
import { describe, expect, it, vi } from "vitest";
import {
  SEAT_SYNC_SWEEP_EVENT,
  runSeatSyncSweep,
  type SeatSyncSweepReconciler,
} from "../seat-sync-sweep.js";
import { buildSeatSyncService } from "../seat-sync-factory.js";
import type { Database } from "../../db/client.js";
import type { ObservabilityEventInput, ObservabilityLogger } from "../../observability/event-logger.js";

function recordingLogger(): { logger: ObservabilityLogger; events: ObservabilityEventInput[] } {
  const events: ObservabilityEventInput[] = [];
  return {
    events,
    logger: {
      recordEvent(input) {
        events.push(input);
      },
    },
  };
}

function reconcilerReturning(
  tenantIds: string[],
  outboundMutationEnabled = false,
): SeatSyncSweepReconciler {
  return { reconcileAllStaleSponsors: vi.fn(async () => tenantIds), outboundMutationEnabled };
}

function failingReconciler(
  failure: unknown,
  outboundMutationEnabled = false,
): SeatSyncSweepReconciler {
  return {
    reconcileAllStaleSponsors: vi.fn(async () => {
      throw failure;
    }),
    outboundMutationEnabled,
  };
}

describe("runSeatSyncSweep", () => {
  it("records started then completed with the reconciled sponsor count", async () => {
    const { logger, events } = recordingLogger();

    const reconciled = await runSeatSyncSweep({
      seatSync: reconcilerReturning(["tenant-a", "tenant-b"], true),
      observability: logger,
    });

    expect(reconciled).toEqual(["tenant-a", "tenant-b"]);
    expect(events).toEqual([
      { level: "info", event: SEAT_SYNC_SWEEP_EVENT, outcome: "started" },
      {
        level: "info",
        event: SEAT_SYNC_SWEEP_EVENT,
        outcome: "completed",
        metadata: { reconciledCount: 2, seatBillingEnabled: true },
      },
    ]);
  });

  it("reports reconciledCount 0 on an empty system without extra noise", async () => {
    const { logger, events } = recordingLogger();

    await runSeatSyncSweep({
      seatSync: reconcilerReturning([]),
      observability: logger,
    });

    expect(events).toHaveLength(2);
    expect(events[1]?.metadata).toEqual({ reconciledCount: 0, seatBillingEnabled: false });
  });

  it("records a failed event with the error name and message, then rethrows", async () => {
    const { logger, events } = recordingLogger();
    const failure = new TypeError("stripe unconfigured — seat sync unavailable");

    await expect(
      runSeatSyncSweep({
        seatSync: failingReconciler(failure, true),
        observability: logger,
      }),
    ).rejects.toBe(failure);

    expect(events).toEqual([
      { level: "info", event: SEAT_SYNC_SWEEP_EVENT, outcome: "started" },
      {
        level: "error",
        event: SEAT_SYNC_SWEEP_EVENT,
        outcome: "failed",
        metadata: {
          errorName: "TypeError",
          errorMessage: "stripe unconfigured — seat sync unavailable",
          seatBillingEnabled: true,
        },
      },
    ]);
  });

  it("records a non-Error rejection without losing the failure", async () => {
    const { logger, events } = recordingLogger();

    await expect(
      runSeatSyncSweep({
        seatSync: failingReconciler("boom"),
        observability: logger,
      }),
    ).rejects.toBe("boom");

    expect(events[1]?.metadata).toEqual({
      errorName: "unknown",
      errorMessage: "boom",
      seatBillingEnabled: false,
    });
  });

  it("flushes pending event writes before returning on success", async () => {
    const { logger, events } = recordingLogger();
    const flush = vi.fn(async () => {
      // Both observations must already be recorded when the flush happens,
      // otherwise a short-lived process could exit before the INSERT lands.
      expect(events).toHaveLength(2);
    });

    await runSeatSyncSweep({
      seatSync: reconcilerReturning([]),
      observability: logger,
      flush,
    });

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("flushes the failed event before rethrowing", async () => {
    const { logger, events } = recordingLogger();
    const flush = vi.fn(async () => {
      expect(events[1]?.outcome).toBe("failed");
    });

    await expect(
      runSeatSyncSweep({
        seatSync: failingReconciler(new Error("db down")),
        observability: logger,
        flush,
      }),
    ).rejects.toThrow("db down");

    expect(flush).toHaveBeenCalledTimes(1);
  });
});

/**
 * ANTI-DRIFT: the recorded `seatBillingEnabled` must come from the SAME field
 * `SeatSyncService` gates its outbound Stripe call on, resolved through the
 * real factory — not from a second `SEAT_BILLING_ENABLED` read. These drive a
 * real service (with the DB/Stripe seams faked) so a future change that stops
 * honouring the flag would flip the recorded value too, instead of leaving the
 * log confidently wrong.
 */
describe("runSeatSyncSweep — recorded flag state tracks the real composition", () => {
  const fakeDatabase = {} as Database;

  function serviceWithEnv(env: NodeJS.ProcessEnv) {
    return buildSeatSyncService({
      database: fakeDatabase,
      env,
      trainerAssignmentRepo: { countActiveByTrainer: vi.fn(async () => 0) },
      stripeGateway: { updateSubscriptionQuantity: vi.fn(async () => undefined) },
      store: {
        withSponsorLock: vi.fn(async () => undefined),
        findSponsorsWithSeatDrift: vi.fn(async () => []),
      },
    });
  }

  it("records seatBillingEnabled false when SEAT_BILLING_ENABLED is unset (DB-side recompute only)", async () => {
    const { logger, events } = recordingLogger();
    const service = serviceWithEnv({});
    expect(service.outboundMutationEnabled).toBe(false);

    await runSeatSyncSweep({ seatSync: service, observability: logger });

    expect(events[1]?.metadata).toEqual({ reconciledCount: 0, seatBillingEnabled: false });
  });

  it("records seatBillingEnabled true when SEAT_BILLING_ENABLED=1", async () => {
    const { logger, events } = recordingLogger();
    const service = serviceWithEnv({
      SEAT_BILLING_ENABLED: "1",
      STRIPE_PRICE_TRAINER_SEAT_MONTHLY: "price_seat_monthly",
    });
    expect(service.outboundMutationEnabled).toBe(true);

    await runSeatSyncSweep({ seatSync: service, observability: logger });

    expect(events[1]?.metadata).toEqual({ reconciledCount: 0, seatBillingEnabled: true });
  });

  it("records seatBillingEnabled false for any value other than the exact '1' the service gates on", async () => {
    const { logger, events } = recordingLogger();

    await runSeatSyncSweep({
      seatSync: serviceWithEnv({ SEAT_BILLING_ENABLED: "true" }),
      observability: logger,
    });

    expect(events[1]?.metadata).toEqual({ reconciledCount: 0, seatBillingEnabled: false });
  });
});
