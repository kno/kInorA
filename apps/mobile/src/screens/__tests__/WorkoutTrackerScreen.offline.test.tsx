/**
 * Phase 5 mobile offline (09b-v1) — integration tests for
 * `WorkoutTrackerScreen`'s offline mutation queue / snapshot hydration /
 * sequential flush / clear-on-logout wiring.
 *
 * Follows the SAME mocking convention as `WorkoutTrackerScreen.test.tsx`
 * (react-native/react-navigation stubbed; the REAL component tree renders).
 * Offline dependencies (store/identity/connectivity) are injected via the
 * `offline` prop — an in-memory fake `OfflineStore` + a controllable fake
 * `ConnectivityMonitor`, mirroring web's `UseWorkoutSessionOptions.offline`
 * injection pattern (Mock Hygiene Rule: no AsyncStorage/NetInfo mocking
 * needed for these tests — only the direct API client is mocked, exactly
 * like `WorkoutTrackerScreen.test.tsx` already does).
 */
import React from "react";
import { act, create } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { resolveMessages } from "../../i18n/locale.js";
import { createInMemoryStore } from "../../offline/__test-utils__/in-memory-store";
import type { ConnectivityMonitor } from "@kinora/contracts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ScrollView: "ScrollView",
  Pressable: ({ children, ...rest }: any) => (
    <button type="button" {...rest}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
  StyleSheet: { create: (styles: unknown) => styles },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));

vi.mock("react-native-svg", () => ({
  default: "Svg",
  Svg: "Svg",
  Circle: "Circle",
  G: "G",
  Line: "Line",
  Path: "Path",
  Polygon: "Polygon",
  Polyline: "Polyline",
  Rect: "Rect",
}));

const deleteSessionToken = vi.fn();
vi.mock("../../auth/session-storage.js", () => ({
  deleteSessionToken: (...args: unknown[]) => deleteSessionToken(...args),
}));

const getWorkoutSession = vi.fn();
const startWorkoutSession = vi.fn();
const recordWorkoutSet = vi.fn();
const completeWorkoutSession = vi.fn();
vi.mock("../../api/workout-session.js", () => ({
  getWorkoutSession: (...args: unknown[]) => getWorkoutSession(...args),
  startWorkoutSession: (...args: unknown[]) => startWorkoutSession(...args),
  recordWorkoutSet: (...args: unknown[]) => recordWorkoutSet(...args),
  completeWorkoutSession: (...args: unknown[]) => completeWorkoutSession(...args),
}));

const WorkoutTrackerScreen = (await import("../WorkoutTrackerScreen.js")).default;

const navigation = { goBack: vi.fn(), reset: vi.fn() } as any;

function makeSession(overrides: Partial<WorkoutSessionRecord> = {}): WorkoutSessionRecord {
  return {
    id: "s1",
    workoutPlanId: "p1",
    status: "active",
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    exercises: [
      {
        id: "ex1",
        workoutSessionId: "s1",
        exerciseIndex: 0,
        title: "Sentadilla",
        restSeconds: 90,
        setRecords: [
          { id: "set1", sessionExerciseId: "ex1", setIndex: 0, targetReps: "8", completed: false, weightKg: 40 },
          { id: "set2", sessionExerciseId: "ex1", setIndex: 1, targetReps: "8", completed: false, weightKg: 40 },
        ],
      },
    ],
    ...overrides,
  };
}

function fakeConnectivityMonitor(initialOnline: boolean): ConnectivityMonitor & {
  setOnline: (online: boolean) => void;
} {
  let online = initialOnline;
  const listeners = new Set<(online: boolean) => void>();
  return {
    isOnline: () => online,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setOnline(next: boolean) {
      online = next;
      for (const cb of listeners) cb(next);
    },
  };
}

function renderScreen(
  routeParams: Record<string, unknown>,
  offline: {
    getIdentityKey: () => Promise<string | undefined>;
    openStore: () => Promise<ReturnType<typeof createInMemoryStore>>;
    createConnectivityMonitor: () => Promise<ConnectivityMonitor>;
  },
) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <IntlProvider locale="en" defaultLocale="en" messages={resolveMessages("en")}>
        <WorkoutTrackerScreen
          navigation={navigation}
          route={{ key: "Tracker", name: "Tracker", params: routeParams } as any}
          offline={offline}
        />
      </IntlProvider>,
    );
  });
  return renderer;
}

function flattenText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((child) => flattenText(child, out));
  } else if (typeof node === "object" && "children" in (node as any)) {
    flattenText((node as any).children, out);
  }
  return out;
}

