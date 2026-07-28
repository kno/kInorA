import { describe, it, expect, afterEach, vi } from "vitest";
import { registerProcessSafetyNet } from "../process-safety.js";

describe("registerProcessSafetyNet", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    vi.restoreAllMocks();
  });

  it("logs an unhandledRejection and does NOT crash the process", () => {
    const errors: Array<{ obj: unknown; msg?: string }> = [];
    cleanups.push(
      registerProcessSafetyNet({ error: (obj, msg) => errors.push({ obj, msg }) }),
    );

    // Emitting the event synchronously invokes our handler; if it rethrew or
    // called process.exit this test would fail/abort.
    process.emit("unhandledRejection", new Error("Failed to parse stream"), Promise.resolve());

    expect(errors).toHaveLength(1);
    expect((errors[0]!.obj as { err: Error }).err.message).toBe("Failed to parse stream");
    expect(errors[0]!.msg).toMatch(/kept alive/i);
  });

  it("wraps a non-Error rejection reason in an Error for the log", () => {
    const errors: Array<{ err: Error }> = [];
    cleanups.push(
      registerProcessSafetyNet({ error: (obj) => errors.push(obj as { err: Error }) }),
    );

    process.emit("unhandledRejection", "string reason", Promise.resolve());

    expect(errors[0]!.err).toBeInstanceOf(Error);
    expect(errors[0]!.err.message).toBe("string reason");
  });

  it("unregister removes the listener", () => {
    const before = process.listenerCount("unhandledRejection");
    const off = registerProcessSafetyNet({ error: () => {} });
    expect(process.listenerCount("unhandledRejection")).toBe(before + 1);
    off();
    expect(process.listenerCount("unhandledRejection")).toBe(before);
  });
});
