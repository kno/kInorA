// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { createInMemoryOfflineStore } from "../offline/__test-utils__/in-memory-store";
import {
  enqueueMutation,
  getQueuedMutations,
  removeMutation,
  writeSnapshot,
  readSnapshot,
  readActiveSessionPointer,
  writeActiveSessionPointer,
} from "../offline";
import { WorkoutSessionActionError } from "../[id]/action-errors";
import type { OfflineStore, OfflineStoreName } from "../offline/store";

/**
 * `useWorkoutSession` offline integration (Phase 4 web offline — 09b-v1).
 *
 * Offline deps (identity key resolver, store, connectivity monitor) are
 * injected via `UseWorkoutSessionOptions.offline` — mirroring the existing
 * `usePlanWs` hook's `WebSocketImpl` injection pattern — so these tests
 * exercise the REAL hook logic against a fake in-memory store, with only the
 * Server Actions module mocked (Mock Hygiene: 2 mocks total per test).
 */

const recordWorkoutSetAction = vi.fn();
const completeWorkoutSessionAction = vi.fn();
const startWorkoutSessionAction = vi.fn();

vi.mock("../[id]/actions", () => ({
  recordWorkoutSetAction: (...args: unknown[]) => recordWorkoutSetAction(...args),
  completeWorkoutSessionAction: (...args: unknown[]) => completeWorkoutSessionAction(...args),
  startWorkoutSessionAction: (...args: unknown[]) => startWorkoutSessionAction(...args),
  getOfflineIdentityKeyAction: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const IDENTITY = "identity-a";

const activeSession: WorkoutSessionRecord = {
  id: "session-1",
  workoutPlanId: "plan-1",
  status: "active",
  startedAt: "2026-07-06T09:00:00.000Z",
  day: 1,
  exercises: [
    {
      id: "exercise-1",
      workoutSessionId: "session-1",
      exerciseIndex: 0,
      title: "Barbell Squat",
      restSeconds: 120,
      setRecords: [
        { id: "set-1", sessionExerciseId: "exercise-1", setIndex: 0, targetReps: "8", completed: false },
      ],
    },
  ],
};

function fakeConnectivityMonitor(initialOnline: boolean) {
  let online = initialOnline;
  const listeners = new Set<(online: boolean) => void>();
  return {
    monitor: {
      isOnline: () => online,
      subscribe(cb: (online: boolean) => void) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    setOnline(next: boolean) {
      online = next;
      listeners.forEach((cb) => cb(next));
    },
  };
}

async function loadHook(
  store: ReturnType<typeof createInMemoryOfflineStore>,
  online = true,
  getIdentityKey: () => Promise<string | undefined> = async () => IDENTITY,
) {
  const { monitor, setOnline } = fakeConnectivityMonitor(online);
  const { useWorkoutSession } = await import("../use-workout-session");
  const rendered = renderHook(() =>
    useWorkoutSession({
      offline: {
        getIdentityKey,
        openStore: async () => store,
        createConnectivityMonitor: () => monitor,
      },
    }),
  );
  return { ...rendered, setOnline };
}

describe("useWorkoutSession — offline queue (enqueue-before-snapshot)", () => {
  it("durably enqueues a set mutation BEFORE writing the session snapshot, while offline", async () => {
    const orderedStore = createInMemoryOfflineStore();
    // Simulate an in-progress session (as if started while online earlier),
    // BEFORE the hook mounts, so mount hydration picks it up.
    await writeSnapshot(orderedStore, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(orderedStore, IDENTITY, "session-1");

    const events: string[] = [];
    const originalPut = orderedStore.put.bind(orderedStore);
    orderedStore.put = (async (storeName: string, key: string, value: unknown) => {
      if (storeName === "mutations") events.push("enqueue");
      if (storeName === "snapshots") events.push("snapshot");
      return originalPut(storeName as never, key, value);
    }) as typeof orderedStore.put;

    const { result } = await loadHook(orderedStore, false);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));
    events.length = 0; // Only care about ordering from the recordSet call forward.

    await act(async () => {
      await result.current.handleRecordSet("set-1", {
        completed: true,
        actualReps: 8,
      });
    });

    expect(events[0]).toBe("enqueue");
    expect(events).toContain("snapshot");
    expect(events.indexOf("enqueue")).toBeLessThan(events.indexOf("snapshot"));
  });
});

describe("useWorkoutSession — offline reload hydration", () => {
  it("hydrates activeSession from the cached snapshot + queued mutations on mount, without a network call", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true, actualReps: 9 },
      queuedAt: 1,
    });

    const { result } = await loadHook(store, false);

    await waitFor(() => {
      expect(result.current.activeSession?.id).toBe("session-1");
    });
    expect(result.current.activeSession?.exercises[0]?.setRecords[0]).toMatchObject({
      completed: true,
      actualReps: 9,
    });
    expect(recordWorkoutSetAction).not.toHaveBeenCalled();
    expect(completeWorkoutSessionAction).not.toHaveBeenCalled();
  });

  it("does not let late hydration overwrite a session started while hydration was pending", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");

    let releaseHydration!: () => void;
    const hydrationBlocked = new Promise<void>((resolve) => {
      releaseHydration = resolve;
    });
    const originalEntries = store.entries.bind(store);
    const delayedStore: OfflineStore = {
      ...store,
      entries: (async (storeName: OfflineStoreName) => {
        if (storeName === "mutations") await hydrationBlocked;
        return originalEntries(storeName);
      }) as typeof store.entries,
    };
    const startedSession: WorkoutSessionRecord = {
      ...activeSession,
      id: "session-started",
      day: 2,
    };
    startWorkoutSessionAction.mockResolvedValue({ kind: "started", session: startedSession });

    const { result } = await loadHook(delayedStore, false);
    await waitFor(() => expect(startWorkoutSessionAction).not.toHaveBeenCalled());

    await act(async () => {
      await result.current.handleStartWorkout("plan-1", 2);
    });
    expect(result.current.activeSession?.id).toBe("session-started");

    releaseHydration();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.activeSession?.id).toBe("session-started");
    expect(result.current.activeDay).toBe(2);
  });
});

