import { describe, expect, it } from "vitest";
import type { PendingMutation } from "@kinora/contracts";
import { collapseQueue } from "../collapse-queue.js";

function setMutation(
  setId: string,
  clientSeq: number,
  overrides: Partial<PendingMutation & { kind: "set" }> = {},
): PendingMutation {
  return {
    kind: "set",
    sessionId: "session-1",
    setId,
    input: { completed: true },
    queuedAt: clientSeq,
    clientSeq,
    ...overrides,
  };
}

function completeMutation(
  clientSeq: number,
  queuedAt = clientSeq,
  sessionId = "session-1",
): PendingMutation {
  return { kind: "complete", sessionId, queuedAt, clientSeq };
}

describe("collapseQueue (09b-v1 offline domain)", () => {
  it("returns an empty array for an empty queue", () => {
    expect(collapseQueue([])).toEqual([]);
  });

  it("keeps a single mutation unchanged", () => {
    const mutation = setMutation("set-1", 1);
    expect(collapseQueue([mutation])).toEqual([mutation]);
  });

  it("keeps only the latest entry per setId, keyed by clientSeq (not queuedAt)", () => {
    const older = setMutation("set-1", 1, { input: { completed: false } });
    // Higher clientSeq wins even if queuedAt would suggest otherwise (clock skew).
    const newer = setMutation("set-1", 5, { queuedAt: 0, input: { completed: true } });

    const result = collapseQueue([older, newer]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(newer);
  });

  it("preserves distinct setIds as separate entries", () => {
    const a = setMutation("set-1", 1);
    const b = setMutation("set-2", 2);

    const result = collapseQueue([a, b]);

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([a, b]));
  });

  it("orders a queued 'complete' mutation last, regardless of clientSeq relative to sets queued after it", () => {
    const complete = completeMutation(2);
    const setAfterComplete = setMutation("set-1", 3);

    const result = collapseQueue([complete, setAfterComplete]);

    expect(result.map((m) => m.kind)).toEqual(["set", "complete"]);
    expect(result[result.length - 1]).toEqual(complete);
  });

  it("orders set mutations by ascending clientSeq before the trailing complete", () => {
    const setB = setMutation("set-2", 3);
    const setA = setMutation("set-1", 1);
    const complete = completeMutation(2);

    const result = collapseQueue([setB, complete, setA]);

    expect(result).toEqual([setA, setB, complete]);
  });

  it("keeps the latest complete for every session and orders all completes deterministically after sets", () => {
    const setA = setMutation("set-1", 1, { sessionId: "session-1" });
    const setB = setMutation("set-2", 3, { sessionId: "session-2" });
    const completeA = completeMutation(2, 2, "session-1");
    const completeB = completeMutation(4, 4, "session-2");
    const newerCompleteA = completeMutation(5, 5, "session-1");

    const result = collapseQueue([completeB, setB, completeA, setA, newerCompleteA]);

    expect(result).toEqual([setA, setB, completeB, newerCompleteA]);
  });

  it("uses clientSeq for last-write-wins when a session has multiple completes", () => {
    const older = completeMutation(2, 0, "session-1");
    const newer = completeMutation(7, 100, "session-1");

    expect(collapseQueue([newer, older])).toEqual([newer]);
  });
});
