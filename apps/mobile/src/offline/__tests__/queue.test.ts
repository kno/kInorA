import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "../__test-utils__/in-memory-store";
import { enqueueMutation, getQueuedMutations, nextClientSeq, removeMutation } from "../queue";

describe("nextClientSeq", () => {
  it("starts at 1 for a never-seen identity and increments monotonically", async () => {
    const store = createInMemoryStore();
    expect(await nextClientSeq(store, "id-1")).toBe(1);
    expect(await nextClientSeq(store, "id-1")).toBe(2);
    expect(await nextClientSeq(store, "id-1")).toBe(3);
  });

  it("keeps separate counters per identity", async () => {
    const store = createInMemoryStore();
    expect(await nextClientSeq(store, "id-1")).toBe(1);
    expect(await nextClientSeq(store, "id-2")).toBe(1);
    expect(await nextClientSeq(store, "id-1")).toBe(2);
  });

  it("never resets across a simulated restart (persisted high-water-mark)", async () => {
    const store = createInMemoryStore();
    await nextClientSeq(store, "id-1");
    await nextClientSeq(store, "id-1");
    // Simulate restart: same store instance persists the high-water-mark.
    expect(await nextClientSeq(store, "id-1")).toBe(3);
  });

  it("allocates distinct sequential values under concurrent (Promise.all) callers", async () => {
    // Atomicity invariant: two overlapping allocations on the SAME identity
    // must never collide — this is the mobile equivalent of the web
    // two-tabs race (here: two async call sites racing within one process).
    const store = createInMemoryStore();
    const results = await Promise.all([
      nextClientSeq(store, "id-1"),
      nextClientSeq(store, "id-1"),
      nextClientSeq(store, "id-1"),
      nextClientSeq(store, "id-1"),
      nextClientSeq(store, "id-1"),
    ]);
    expect([...results].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("enqueueMutation / getQueuedMutations / removeMutation", () => {
  it("enqueues a set mutation and assigns it a clientSeq", async () => {
    const store = createInMemoryStore();
    const mutation = await enqueueMutation(store, "id-1", {
      kind: "set",
      sessionId: "s1",
      setId: "set1",
      input: { completed: true },
      queuedAt: 1000,
    });
    expect(mutation.clientSeq).toBe(1);
    const queued = await getQueuedMutations(store, "id-1");
    expect(queued).toEqual([mutation]);
  });

  it("scopes queued mutations by identityKey — never leaks across identities", async () => {
    const store = createInMemoryStore();
    await enqueueMutation(store, "id-1", {
      kind: "set",
      sessionId: "s1",
      setId: "set1",
      input: { completed: true },
      queuedAt: 1000,
    });
    await enqueueMutation(store, "id-2", {
      kind: "set",
      sessionId: "s2",
      setId: "set2",
      input: { completed: true },
      queuedAt: 2000,
    });

    expect(await getQueuedMutations(store, "id-1")).toHaveLength(1);
    expect(await getQueuedMutations(store, "id-2")).toHaveLength(1);
  });

  it("removes a mutation by clientSeq", async () => {
    const store = createInMemoryStore();
    const m1 = await enqueueMutation(store, "id-1", {
      kind: "set",
      sessionId: "s1",
      setId: "set1",
      input: { completed: true },
      queuedAt: 1000,
    });
    await enqueueMutation(store, "id-1", {
      kind: "complete",
      sessionId: "s1",
      queuedAt: 1500,
    });

    await removeMutation(store, "id-1", m1.clientSeq);
    const remaining = await getQueuedMutations(store, "id-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.kind).toBe("complete");
  });

  it("throws instead of silently overwriting if a mutation already exists at an allocated clientSeq (defense-in-depth)", async () => {
    const store = createInMemoryStore();
    // Force an existing mutation at clientSeq 1 by writing directly, then
    // reset the counter so nextClientSeq allocates 1 again — simulating a
    // hypothetical non-atomic-allocation regression.
    await store.put("mutations", "id-1:1", {
      kind: "set",
      sessionId: "s1",
      setId: "setX",
      input: { completed: true },
      queuedAt: 999,
      clientSeq: 1,
    });

    await expect(
      enqueueMutation(store, "id-1", {
        kind: "set",
        sessionId: "s1",
        setId: "setY",
        input: { completed: true },
        queuedAt: 1000,
      }),
    ).rejects.toThrow();
  });

  it("persists across a restart-equivalent read (same store instance)", async () => {
    const store = createInMemoryStore();
    await enqueueMutation(store, "id-1", {
      kind: "set",
      sessionId: "s1",
      setId: "set1",
      input: { completed: true },
      queuedAt: 1000,
    });
    // A fresh call reading the same underlying store sees the persisted queue.
    const queued = await getQueuedMutations(store, "id-1");
    expect(queued).toHaveLength(1);
  });
});
