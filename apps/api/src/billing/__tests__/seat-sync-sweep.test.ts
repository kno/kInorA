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

function reconcilerReturning(tenantIds: string[]): SeatSyncSweepReconciler {
  return { reconcileAllStaleSponsors: vi.fn(async () => tenantIds) };
}

describe("runSeatSyncSweep", () => {
  it("records started then completed with the reconciled sponsor count", async () => {
    const { logger, events } = recordingLogger();

    const reconciled = await runSeatSyncSweep({
      seatSync: reconcilerReturning(["tenant-a", "tenant-b"]),
      observability: logger,
    });

    expect(reconciled).toEqual(["tenant-a", "tenant-b"]);
    expect(events).toEqual([
      { level: "info", event: SEAT_SYNC_SWEEP_EVENT, outcome: "started" },
      {
        level: "info",
        event: SEAT_SYNC_SWEEP_EVENT,
        outcome: "completed",
        metadata: { reconciledCount: 2 },
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
    expect(events[1]?.metadata).toEqual({ reconciledCount: 0 });
  });

  it("records a failed event with the error name and message, then rethrows", async () => {
    const { logger, events } = recordingLogger();
    const failure = new TypeError("stripe unconfigured — seat sync unavailable");

    await expect(
      runSeatSyncSweep({
        seatSync: {
          reconcileAllStaleSponsors: vi.fn(async () => {
            throw failure;
          }),
        },
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
        },
      },
    ]);
  });

  it("records a non-Error rejection without losing the failure", async () => {
    const { logger, events } = recordingLogger();

    await expect(
      runSeatSyncSweep({
        seatSync: {
          reconcileAllStaleSponsors: vi.fn(async () => {
            throw "boom";
          }),
        },
        observability: logger,
      }),
    ).rejects.toBe("boom");

    expect(events[1]?.metadata).toEqual({ errorName: "unknown", errorMessage: "boom" });
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
        seatSync: {
          reconcileAllStaleSponsors: vi.fn(async () => {
            throw new Error("db down");
          }),
        },
        observability: logger,
        flush,
      }),
    ).rejects.toThrow("db down");

    expect(flush).toHaveBeenCalledTimes(1);
  });
});
