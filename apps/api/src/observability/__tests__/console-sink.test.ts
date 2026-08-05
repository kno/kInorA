/**
 * Unit coverage for the console structured sink used by the cron sweep
 * (issue #330 step 5): one JSON line per event, errors on stderr.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsoleLogSink } from "../console-sink.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createConsoleLogSink", () => {
  it("writes info as a single JSON line on stdout", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    createConsoleLogSink().info({ event: "billing.seat_sync_sweep", reconciledCount: 0 }, "obs");

    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]?.[0] as string;
    expect(line.includes("\n")).toBe(false);
    expect(JSON.parse(line)).toEqual({
      msg: "obs",
      event: "billing.seat_sync_sweep",
      reconciledCount: 0,
    });
  });

  it("writes warn on stderr-adjacent console.warn and omits an absent message", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createConsoleLogSink().warn({ event: "observability.record_failed" });

    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "observability.record_failed",
    });
  });

  it("writes error on stderr so a failing sweep surfaces in cron output", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    createConsoleLogSink().error({ event: "billing.seat_sync_sweep", outcome: "failed" }, "obs");

    expect(JSON.parse(error.mock.calls[0]?.[0] as string)).toEqual({
      msg: "obs",
      event: "billing.seat_sync_sweep",
      outcome: "failed",
    });
  });
});
