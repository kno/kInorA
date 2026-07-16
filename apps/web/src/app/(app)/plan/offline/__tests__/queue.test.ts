import { describe, it, expect, beforeEach } from "vitest";
import type { PendingMutation } from "@kinora/contracts";
import { createInMemoryOfflineStore } from "../__test-utils__/in-memory-store";
import {
  enqueueMutation,
  getQueuedMutations,
  removeMutation,
  nextClientSeq,
} from "../queue";

/**
 * Pure queue logic (Phase 4 web offline) — tested against an in-memory fake
 * `OfflineStore` so no idb/browser mocking is needed here (Mock Hygiene:
 * extract-before-mock). The real idb-backed `OfflineStore` adapter is
 * exercised separately in `db.test.ts`.
 */

const IDENTITY_A = "tenant-1:user-1";
const IDENTITY_B = "tenant-2:user-2";

describe("enqueueMutation / getQueuedMutations / removeMutation", () => {
  let store: ReturnType<typeof createInMemoryOfflineStore>;

  beforeEach(() => {
    store = createInMemoryOfflineStore();
  });

  it("persists a monotonically-increasing clientSeq across restart (never resets to 0)", async () => {
    const first = await enqueueMutation(store, IDENTITY_A, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });
    const second = await enqueueMutation(store, IDENTITY_A, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-2",
      input: { completed: false },
      queuedAt: 2,
    });

    expect(first.clientSeq).toBe(1);
    expect(second.clientSeq).toBe(2);

    // Simulate an app restart: a fresh queue read against the SAME store must
    // continue from the persisted high-water-mark, not reset to 0.
    const third = await enqueueMutation(store, IDENTITY_A, {
      kind: "complete",
      sessionId: "session-1",
      queuedAt: 3,
    });
    expect(third.clientSeq).toBe(3);
  });

  it("returns only the mutations queued under the given identity (scoped namespace)", async () => {
    await enqueueMutation(store, IDENTITY_A, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });
    await enqueueMutation(store, IDENTITY_B, {
      kind: "set",
      sessionId: "session-9",
      setId: "set-9",
      input: { completed: true },
      queuedAt: 1,
    });

    const queuedForA = await getQueuedMutations(store, IDENTITY_A);
    const queuedForB = await getQueuedMutations(store, IDENTITY_B);

    expect(queuedForA).toHaveLength(1);
    expect(queuedForA[0]).toMatchObject({ sessionId: "session-1", setId: "set-1" });
    expect(queuedForB).toHaveLength(1);
    expect(queuedForB[0]).toMatchObject({ sessionId: "session-9", setId: "set-9" });
  });

  it("allocates DISTINCT clientSeq values when two allocations race (atomic read-modify-write, no clobber)", async () => {
    // Two "tabs"/instances of the SAME identity racing nextClientSeq without
    // awaiting between them. Before the atomic fix, both read the same
    // high-water-mark before either writes, so they collide on the same
    // next value and one mutation silently overwrites the other at
    // `${identityKey}:${seq}`.
    const [a, b] = await Promise.all([
      nextClientSeq(store, IDENTITY_A),
      nextClientSeq(store, IDENTITY_A),
    ]);

    expect(a).not.toBe(b);
    expect(new Set([a, b]).size).toBe(2);
  });

  it("never clobbers a concurrently-enqueued mutation under the same identity", async () => {
    const [first, second] = await Promise.all([
      enqueueMutation(store, IDENTITY_A, {
        kind: "set",
        sessionId: "session-1",
        setId: "set-1",
        input: { completed: true },
        queuedAt: 1,
      }),
      enqueueMutation(store, IDENTITY_A, {
        kind: "set",
        sessionId: "session-1",
        setId: "set-2",
        input: { completed: true },
        queuedAt: 2,
      }),
    ]);

    expect(first.clientSeq).not.toBe(second.clientSeq);
    const queued = await getQueuedMutations(store, IDENTITY_A);
    expect(queued).toHaveLength(2);
  });

  it("removes a mutation by clientSeq so it does not resurface after ack", async () => {
    const mutation = await enqueueMutation(store, IDENTITY_A, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    await removeMutation(store, IDENTITY_A, mutation.clientSeq);

    const remaining = await getQueuedMutations(store, IDENTITY_A);
    expect(remaining).toEqual([]);
  });
});