describe("useWorkoutSession — sequential flush on reconnect", () => {
  it("flushes queued mutations sequentially through the existing actions and clears them on ack", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true, actualReps: 9 },
      queuedAt: 1,
    });

    recordWorkoutSetAction.mockResolvedValue({
      ...activeSession,
      exercises: [
        {
          ...activeSession.exercises[0]!,
          setRecords: [{ ...activeSession.exercises[0]!.setRecords[0]!, completed: true, actualReps: 9 }],
        },
      ],
    });

    const { result, setOnline } = await loadHook(store, false);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      setOnline(true);
    });

    await waitFor(async () => {
      expect(await getQueuedMutations(store, IDENTITY)).toEqual([]);
    });
    expect(recordWorkoutSetAction).toHaveBeenCalledWith("session-1", "set-1", {
      completed: true,
      actualReps: 9,
    });
  });

  it("keeps a stale-action-reference entry queued and surfaces a reload prompt", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    recordWorkoutSetAction.mockRejectedValue(new Error("Failed to find Server Action"));

    const { result, setOnline } = await loadHook(store, false);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      setOnline(true);
    });

    await waitFor(() => {
      expect(result.current.syncNotice).toBe("reload_required");
    });
    expect(await getQueuedMutations(store, IDENTITY)).toHaveLength(1);
  });

  it("drops a VALIDATION failure (poison message) and surfaces the error, without retrying it", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    recordWorkoutSetAction.mockRejectedValue(
      new WorkoutSessionActionError("invalid_input", "VALIDATION"),
    );

    const { result, setOnline } = await loadHook(store, false);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      setOnline(true);
    });

    await waitFor(async () => {
      expect(await getQueuedMutations(store, IDENTITY)).toEqual([]);
    });
    // Judgment Day fix #3: a poison-drop MUST surface to the user, not just
    // silently empty the queue.
    await waitFor(() => {
      expect(result.current.syncNotice).toBe("dropped");
    });
  });

  it("keeps the queue and surfaces an auth notice on a 401/403 AUTH failure (never poison-dropped)", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    recordWorkoutSetAction.mockRejectedValue(
      new WorkoutSessionActionError("unauthorized", "AUTH"),
    );

    const { result, setOnline } = await loadHook(store, false);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      setOnline(true);
    });

    await waitFor(() => {
      expect(result.current.syncNotice).toBe("auth_required");
    });
    expect(await getQueuedMutations(store, IDENTITY)).toHaveLength(1);
  });
});

