// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { WorkoutSessionRecord } from "@kinora/contracts";

/**
 * `useWorkoutSession` — actionable under-24h conflict banner (17b scope A,
 * PR 2). These tests cover the additions layered on top of the existing
 * start/record/complete lifecycle: the widened conflict DTO (blocking
 * session id + start date), the auto-close notice state, and Discard's
 * write-then-retry sequencing.
 */

const recordWorkoutSetAction = vi.fn();
const completeWorkoutSessionAction = vi.fn();
const startWorkoutSessionAction = vi.fn();
const abandonSessionAction = vi.fn();
const getWorkoutSessionAction = vi.fn();

vi.mock("../[id]/actions", () => ({
  recordWorkoutSetAction: (...args: unknown[]) => recordWorkoutSetAction(...args),
  completeWorkoutSessionAction: (...args: unknown[]) => completeWorkoutSessionAction(...args),
  startWorkoutSessionAction: (...args: unknown[]) => startWorkoutSessionAction(...args),
  abandonSessionAction: (...args: unknown[]) => abandonSessionAction(...args),
  getWorkoutSessionAction: (...args: unknown[]) => getWorkoutSessionAction(...args),
  getOfflineIdentityKeyAction: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const startedSession: WorkoutSessionRecord = {
  id: "session-new",
  workoutPlanId: "plan-1",
  status: "active",
  startedAt: "2026-08-07T09:00:00.000Z",
  day: 2,
  exercises: [],
};

async function loadHook() {
  const { useWorkoutSession } = await import("../use-workout-session");
  return renderHook(() =>
    useWorkoutSession({
      // No offline deps injected — resolves undefined, degrading to the
      // pre-offline direct-call path (Mock Hygiene: only the actions module
      // is mocked).
      offline: {
        getIdentityKey: async () => undefined,
        openStore: async () => {
          throw new Error("not used in this suite");
        },
        createConnectivityMonitor: () => ({
          isOnline: () => true,
          subscribe: () => () => {},
        }),
      },
    }),
  );
}

describe("useWorkoutSession — widened conflict DTO (17b scope A)", () => {
  it("carries the blocking session's id and start date on a conflict", async () => {
    startWorkoutSessionAction.mockResolvedValue({
      kind: "conflict",
      activePlanName: "Summer Cut",
      activeDay: 3,
      activeSessionId: "session-blocking",
      activeStartedAt: "2026-08-05T09:00:00.000Z",
    });

    const { result } = await loadHook();

    await act(async () => {
      await result.current.handleStartWorkout("plan-1", 2);
    });

    expect(result.current.conflict).toEqual({
      activePlanName: "Summer Cut",
      activeDay: 3,
      activeSessionId: "session-blocking",
      activeStartedAt: "2026-08-05T09:00:00.000Z",
    });
  });
});

describe("useWorkoutSession — auto-close notice (17b scope A)", () => {
  it("sets autoCloseNotice when a started response carries autoClosedSession", async () => {
    startWorkoutSessionAction.mockResolvedValue({
      kind: "ok",
      session: startedSession,
      autoClosedSession: { id: "session-stale", startedAt: "2026-08-04T08:00:00.000Z" },
    });

    const { result } = await loadHook();

    await act(async () => {
      await result.current.handleStartWorkout("plan-1", 2);
    });

    expect(result.current.autoCloseNotice).toEqual({
      id: "session-stale",
      startedAt: "2026-08-04T08:00:00.000Z",
    });
  });

  it("does not set autoCloseNotice when the started response carries none", async () => {
    startWorkoutSessionAction.mockResolvedValue({ kind: "ok", session: startedSession });

    const { result } = await loadHook();

    await act(async () => {
      await result.current.handleStartWorkout("plan-1", 2);
    });

    expect(result.current.autoCloseNotice).toBeUndefined();
  });

  it("clears a prior autoCloseNotice at the start of a new start attempt", async () => {
    startWorkoutSessionAction.mockResolvedValueOnce({
      kind: "ok",
      session: startedSession,
      autoClosedSession: { id: "session-stale", startedAt: "2026-08-04T08:00:00.000Z" },
    });
    const { result } = await loadHook();

    await act(async () => {
      await result.current.handleStartWorkout("plan-1", 2);
    });
    expect(result.current.autoCloseNotice).toBeDefined();

    startWorkoutSessionAction.mockResolvedValueOnce({
      kind: "ok",
      session: { ...startedSession, id: "session-newer" },
    });
    await act(async () => {
      await result.current.handleStartWorkout("plan-1", 3);
    });

    expect(result.current.autoCloseNotice).toBeUndefined();
  });
});

describe("useWorkoutSession — Discard (17b scope A)", () => {
  async function reachConflict() {
    startWorkoutSessionAction.mockResolvedValueOnce({
      kind: "conflict",
      activePlanName: "Summer Cut",
      activeDay: 3,
      activeSessionId: "session-blocking",
      activeStartedAt: "2026-08-05T09:00:00.000Z",
    });
    const rendered = await loadHook();
    await act(async () => {
      await rendered.result.current.handleStartWorkout("plan-1", 2);
    });
    expect(rendered.result.current.conflict).toBeDefined();
    return rendered;
  }

  it("posts abandon then retries the original start on success", async () => {
    const { result } = await reachConflict();
    abandonSessionAction.mockResolvedValue({
      kind: "ok",
      session: { id: "session-blocking", workoutPlanId: "plan-1", status: "abandoned", startedAt: "2026-08-05T09:00:00.000Z", exercises: [] },
    });
    startWorkoutSessionAction.mockResolvedValueOnce({ kind: "ok", session: startedSession });

    await act(async () => {
      await result.current.handleDiscardSession();
    });

    expect(abandonSessionAction).toHaveBeenCalledWith("session-blocking");
    // Retries the ORIGINAL requested start (plan-1, day 2), not the blocking
    // session's day (3).
    expect(startWorkoutSessionAction).toHaveBeenLastCalledWith("plan-1", 2);
    expect(result.current.conflict).toBeUndefined();
    expect(result.current.activeSession?.id).toBe("session-new");
  });

  it("sets discardFailed and does NOT retry the start when abandon fails", async () => {
    const { result } = await reachConflict();
    abandonSessionAction.mockRejectedValue(new Error("abandon_failed"));

    await act(async () => {
      await result.current.handleDiscardSession();
    });

    expect(result.current.discardFailed).toBe(true);
    // Only the initial conflict-producing call — no retry attempt.
    expect(startWorkoutSessionAction).toHaveBeenCalledTimes(1);
    // The conflict is NOT cleared — the user still needs to resolve it.
    expect(result.current.conflict).toBeDefined();
  });

  it("sets discardFailed and does NOT retry the start when abandon returns not_active", async () => {
    const { result } = await reachConflict();
    abandonSessionAction.mockResolvedValue({ kind: "not_active" });

    await act(async () => {
      await result.current.handleDiscardSession();
    });

    expect(result.current.discardFailed).toBe(true);
    expect(startWorkoutSessionAction).toHaveBeenCalledTimes(1);
  });

  it("loads the blocking session by id and makes it the active session (Resume)", async () => {
    const { result } = await reachConflict();
    const blockingSession: WorkoutSessionRecord = {
      id: "session-blocking",
      workoutPlanId: "plan-other",
      status: "active",
      startedAt: "2026-08-05T09:00:00.000Z",
      day: 3,
      exercises: [],
    };
    getWorkoutSessionAction.mockResolvedValue(blockingSession);

    await act(async () => {
      await result.current.handleResumeSession("session-blocking");
    });

    expect(getWorkoutSessionAction).toHaveBeenCalledWith("session-blocking");
    expect(result.current.activeSession?.id).toBe("session-blocking");
    expect(result.current.activeDay).toBe(3);
    expect(result.current.conflict).toBeUndefined();
  });

  it("surfaces an error and leaves the conflict intact when Resume's session lookup fails", async () => {
    const { result } = await reachConflict();
    getWorkoutSessionAction.mockRejectedValue(new Error("not_found"));

    await act(async () => {
      await result.current.handleResumeSession("session-blocking");
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.activeSession).toBeUndefined();
  });

  it("clears a prior discardFailed on the next successful discard", async () => {
    const { result } = await reachConflict();
    abandonSessionAction.mockRejectedValueOnce(new Error("abandon_failed"));
    await act(async () => {
      await result.current.handleDiscardSession();
    });
    expect(result.current.discardFailed).toBe(true);

    abandonSessionAction.mockResolvedValueOnce({
      kind: "ok",
      session: { id: "session-blocking", workoutPlanId: "plan-1", status: "abandoned", startedAt: "2026-08-05T09:00:00.000Z", exercises: [] },
    });
    startWorkoutSessionAction.mockResolvedValueOnce({ kind: "ok", session: startedSession });

    await act(async () => {
      await result.current.handleDiscardSession();
    });

    expect(result.current.discardFailed).toBe(false);
  });
});