function renderedText(renderer: ReturnType<typeof create>): string {
  return flattenText(renderer.toJSON()).join("");
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkoutTrackerScreen offline wiring (Phase 5, 09b-v1)", () => {
  it("hydrates the UI from the cached snapshot + queued mutations while offline, WITHOUT any network call", async () => {
    const store = createInMemoryStore();
    const monitor = fakeConnectivityMonitor(false);
    const session = makeSession();

    // Pre-seed: identity has an active-session pointer + snapshot + one
    // still-queued mutation (as if the app had recorded a set offline
    // before being killed/restarted).
    const { writeSnapshot, writeActiveSessionPointer } = await import("../../offline/snapshot");
    const { enqueueMutation } = await import("../../offline/queue");
    await writeSnapshot(store, "id-1", "s1", session);
    await writeActiveSessionPointer(store, "id-1", "s1");
    await enqueueMutation(store, "id-1", {
      kind: "set",
      sessionId: "s1",
      setId: "set1",
      input: { completed: true, actualReps: 8, weightKg: 45 },
      queuedAt: 1000,
    });

    getWorkoutSession.mockRejectedValue(new Error("must not be called offline"));
    startWorkoutSession.mockRejectedValue(new Error("must not be called offline"));

    const renderer = renderScreen(
      { sessionId: "s1" },
      {
        getIdentityKey: async () => "id-1",
        openStore: async () => store,
        createConnectivityMonitor: async () => monitor,
      },
    );
    await flush();

    // Hydrated view reflects the queued mutation applied on top of the
    // snapshot (set1 now completed) WITHOUT any network call.
    expect(getWorkoutSession).not.toHaveBeenCalled();
    expect(startWorkoutSession).not.toHaveBeenCalled();
    expect(renderedText(renderer)).toContain("Active session");
  });

  it("flushes the queue sequentially on reconnect, applying collapseQueue LWW ordering, and clears synced entries", async () => {
    const store = createInMemoryStore();
    const monitor = fakeConnectivityMonitor(false);
    const session = makeSession();
    const { enqueueMutation, getQueuedMutations } = await import("../../offline/queue");
    const { writeSnapshot, writeActiveSessionPointer } = await import("../../offline/snapshot");

    await writeSnapshot(store, "id-1", "s1", session);
    await writeActiveSessionPointer(store, "id-1", "s1");
    await enqueueMutation(store, "id-1", {
      kind: "set",
      sessionId: "s1",
      setId: "set1",
      input: { completed: true, actualReps: 8, weightKg: 45 },
      queuedAt: 1000,
    });

    const acked = makeSession({
      exercises: [
        {
          id: "ex1",
          workoutSessionId: "s1",
          exerciseIndex: 0,
          title: "Sentadilla",
          restSeconds: 90,
          setRecords: [
            { id: "set1", sessionExerciseId: "ex1", setIndex: 0, targetReps: "8", completed: true, actualReps: 8, weightKg: 45 },
          ],
        },
      ],
    });
    recordWorkoutSet.mockResolvedValue({ kind: "ok", session: acked });

    renderScreen(
      { sessionId: "s1" },
      {
        getIdentityKey: async () => "id-1",
        openStore: async () => store,
        createConnectivityMonitor: async () => monitor,
      },
    );
    await flush();

    // Reconnect — flush should fire exactly once, sequentially.
    await act(async () => {
      monitor.setOnline(true);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(recordWorkoutSet).toHaveBeenCalledTimes(1);
    expect(recordWorkoutSet).toHaveBeenCalledWith("s1", "set1", { completed: true, actualReps: 8, weightKg: 45 });
    expect(await getQueuedMutations(store, "id-1")).toHaveLength(0);
  });

  it("logout (unauthenticated session detected) clears the identity-scoped mobile queue + snapshot", async () => {
    const store = createInMemoryStore();
    const monitor = fakeConnectivityMonitor(true);
    const session = makeSession();
    const { enqueueMutation, getQueuedMutations } = await import("../../offline/queue");
    const { writeSnapshot, readSnapshot } = await import("../../offline/snapshot");

    await writeSnapshot(store, "id-1", "s1", session);
    await enqueueMutation(store, "id-1", {
      kind: "set",
      sessionId: "s1",
      setId: "set1",
      input: { completed: true },
      queuedAt: 1000,
    });

    getWorkoutSession.mockResolvedValue({ kind: "error", message: "no_session" });

    renderScreen(
      { sessionId: "s1" },
      {
        getIdentityKey: async () => "id-1",
        openStore: async () => store,
        createConnectivityMonitor: async () => monitor,
      },
    );
    await flush();

    expect(deleteSessionToken).toHaveBeenCalled();
    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "Login" }] });
    expect(await getQueuedMutations(store, "id-1")).toHaveLength(0);
    expect(await readSnapshot(store, "id-1", "s1")).toBeUndefined();
  });

  it("never surfaces an unhandled rejection when a flush pass fails mid-way (e.g. a storage I/O error) — queue stays intact", async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const realStore = createInMemoryStore();
      const monitor = fakeConnectivityMonitor(true);
      const session = makeSession();

      const { enqueueMutation, getQueuedMutations } = await import("../../offline/queue");
      const { writeSnapshot, writeActiveSessionPointer } = await import("../../offline/snapshot");
      await writeSnapshot(realStore, "id-1", "s1", session);
      await writeActiveSessionPointer(realStore, "id-1", "s1");
      await enqueueMutation(realStore, "id-1", {
        kind: "set",
        sessionId: "s1",
        setId: "set1",
        input: { completed: true },
        queuedAt: 1000,
      });

      // getWorkoutSession must resolve normally so the initial mount load
      // (unrelated to the flush path under test) never itself throws —
      // isolating the assertion to the flush pass specifically.
      getWorkoutSession.mockResolvedValue({ kind: "ok", session });

      // A store whose `entries()` throws mid-flush — simulates a transient
      // AsyncStorage I/O failure (e.g. quota/corruption) during
      // `getQueuedMutations`, the ONLY call site that reads via `entries()`
      // on this path. The mutation itself must remain queued.
      const flakyStore = {
        ...realStore,
        entries: (async () => {
          throw new Error("simulated storage failure");
        }) as typeof realStore.entries,
      };

      renderScreen(
        { sessionId: "s1" },
        {
          getIdentityKey: async () => "id-1",
          openStore: async () => flakyStore,
          createConnectivityMonitor: async () => monitor,
        },
      );
      await flush();
      // Reconnect trigger — the SAME path every offline write's fire-and-
      // forget `void flush()` exercises.
      await act(async () => {
        monitor.setOnline(true);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      await flush();

      // The queue (read via the REAL store, unaffected by the flaky
      // entries() override used only for the flush-triggered read) still
      // has the mutation — a failed pass never drops it.
      expect(await getQueuedMutations(realStore, "id-1")).toHaveLength(1);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("guards against a rapid double-tap on complete-set: the second tap is rejected by the re-entrancy guard, so the local snapshot cannot be clobbered by an interleaved read-modify-write (reliability review fix)", async () => {
    const store = createInMemoryStore();
    const monitor = fakeConnectivityMonitor(false);
    const session = makeSession();
    const { getQueuedMutations } = await import("../../offline/queue");
    const { writeSnapshot, writeActiveSessionPointer, readSnapshot } = await import(
      "../../offline/snapshot"
    );

    await writeSnapshot(store, "id-1", "s1", session);
    await writeActiveSessionPointer(store, "id-1", "s1");

    const renderer = renderScreen(
      { sessionId: "s1" },
      {
        getIdentityKey: async () => "id-1",
        openStore: async () => store,
        createConnectivityMonitor: async () => monitor,
      },
    );
    await flush();

    const completeButton = renderer.root.find(
      (n) =>
        typeof n.props.accessibilityLabel === "string" &&
        n.props.accessibilityLabel.startsWith("Complete set"),
    );

    // Simulate a rapid double-tap: both invocations fire SYNCHRONOUSLY,
    // before either one's first `await` (enqueueMutation) has a chance to
    // resolve — exactly the interleaving that clobbers the local snapshot
    // if the re-entrancy guard is not set before the first `await`.
    await act(async () => {
      const first = completeButton.props.onPress();
      const second = completeButton.props.onPress();
      await Promise.all([first, second]);
    });
    await flush();

    // Only the FIRST tap's enqueue/snapshot-write cycle proceeds — the
    // second is rejected synchronously by the submitting guard, so the
    // queue never grows past one entry and the snapshot reflects exactly
    // one applied mutation.
    expect(await getQueuedMutations(store, "id-1")).toHaveLength(1);
    const snapshot = await readSnapshot(store, "id-1", "s1");
    expect(snapshot?.session.exercises[0]?.setRecords[0]?.completed).toBe(true);
  });
});
