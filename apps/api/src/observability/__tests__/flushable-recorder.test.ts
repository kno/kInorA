/**
 * Unit coverage for the flushable recorder wrapper (issue #330 step 5).
 *
 * The contract that matters: `flush()` waits for every dispatched write, never
 * rejects even when a write failed, and still hands the underlying promise back
 * to `DefaultObservabilityLogger` so a failure is downgraded to a sink warning
 * exactly as before.
 */
import { describe, expect, it, vi } from "vitest";
import { createFlushableRecorder } from "../flushable-recorder.js";
import { DefaultObservabilityLogger, type ObservabilityEventRecord } from "../event-logger.js";

const event: ObservabilityEventRecord = {
  tenantId: null,
  actorUserId: null,
  level: "info",
  event: "billing.seat_sync_sweep",
  outcome: "started",
  metadata: {},
};

describe("createFlushableRecorder", () => {
  it("resolves flush only after a slow write has settled", async () => {
    let settled = false;
    let release = (): void => {};
    const inner = {
      record: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = () => {
              settled = true;
              resolve();
            };
          }),
      ),
    };
    const recorder = createFlushableRecorder(inner);

    void recorder.record(event);
    const flushed = recorder.flush();
    expect(settled).toBe(false);

    release();
    await flushed;
    expect(settled).toBe(true);
  });

  it("resolves immediately when nothing was dispatched", async () => {
    const recorder = createFlushableRecorder({ record: vi.fn(async () => {}) });
    await expect(recorder.flush()).resolves.toBeUndefined();
  });

  it("returns the rejection to the caller so the logger can swallow it", async () => {
    const failure = new Error("insert failed");
    const recorder = createFlushableRecorder({
      record: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(recorder.record(event)).rejects.toBe(failure);
    await expect(recorder.flush()).resolves.toBeUndefined();
  });

  it("never rejects flush when a synchronous throw escapes the inner recorder", async () => {
    const recorder = createFlushableRecorder({
      record: vi.fn(() => {
        throw new Error("sync boom");
      }),
    });

    const pending = recorder.record(event);
    await expect(pending).rejects.toThrow("sync boom");
    await expect(recorder.flush()).resolves.toBeUndefined();
  });

  it("awaits a write dispatched while a flush is already in progress", async () => {
    const completed: string[] = [];
    const recorder = createFlushableRecorder({
      record: async (row) => {
        await Promise.resolve();
        completed.push(String(row.outcome));
      },
    });

    void recorder.record({ ...event, outcome: "first" });
    const flushed = recorder.flush();
    void recorder.record({ ...event, outcome: "second" });

    await flushed;
    expect(completed).toEqual(["first", "second"]);
  });

  it("flushes the writes a DefaultObservabilityLogger dispatched fire-and-forget", async () => {
    const rows: ObservabilityEventRecord[] = [];
    const recorder = createFlushableRecorder({
      record: async (row) => {
        await Promise.resolve();
        rows.push(row);
      },
    });
    const logger = new DefaultObservabilityLogger(recorder);

    logger.recordEvent({ level: "info", event: "billing.seat_sync_sweep", outcome: "completed" });
    expect(rows).toHaveLength(0);

    await recorder.flush();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("completed");
  });
});
