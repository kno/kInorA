import { describe, it, expect, vi } from "vitest";
import {
  DefaultObservabilityLogger,
  type ObservabilityEventRecord,
  type ObservabilityEventRecorderPort,
  type StructuredLogSink,
} from "../event-logger.js";

function buildSink(): StructuredLogSink & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("DefaultObservabilityLogger", () => {
  it("forwards a normalized record to the recorder and emits a matching sink line", async () => {
    const records: ObservabilityEventRecord[] = [];
    const recorder: ObservabilityEventRecorderPort = {
      record: async (row) => {
        records.push(row);
      },
    };
    const sink = buildSink();
    const logger = new DefaultObservabilityLogger(recorder, sink);

    logger.recordEvent({
      tenantId: "tenant-1",
      actorUserId: "user-1",
      level: "info",
      event: "billing.webhook",
      outcome: "processed",
      metadata: { eventId: "evt_1", eventType: "customer.subscription.updated" },
    });

    // fire-and-forget: let the microtask settle
    await Promise.resolve();

    expect(records).toEqual([
      {
        tenantId: "tenant-1",
        actorUserId: "user-1",
        level: "info",
        event: "billing.webhook",
        outcome: "processed",
        metadata: { eventId: "evt_1", eventType: "customer.subscription.updated" },
      },
    ]);
    expect(sink.info).toHaveBeenCalledTimes(1);
    expect(sink.warn).not.toHaveBeenCalled();
    expect(sink.error).not.toHaveBeenCalled();
  });

  it("routes warn/error levels to the matching sink method", () => {
    const recorder: ObservabilityEventRecorderPort = { record: vi.fn().mockResolvedValue(undefined) };
    const sink = buildSink();
    const logger = new DefaultObservabilityLogger(recorder, sink);

    logger.recordEvent({ level: "warn", event: "owner_access.denied" });
    logger.recordEvent({ level: "error", event: "request.error" });

    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.error).toHaveBeenCalledTimes(1);
  });

  it("defaults tenantId/actorUserId/outcome to null and metadata to {}", async () => {
    const records: ObservabilityEventRecord[] = [];
    const recorder: ObservabilityEventRecorderPort = {
      record: async (row) => {
        records.push(row);
      },
    };
    const logger = new DefaultObservabilityLogger(recorder, buildSink());

    logger.recordEvent({ level: "info", event: "tenant.provisioned" });
    await Promise.resolve();

    expect(records[0]).toEqual({
      tenantId: null,
      actorUserId: null,
      level: "info",
      event: "tenant.provisioned",
      outcome: null,
      metadata: {},
    });
  });

  it("strips undefined metadata values but preserves null/number/boolean/string", async () => {
    const records: ObservabilityEventRecord[] = [];
    const recorder: ObservabilityEventRecorderPort = {
      record: async (row) => {
        records.push(row);
      },
    };
    const logger = new DefaultObservabilityLogger(recorder, buildSink());

    logger.recordEvent({
      level: "info",
      event: "generation.failed",
      metadata: {
        planId: "plan-1",
        planSpecId: undefined,
        errorName: "TypeError",
        retries: 0,
        recovered: false,
        note: null,
      },
    });
    await Promise.resolve();

    expect(records[0]!.metadata).toEqual({
      planId: "plan-1",
      errorName: "TypeError",
      retries: 0,
      recovered: false,
      note: null,
    });
    expect("planSpecId" in records[0]!.metadata).toBe(false);
  });

  it("is fire-and-forget: recordEvent returns void synchronously (does not await the recorder)", () => {
    let resolved = false;
    const recorder: ObservabilityEventRecorderPort = {
      record: () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve();
          }, 5);
        }),
    };
    const logger = new DefaultObservabilityLogger(recorder, buildSink());

    const result = logger.recordEvent({ level: "info", event: "x" });
    expect(result).toBeUndefined();
    // The slow insert has NOT settled yet — proving the call did not block.
    expect(resolved).toBe(false);
  });

  it("never throws when the recorder rejects (fail-safe, no unhandled rejection)", async () => {
    const recorder: ObservabilityEventRecorderPort = {
      record: () => Promise.reject(new Error("db down")),
    };
    const sink = buildSink();
    const logger = new DefaultObservabilityLogger(recorder, sink);

    expect(() => logger.recordEvent({ level: "info", event: "x" })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    // The failure is swallowed and surfaced as a warn on the sink, never rethrown.
    expect(sink.warn).toHaveBeenCalled();
  });

  it("never throws when the recorder throws synchronously (fail-safe)", () => {
    const recorder: ObservabilityEventRecorderPort = {
      record: () => {
        throw new Error("sync boom");
      },
    };
    const sink = buildSink();
    const logger = new DefaultObservabilityLogger(recorder, sink);

    expect(() => logger.recordEvent({ level: "info", event: "x" })).not.toThrow();
    expect(sink.warn).toHaveBeenCalled();
  });

  it("never throws when constructed without a sink", () => {
    const recorder: ObservabilityEventRecorderPort = { record: vi.fn().mockResolvedValue(undefined) };
    const logger = new DefaultObservabilityLogger(recorder);
    expect(() => logger.recordEvent({ level: "info", event: "x" })).not.toThrow();
  });
});