describe("useWorkoutSession — flush reentrancy guard (Judgment Day fix #1)", () => {
  it("never runs two flush passes concurrently — a flush triggered while one is in-flight is queued, not started immediately", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");

    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];
    recordWorkoutSetAction.mockImplementation(() => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => {
        resolvers.push(() => {
          inFlight -= 1;
          resolve({
            ...activeSession,
            exercises: [
              {
                ...activeSession.exercises[0]!,
                setRecords: [
                  { ...activeSession.exercises[0]!.setRecords[0]!, completed: true },
                ],
              },
            ],
          });
        });
      });
    });

    const { result } = await loadHook(store, true);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    // Two overlapping triggers of the SAME shared `flush` (both handleRecordSet
    // and the connectivity subscriber invoke it) while the first network call
    // is still in flight (deferred above).
    await act(async () => {
      await result.current.handleRecordSet("set-1", { completed: true });
    });
    await act(async () => {
      await result.current.handleRecordSet("set-1", { completed: true, actualReps: 5 });
    });

    resolvers.forEach((resolve) => resolve());
    await waitFor(() => expect(inFlight).toBe(0));

    expect(maxInFlight).toBe(1);
  });
});

describe("useWorkoutSession — re-verify identity before flush (Judgment Day fix #6)", () => {
  it("aborts a flush pass if the current identity no longer matches the store's bound identity (account switch)", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    // First call (during mount) resolves the original identity; every
    // subsequent call (from the flush re-verify guard) resolves a DIFFERENT
    // identity, simulating an account switch on a long-lived mounted
    // instance.
    let calls = 0;
    const getIdentityKey = async () => {
      calls += 1;
      return calls === 1 ? IDENTITY : "identity-b-different-account";
    };

    recordWorkoutSetAction.mockResolvedValue(activeSession);

    const { result, setOnline } = await loadHook(store, false, getIdentityKey);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      setOnline(true);
      await Promise.resolve();
    });

    // The mismatched-identity flush must never dispatch the Server Action —
    // flushing under a stale/mismatched ambient session would be wrong.
    expect(recordWorkoutSetAction).not.toHaveBeenCalled();
    // And the original identity's queued mutation must NOT be dropped —
    // it stays queued for when its OWN identity's flush runs again.
    expect(await getQueuedMutations(store, IDENTITY)).toHaveLength(1);
  });

  it("rejects a handler mutation after an account switch instead of using the mounted queue identity", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");

    let calls = 0;
    const getIdentityKey = async () => {
      calls += 1;
      return calls === 1 ? IDENTITY : "identity-b-different-account";
    };

    const { result } = await loadHook(store, false, getIdentityKey);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      await result.current.handleRecordSet("set-1", { completed: true });
    });

    expect(await getQueuedMutations(store, IDENTITY)).toEqual([]);
    expect(recordWorkoutSetAction).not.toHaveBeenCalled();
    expect(result.current.syncNotice).toBe("auth_required");
  });

  it("rejects a complete mutation after an account switch before enqueueing", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");

    let calls = 0;
    const getIdentityKey = async () => {
      calls += 1;
      return calls === 1 ? IDENTITY : "identity-b-different-account";
    };

    const { result } = await loadHook(store, false, getIdentityKey);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      await result.current.handleCompleteWorkout("session-1");
    });

    expect(await getQueuedMutations(store, IDENTITY)).toEqual([]);
    expect(completeWorkoutSessionAction).not.toHaveBeenCalled();
    expect(result.current.syncNotice).toBe("auth_required");
  });

  it("keeps an offline mutation queued when identity revalidation is unreachable", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");

    let calls = 0;
    const getIdentityKey = async () => {
      calls += 1;
      if (calls === 1) return IDENTITY;
      return undefined;
    };

    const { result } = await loadHook(store, false, getIdentityKey);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      await result.current.handleRecordSet("set-1", { completed: true });
    });

    expect(await getQueuedMutations(store, IDENTITY)).toHaveLength(1);
    expect(recordWorkoutSetAction).not.toHaveBeenCalled();
    expect(result.current.syncNotice).not.toBe("auth_required");
  });

  it("rejects a direct start mutation after an account switch", async () => {
    const store = createInMemoryOfflineStore();
    let calls = 0;
    const getIdentityKey = async () => {
      calls += 1;
      return calls === 1 ? IDENTITY : "identity-b-different-account";
    };

    const { result } = await loadHook(store, true, getIdentityKey);
    await waitFor(() => expect(calls).toBe(1));

    await act(async () => {
      await result.current.handleStartWorkout("plan-1", 1);
    });

    expect(startWorkoutSessionAction).not.toHaveBeenCalled();
    expect(result.current.syncNotice).toBe("auth_required");
  });
});

