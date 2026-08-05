/**
 * Real-Postgres integration coverage for the seat-sync sweep's observability
 * (issue #330 step 5). Opt-in via `DATABASE_URL` (podman pgvector harness).
 *
 * Proves the end-to-end claim the cron depends on: a sweep — and above all a
 * FAILING sweep — lands durable rows in `observability_events`, the table
 * /admin/logs reads, and that they are flushed before the process could exit.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDbClient } from "../../db/client.js";
import { ObservabilityEventsRepository } from "../../db/repositories/observability-events.js";
import {
  SEAT_SYNC_SWEEP_EVENT,
  buildSeatSyncSweepObservability,
  runSeatSyncSweep,
} from "../seat-sync-sweep.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("seat-sync sweep observability (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const repo = new ObservabilityEventsRepository(db);
  const silentSink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  afterAll(async () => {
    await pool.end();
  });

  async function sweepEventsSince(since: Date) {
    const page = await repo.queryEvents({
      event: SEAT_SYNC_SWEEP_EVENT,
      from: since,
      limit: 100,
    });
    return page.events;
  }

  it("persists started + completed rows for a successful sweep", async () => {
    const since = new Date();
    const { observability, flush } = buildSeatSyncSweepObservability(db, silentSink);

    await runSeatSyncSweep({
      seatSync: { reconcileAllStaleSponsors: async () => ["tenant-x"], outboundMutationEnabled: false },
      observability,
      flush,
    });

    const rows = await sweepEventsSince(since);
    expect(rows.find((row) => row.outcome === "completed")?.metadata).toMatchObject({
      reconciledCount: 1,
      seatBillingEnabled: false,
    });

    const outcomes = rows.map((row) => row.outcome);
    expect(outcomes).toContain("started");
    expect(outcomes).toContain("completed");
    expect(outcomes).not.toContain("failed");
  });

  it("persists a failed row carrying the error name for a broken sweep", async () => {
    const since = new Date();
    const { observability, flush } = buildSeatSyncSweepObservability(db, silentSink);

    await expect(
      runSeatSyncSweep({
        seatSync: {
          reconcileAllStaleSponsors: async () => {
            throw new Error("stripe unconfigured — seat sync unavailable");
          },
          outboundMutationEnabled: true,
        },
        observability,
        flush,
      }),
    ).rejects.toThrow("stripe unconfigured");

    const failed = (await sweepEventsSince(since)).find((row) => row.outcome === "failed");
    expect(failed).toBeDefined();
    expect(failed?.level).toBe("error");
    expect(failed?.metadata).toMatchObject({ errorName: "Error", seatBillingEnabled: true });
  });
});

describe.skipIf(hasDb)("seat-sync sweep observability — skipped", () => {
  it("requires DATABASE_URL to run", () => {
    expect(hasDb).toBe(false);
  });
});
