import { describe, expect, it, vi } from "vitest";
import type { PendingMutation, WorkoutSessionRecord } from "@kinora/contracts";
import { classifyFlushError, runSequentialFlush } from "../flush";

const session: WorkoutSessionRecord = {
  id: "s1",
  workoutPlanId: "p1",
  status: "active",
  startedAt: "2026-07-16T10:00:00.000Z",
  exercises: [],
};

function setMutation(clientSeq: number, setId = `set${clientSeq}`): PendingMutation {
  return {
    kind: "set",
    sessionId: "s1",
    setId,
    input: { completed: true },
    queuedAt: clientSeq * 1000,
    clientSeq,
  };
}

describe("classifyFlushError", () => {
  it("classifies VALIDATION/NOT_FOUND as drop", () => {
    expect(classifyFlushError("VALIDATION")).toBe("drop");
    expect(classifyFlushError("NOT_FOUND")).toBe("drop");
  });

  it("classifies UNREACHABLE/SERVER/AUTH as retry", () => {
    expect(classifyFlushError("UNREACHABLE")).toBe("retry");
    expect(classifyFlushError("SERVER")).toBe("retry");
    expect(classifyFlushError("AUTH")).toBe("retry");
  });

  it("defaults an unclassifiable/undefined code to retry (never silently discards)", () => {
    expect(classifyFlushError(undefined)).toBe("retry");
  });
});

describe("runSequentialFlush", () => {
  it("dispatches mutations strictly sequentially — never Promise.all/concurrent", async () => {
    const inFlight: number[] = [];
    const maxConcurrent = { value: 0 };
    const sendOne = vi.fn(async (mutation: PendingMutation) => {
      inFlight.push(mutation.clientSeq);
      maxConcurrent.value = Math.max(maxConcurrent.value, inFlight.length);
      await new Promise((r) => setTimeout(r, 5));
      inFlight.pop();
      return { kind: "ok" as const, session };
    });

    await runSequentialFlush([setMutation(1), setMutation(2), setMutation(3)], sendOne);
    expect(maxConcurrent.value).toBe(1);
    expect(sendOne).toHaveBeenCalledTimes(3);
  });

  it("marks all mutations synced on success and returns the last acked session", async () => {
    const acked = { ...session, status: "completed" as const };
    const summary = await runSequentialFlush([setMutation(1), setMutation(2)], async () => ({
      kind: "ok",
      session: acked,
    }));
    expect(summary.synced).toHaveLength(2);
    expect(summary.remaining).toHaveLength(0);
    expect(summary.dropped).toHaveLength(0);
    expect(summary.lastAckedSession).toBe(acked);
    expect(summary.haltCode).toBeUndefined();
  });

  it("drops a VALIDATION/NOT_FOUND entry and continues to the next", async () => {
    const summary = await runSequentialFlush(
      [setMutation(1), setMutation(2)],
      async (mutation) =>
        mutation.clientSeq === 1
          ? { kind: "error", code: "VALIDATION" }
          : { kind: "ok", session },
    );
    expect(summary.dropped.map((m) => m.clientSeq)).toEqual([1]);
    expect(summary.synced.map((m) => m.clientSeq)).toEqual([2]);
    expect(summary.remaining).toHaveLength(0);
  });

  it("halts on a retryable failure (UNREACHABLE/SERVER/AUTH), keeping that entry AND all subsequent ones queued IN ORDER", async () => {
    const summary = await runSequentialFlush(
      [setMutation(1), setMutation(2), setMutation(3)],
      async (mutation) =>
        mutation.clientSeq === 2
          ? { kind: "error", code: "SERVER" }
          : { kind: "ok", session },
    );
    expect(summary.synced.map((m) => m.clientSeq)).toEqual([1]);
    // 2 and 3 both stay queued, in order — never skip ahead past a halt.
    expect(summary.remaining.map((m) => m.clientSeq)).toEqual([2, 3]);
    expect(summary.haltCode).toBe("SERVER");
  });

  it("surfaces AUTH distinctly via haltCode (retryable + surfaceable, not poison-dropped)", async () => {
    const summary = await runSequentialFlush([setMutation(1)], async () => ({
      kind: "error",
      code: "AUTH",
    }));
    expect(summary.remaining.map((m) => m.clientSeq)).toEqual([1]);
    expect(summary.dropped).toHaveLength(0);
    expect(summary.haltCode).toBe("AUTH");
  });

  it("never routes STALE_ACTION on mobile — an unexpected code still defaults to retry, never silently drops", async () => {
    const summary = await runSequentialFlush([setMutation(1)], async () => ({
      kind: "error",
      code: undefined,
    }));
    expect(summary.dropped).toHaveLength(0);
    expect(summary.remaining.map((m) => m.clientSeq)).toEqual([1]);
    expect(summary.haltCode).toBeUndefined();
  });
});