describe("useWorkoutSession — collapsed flush acknowledgements", () => {
  it("removes every raw mutation represented by a collapsed acknowledgement", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true, actualReps: 7 },
      queuedAt: 1,
    });
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true, actualReps: 9 },
      queuedAt: 2,
    });
    recordWorkoutSetAction.mockResolvedValue(activeSession);

    const { result, setOnline } = await loadHook(store, false);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      setOnline(true);
    });

    await waitFor(async () => {
      expect(await getQueuedMutations(store, IDENTITY)).toEqual([]);
    });
    expect(recordWorkoutSetAction).toHaveBeenCalledTimes(1);
    expect(recordWorkoutSetAction).toHaveBeenCalledWith("session-1", "set-1", {
      completed: true,
      actualReps: 9,
    });
  });
});

describe("useWorkoutSession — enqueue persistence failures", () => {
  it("does not direct-dispatch after enqueue succeeds but snapshot persistence fails", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    const flaky: OfflineStore = {
      ...store,
      put: (async (storeName: OfflineStoreName, key: string, value: unknown) => {
        if (storeName === "snapshots") throw new Error("simulated storage failure");
        return store.put(storeName, key, value);
      }) as typeof store.put,
    };

    const { result } = await loadHook(flaky, false);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      await result.current.handleRecordSet("set-1", { completed: true, actualReps: 8 });
    });

    expect(await getQueuedMutations(store, IDENTITY)).toHaveLength(1);
    expect(recordWorkoutSetAction).not.toHaveBeenCalled();
    expect(result.current.syncNotice).toBe("reload_required");
  });
});

