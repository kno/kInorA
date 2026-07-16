import { describe, it, expect } from "vitest";
import type { PendingMutation, WorkoutSessionRecord } from "@kinora/contracts";
import {
  classifyFlushError,
  isStaleActionError,
  runSequentialFlush,
} from "../flush";

/**
 * Sequential flush orchestration (Phase 4 web offline design: "Flush is
 * strictly sequential" + "Failure taxonomy"). Pure/injectable — `sendOne` is
 * a fake here; the REAL wiring to `recordWorkoutSetAction` /
 * `completeWorkoutSessionAction` lives in `use-workout-session.ts` (tested
 * via its own component-level tests, mocking the actions module).
 */

const session: WorkoutSessionRecord = {
  id: "session-1",
  workoutPlanId: "plan-1",
  status: "active",
  startedAt: "2026-07-06T09:00:00.000Z",
  exercises: [],
};

function setMutation(setId: string, clientSeq: number): PendingMutation {
  return {
    kind: "set",
    sessionId: "session-1",
    setId,
    input: { completed: true },
    queuedAt: clientSeq,
    clientSeq,
  };
}

describe("classifyFlushError", () => {
  it("classifies UNREACHABLE and SERVER as retryable (never poison-dropped)", () => {
    expect(classifyFlushError("UNREACHABLE")).toBe("retry");
    expect(classifyFlushError("SERVER")).toBe("retry");
  });

  it("classifies VALIDATION and NOT_FOUND as poison (drop the entry)", () => {
    expect(classifyFlushError("VALIDATION")).toBe("drop");
    expect(classifyFlushError("NOT_FOUND")).toBe("drop");
  });

  it("classifies STALE_ACTION as its own branch, distinct from retry/drop", () => {
    expect(classifyFlushError("STALE_ACTION")).toBe("stale");
  });

  it("defaults an unknown/undefined code to retry (defensive — never silently poison-drop)", () => {
    expect(classifyFlushError(undefined)).toBe("retry");
  });
});

describe("isStaleActionError", () => {
  it("detects the Next.js stale Server Action reference error signature", () => {
    expect(isStaleActionError(new Error("Failed to find Server Action"))).toBe(true);
  });

  it("does not misclassify an ordinary error as stale", () => {
    expect(isStaleActionError(new Error("network down"))).toBe(false);
    expect(isStaleActionError("not an Error instance")).toBe(false);
  });
});

describe("runSequentialFlush", () => {
  it("awaits each ack before dispatching the next entry (strictly sequential, never Promise.all)", async () => {
    const callOrder: string[] = [];
    const mutations = [setMutation("set-1", 1), setMutation("set-2", 2)];

    await runSequentialFlush(mutations, async (mutation) => {
      const label = mutation.kind === "set" ? mutation.setId : "complete";
      callOrder.push(`start:${label}`);
      // Yield a microtask so a buggy Promise.all-based implementation would
      // interleave call order; a real sequential loop never does.
      await Promise.resolve();
      callOrder.push(`end:${label}`);
      return { kind: "ok", session };
    });

    expect(callOrder).toEqual(["start:set-1", "end:set-1", "start:set-2", "end:set-2"]);
  });

  it("clears a synced entry and continues to the next one", async () => {
    const mutations = [setMutation("set-1", 1), setMutation("set-2", 2)];

    const result = await runSequentialFlush(mutations, async () => ({
      kind: "ok",
      session,
    }));

    expect(result.synced).toHaveLength(2);
    expect(result.dropped).toEqual([]);
    expect(result.remaining).toEqual([]);
  });

  it("drops a VALIDATION failure and continues flushing subsequent entries", async () => {
    const mutations = [setMutation("set-1", 1), setMutation("set-2", 2)];

    const result = await runSequentialFlush(mutations, async (mutation) => {
      if (mutation.kind === "set" && mutation.setId === "set-1") {
        return { kind: "error", code: "VALIDATION" };
      }
      return { kind: "ok", session };
    });

    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]).toMatchObject({ setId: "set-1" });
    expect(result.synced).toHaveLength(1);
    expect(result.synced[0]).toMatchObject({ setId: "set-2" });
  });

  it("stops on a retryable failure, leaving that entry AND all subsequent entries queued (order preserved)", async () => {
    const mutations = [setMutation("set-1", 1), setMutation("set-2", 2), setMutation("set-3", 3)];
    let calls = 0;

    const result = await runSequentialFlush(mutations, async (mutation) => {
      calls += 1;
      if (mutation.kind === "set" && mutation.setId === "set-2") {
        return { kind: "error", code: "UNREACHABLE" };
      }
      return { kind: "ok", session };
    });

    expect(calls).toBe(2); // set-3 must never be attempted after set-2 fails.
    expect(result.synced).toHaveLength(1);
    expect(result.remaining.map((m) => (m.kind === "set" ? m.setId : "complete"))).toEqual([
      "set-2",
      "set-3",
    ]);
  });

  it("reports the haltCode that stopped the sequence (AUTH) so the caller can surface a session-expired notice", async () => {
    const mutations = [setMutation("set-1", 1), setMutation("set-2", 2)];

    const result = await runSequentialFlush(mutations, async (mutation) => {
      if (mutation.kind === "set" && mutation.setId === "set-1") {
        return { kind: "error", code: "AUTH" };
      }
      return { kind: "ok", session };
    });

    expect(result.haltCode).toBe("AUTH");
    expect(result.dropped).toEqual([]);
    expect(result.remaining.map((m) => (m.kind === "set" ? m.setId : "complete"))).toEqual([
      "set-1",
      "set-2",
    ]);
  });

  it("does not set haltCode when every entry synced or was poison-dropped", async () => {
    const mutations = [setMutation("set-1", 1), setMutation("set-2", 2)];

    const result = await runSequentialFlush(mutations, async (mutation) => {
      if (mutation.kind === "set" && mutation.setId === "set-1") {
        return { kind: "error", code: "VALIDATION" };
      }
      return { kind: "ok", session };
    });

    expect(result.haltCode).toBeUndefined();
  });

  it("on a stale-action detection, keeps the entry AND all subsequent entries queued and reports staleActionDetected", async () => {
    const mutations = [setMutation("set-1", 1), setMutation("set-2", 2)];

    const result = await runSequentialFlush(mutations, async (mutation) => {
      if (mutation.kind === "set" && mutation.setId === "set-1") {
        return { kind: "stale" };
      }
      return { kind: "ok", session };
    });

    expect(result.staleActionDetected).toBe(true);
    expect(result.remaining).toHaveLength(2);
    expect(result.synced).toEqual([]);
  });
});