describe("useWorkoutSession — Judgment Day Round-2 fix #1 (no unhandled rejection on offline flush)", () => {
  it("does not recheck identity from the flush while offline, and keeps a handler write when revalidation is unreachable", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    let calls = 0;
    const getIdentityKey = async () => {
      calls += 1;
      if (calls <= 2) return IDENTITY;
      // Any call beyond the mount-time resolution simulates a network failure
      // during identity validation or a flush-triggered identity recheck.
      throw new Error("Failed to fetch");
    };

    try {
      const { result } = await loadHook(store, false, getIdentityKey);
      await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

      await act(async () => {
        await result.current.handleRecordSet("set-1", { completed: true, actualReps: 8 });
        // Flush the microtask queue so a `void flush()` unhandled rejection
        // (if the gate were missing) would have already surfaced.
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(calls).toBe(2);
       expect(recordWorkoutSetAction).not.toHaveBeenCalled();
       expect(completeWorkoutSessionAction).not.toHaveBeenCalled();
       expect(await getQueuedMutations(store, IDENTITY)).toHaveLength(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("aborts a flush pass without an unhandled rejection when the identity recheck itself rejects", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    let calls = 0;
    const getIdentityKey = async () => {
      calls += 1;
      if (calls === 1) return IDENTITY;
      // The recheck rejects even though the device reports online — a
      // transient failure (not a confirmed different identity), which must
      // be treated as retryable, not as an account switch.
      throw new Error("Failed to fetch");
    };

    try {
      const { result, setOnline } = await loadHook(store, false, getIdentityKey);
      await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

      await act(async () => {
        setOnline(true);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(recordWorkoutSetAction).not.toHaveBeenCalled();
      expect(await getQueuedMutations(store, IDENTITY)).toHaveLength(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});

describe("useWorkoutSession — Judgment Day Round-2 fix #3 (sticky notice self-clears on empty queue)", () => {
  it("clears an auth_required notice once a clean flush pass finds the queue empty", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    recordWorkoutSetAction.mockRejectedValueOnce(
      new WorkoutSessionActionError("unauthorized", "AUTH"),
    );

    const { result, setOnline } = await loadHook(store, false);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      setOnline(true);
    });
    await waitFor(() => expect(result.current.syncNotice).toBe("auth_required"));

    // Drain the queue out-of-band (e.g. resolved via another tab) so the
    // NEXT flush pass genuinely starts with an empty queue — exercising the
    // early-return branch itself, not a coincidental success-path clear.
    const stillQueued = await getQueuedMutations(store, IDENTITY);
    for (const mutation of stillQueued) {
      await removeMutation(store, IDENTITY, mutation.clientSeq);
    }
    expect(await getQueuedMutations(store, IDENTITY)).toEqual([]);

    await act(async () => {
      setOnline(false);
      setOnline(true);
    });

    await waitFor(() => expect(result.current.syncNotice).toBeUndefined());
  });

  it("keeps a dropped notice sticky across a subsequent clean empty-queue pass", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    recordWorkoutSetAction.mockRejectedValue(
      new WorkoutSessionActionError("invalid_input", "VALIDATION"),
    );

    const { result, setOnline } = await loadHook(store, false);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      setOnline(true);
    });
    await waitFor(() => expect(result.current.syncNotice).toBe("dropped"));
    await waitFor(async () => {
      expect(await getQueuedMutations(store, IDENTITY)).toEqual([]);
    });

    // A later trigger runs another (now empty-queue) flush pass — the
    // "dropped" notice must remain sticky (permanent data loss stays
    // visible), unlike the transient auth/reload notices above.
    await act(async () => {
      setOnline(false);
      setOnline(true);
    });

    await waitFor(() => expect(result.current.syncNotice).toBe("dropped"));
  });
});

describe("useWorkoutSession — complete-mutation optimistic semantics", () => {
  it("flips the cached snapshot's session.status to completed as soon as complete is enqueued (before ack)", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");

    const { result } = await loadHook(store, false);
    await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

    await act(async () => {
      await result.current.handleCompleteWorkout("session-1");
    });

    const snapshot = await readSnapshot(store, IDENTITY, "session-1");
    expect(snapshot?.session.status).toBe("completed");
  });
});

/**
 * Storage I/O failure resilience (09d-v1-offline-flush-hardening).
 *
 * The web `flush()` wrapper invokes `runFlushPass` fire-and-forget. An
 * unguarded store I/O throw (entries/delete/put during a flush pass)
 * would surface as an unhandled promise rejection on the mainline
 * offline write path. These four regression tests inject a flaky store
 * built by spreading the real in-memory store and overriding ONE method
 * per boundary (R1–R4), then assert (a) zero unhandled rejections across
 * `void flush()` and (b) the queue state matches the operation-ordering
 * invariant from the delta spec. Each test reads the REAL store for
 * post-conditions so the flaky override does not mask the assertion.
 */
function trackUnhandledRejections(): { rejects: unknown[]; stop: () => void } {
  const rejects: unknown[] = [];
  const handler = (reason: unknown) => rejects.push(reason);
  process.on("unhandledRejection", handler);
  return { rejects, stop: () => process.off("unhandledRejection", handler) };
}

describe("useWorkoutSession — storage I/O failure resilience (09d-v1)", () => {
  it("R1: entries() throw mid-flush → queue intact, zero unhandled rejections", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true, actualReps: 9 },
      queuedAt: 1,
    });

    // Mount hydration also reads `entries("mutations")`; let the FIRST call
    // (mount) succeed so the hook hydrates, then throw on every flush-
    // triggered read (transient IndexedDB failure post-mount).
    let entriesCalls = 0;
    const flaky: OfflineStore = {
      ...store,
      entries: (async (storeName: OfflineStoreName) => {
        entriesCalls += 1;
        if (entriesCalls > 1) throw new Error("simulated storage failure");
        return store.entries(storeName);
      }) as typeof store.entries,
    };

    const { rejects, stop } = trackUnhandledRejections();
    try {
      const { result, setOnline } = await loadHook(flaky, false);
      await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

      await act(async () => {
        setOnline(true);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // A pass that threw at entries() never touched the queue → intact.
      expect(await getQueuedMutations(store, IDENTITY)).toHaveLength(1);
      expect(rejects).toEqual([]);
    } finally {
      stop();
    }
  });

  it("R2: delete('mutations') throw post-ack → not-removed mutation stays queued, zero unhandled rejections", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true, actualReps: 9 },
      queuedAt: 1,
    });

    recordWorkoutSetAction.mockResolvedValue({
      ...activeSession,
      exercises: [
        {
          ...activeSession.exercises[0]!,
          setRecords: [{ ...activeSession.exercises[0]!.setRecords[0]!, completed: true, actualReps: 9 }],
        },
      ],
    });

    // Throw only on the post-ack removal delete; non-targeted deletes intact.
    const flaky: OfflineStore = {
      ...store,
      delete: (async (storeName: OfflineStoreName, key: string) => {
        if (storeName === "mutations") throw new Error("simulated storage failure");
        return store.delete(storeName, key);
      }) as typeof store.delete,
    };

    const { rejects, stop } = trackUnhandledRejections();
    try {
      const { result, setOnline } = await loadHook(flaky, false);
      await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

      await act(async () => {
        setOnline(true);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // removeMutation threw before the delete completed → mutation stays
      // queued and MAY retry on a later valid trigger.
      expect(await getQueuedMutations(store, IDENTITY)).toHaveLength(1);
      expect(rejects).toEqual([]);
    } finally {
      stop();
    }
  });

  it("R3: put('snapshots') throw post-removal → queue empty, snapshot stale, NOT retryable, zero unhandled rejections", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true, actualReps: 9 },
      queuedAt: 1,
    });

    const ackedSession: WorkoutSessionRecord = {
      ...activeSession,
      exercises: [
        {
          ...activeSession.exercises[0]!,
          setRecords: [{ ...activeSession.exercises[0]!.setRecords[0]!, completed: true, actualReps: 9 }],
        },
      ],
    };
    recordWorkoutSetAction.mockResolvedValue(ackedSession);

    // Throw only on the post-removal snapshot write; enqueue's put and
    // removeMutation's delete still work so the mutation IS removed first.
    const flaky: OfflineStore = {
      ...store,
      put: (async (storeName: OfflineStoreName, key: string, value: unknown) => {
        if (storeName === "snapshots") throw new Error("simulated storage failure");
        return store.put(storeName, key, value);
      }) as typeof store.put,
    };

    const { rejects, stop } = trackUnhandledRejections();
    try {
      const { result, setOnline } = await loadHook(flaky, false);
      await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

      await act(async () => {
        setOnline(true);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Mutations already removed before writeSnapshot threw → queue empty,
      // acknowledged mutation NOT retryable.
      expect(await getQueuedMutations(store, IDENTITY)).toEqual([]);
      // Snapshot write failed → cached snapshot is STALE (still the
      // pre-ack session, not the acked one with actualReps: 9).
      const snapshot = await readSnapshot(store, IDENTITY, "session-1");
      expect(snapshot?.session.exercises[0]?.setRecords[0]?.actualReps).toBeUndefined();
      expect(rejects).toEqual([]);
    } finally {
      stop();
    }
  });

  it("R4: cleanup delete('snapshots') throw → queue empty, pointer stale, NOT retryable, zero unhandled rejections", async () => {
    const store = createInMemoryOfflineStore();
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);
    await writeActiveSessionPointer(store, IDENTITY, "session-1");
    await enqueueMutation(store, IDENTITY, {
      kind: "complete",
      sessionId: "session-1",
      queuedAt: 1,
    });

    const completedSession: WorkoutSessionRecord = { ...activeSession, status: "completed" };
    completeWorkoutSessionAction.mockResolvedValue(completedSession);

    // Throw only on the post-removal+snapshot cleanup delete("snapshots");
    // removeMutation's delete("mutations") succeeds so the mutation IS
    // removed first.
    const flaky: OfflineStore = {
      ...store,
      delete: (async (storeName: OfflineStoreName, key: string) => {
        if (storeName === "snapshots") throw new Error("simulated storage failure");
        return store.delete(storeName, key);
      }) as typeof store.delete,
    };

    const { rejects, stop } = trackUnhandledRejections();
    try {
      const { result, setOnline } = await loadHook(flaky, false);
      await waitFor(() => expect(result.current.activeSession?.id).toBe("session-1"));

      await act(async () => {
        setOnline(true);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Mutation removed + snapshot written before clearSnapshot threw →
      // queue empty, acknowledged mutation NOT retryable, cleanup pointer
      // STALE (clearActiveSessionPointer never ran).
      expect(await getQueuedMutations(store, IDENTITY)).toEqual([]);
      const pointer = await readActiveSessionPointer(store, IDENTITY);
      expect(pointer).toBe("session-1");
      expect(rejects).toEqual([]);
    } finally {
      stop();
    }
  });
});
