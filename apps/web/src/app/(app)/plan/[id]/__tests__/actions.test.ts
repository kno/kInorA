import { describe, it, expect, vi, afterEach } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";

// --- Module mocks ---
const cookieGet = vi.fn();
const fetchPlanStatus = vi.fn();
const startWorkoutSession = vi.fn();
const fetchWorkoutSession = vi.fn();
const recordWorkoutSet = vi.fn();
const completeWorkoutSession = vi.fn();
const fetchAuthIdentity = vi.fn();

const sessionRecord: WorkoutSessionRecord = {
  id: "session-1",
  workoutPlanId: "plan-1",
  status: "active",
  startedAt: "2026-07-06T09:00:00.000Z",
  exercises: [
    {
      id: "exercise-1",
      workoutSessionId: "session-1",
      exerciseIndex: 0,
      title: "Barbell Squat",
      restSeconds: 120,
      setRecords: [
        {
          id: "set-1",
          sessionExerciseId: "exercise-1",
          setIndex: 0,
          targetReps: "8",
          completed: false,
        },
      ],
    },
  ],
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

vi.mock("@/app/(app)/create-plan/plan-draft-client", () => ({
  fetchPlanStatus: (...args: unknown[]) => fetchPlanStatus(...args),
}));

vi.mock("../tracker-client", () => ({
  startWorkoutSession: (...args: unknown[]) => startWorkoutSession(...args),
  fetchWorkoutSession: (...args: unknown[]) => fetchWorkoutSession(...args),
  recordWorkoutSet: (...args: unknown[]) => recordWorkoutSet(...args),
  completeWorkoutSession: (...args: unknown[]) => completeWorkoutSession(...args),
  fetchAuthIdentity: (...args: unknown[]) => fetchAuthIdentity(...args),
}));

import {
  completeWorkoutSessionAction,
  getPlanStatusAction,
  getWorkoutSessionAction,
  recordWorkoutSetAction,
  startWorkoutSessionAction,
} from "../actions";

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe("getPlanStatusAction", () => {
  it("calls fetchPlanStatus with the planId and session token from the cookie", async () => {
    cookieGet.mockReturnValue({ value: "session-tok-abc" });
    fetchPlanStatus.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-1", status: "ready", program: null, specId: "spec-1" },
    });

    await getPlanStatusAction("plan-1");

    expect(fetchPlanStatus).toHaveBeenCalledWith("plan-1", "session-tok-abc");
  });

  it("returns the plan status result from fetchPlanStatus on success", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    fetchPlanStatus.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-42", status: "ready", program: { weeklySessions: [] }, specId: "spec-42" },
    });

    const result = await getPlanStatusAction("plan-42");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.plan.id).toBe("plan-42");
      expect(result.plan.status).toBe("ready");
    }
  });

  it("returns the error result when fetchPlanStatus fails", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    fetchPlanStatus.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const result = await getPlanStatusAction("plan-99");

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("api_unreachable");
    }
  });

  it("passes undefined token to fetchPlanStatus when no session cookie exists", async () => {
    cookieGet.mockReturnValue(undefined);
    fetchPlanStatus.mockResolvedValue({ kind: "error", message: "no_session" });

    await getPlanStatusAction("plan-1");

    expect(fetchPlanStatus).toHaveBeenCalledWith("plan-1", undefined);
  });
});

describe("workout tracker server actions", () => {
  it("calls startWorkoutSession with the plan id, day, and session token from the cookie", async () => {
    cookieGet.mockReturnValue({ value: "session-tok-abc" });
    startWorkoutSession.mockResolvedValue({ kind: "ok", session: sessionRecord });

    const result = await startWorkoutSessionAction("plan-1", 1);

    expect(startWorkoutSession).toHaveBeenCalledWith("plan-1", 1, "session-tok-abc");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.session.id).toBe("session-1");
    }
  });

  it("returns a structured conflict (does NOT throw) when start hits a 409 active_session_conflict (F1/F3)", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    // tracker-client maps the 409 to a kind:"error" with the conflict scope.
    startWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: "Summer Cut",
      activeDay: 3,
    });

    // The whole point of F1: this must resolve to a conflict branch, not reject.
    const result = await startWorkoutSessionAction("plan-1", 1);

    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.activePlanName).toBe("Summer Cut");
      expect(result.activeDay).toBe(3);
    }
  });

  it("still throws on a non-conflict start error (network / not_found)", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    startWorkoutSession.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    await expect(startWorkoutSessionAction("plan-1", 1)).rejects.toThrow("api_unreachable");
  });

  it("calls fetchWorkoutSession with the session id and session token from the cookie", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    fetchWorkoutSession.mockResolvedValue({ kind: "ok", session: sessionRecord });

    const result = await getWorkoutSessionAction("session-1");

    expect(fetchWorkoutSession).toHaveBeenCalledWith("session-1", "tok");
    expect(result.exercises[0]?.title).toBe("Barbell Squat");
  });

  it("calls recordWorkoutSet with parsed input and session token from the cookie", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    recordWorkoutSet.mockResolvedValue({ kind: "ok", session: sessionRecord });

    await recordWorkoutSetAction("session-1", "set-1", {
      actualReps: 8,
      weightKg: 80,
      rpe: 8,
      completed: true,
      notes: "Felt strong",
    });

    expect(recordWorkoutSet).toHaveBeenCalledWith("session-1", "set-1", {
      actualReps: 8,
      weightKg: 80,
      rpe: 8,
      completed: true,
      notes: "Felt strong",
    }, "tok");
  });

  it("calls completeWorkoutSession with the session id and session token from the cookie", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    completeWorkoutSession.mockResolvedValue({
      kind: "ok",
      session: { ...sessionRecord, status: "completed", completedAt: "2026-07-06T10:00:00.000Z" },
    });

    const result = await completeWorkoutSessionAction("session-1");

    expect(completeWorkoutSession).toHaveBeenCalledWith("session-1", "tok");
    expect(result.status).toBe("completed");
  });
});

describe("getOfflineIdentityKeyAction (Phase 4 web offline — stable (tenantId,userId) derivation)", () => {
  /**
   * Fix for the confirmed relogin data-loss bug: the identity key MUST be
   * derived from the STABLE (tenantId, userId) pair, resolved server-side
   * via `fetchAuthIdentity` — NOT from the session token, which rotates
   * every login. Hashing the token would make the same user's re-login
   * resolve to a NEW identity key, causing `ensureIdentityScope` to
   * silently purge their own unsynced queue.
   */
  it("resolves a stable, non-empty identity key derived from tenantId+userId (never the raw token)", async () => {
    cookieGet.mockReturnValue({ value: "session-tok-abc" });
    fetchAuthIdentity.mockResolvedValue({ kind: "ok", tenantId: "tenant-1", userId: "user-1" });
    const { getOfflineIdentityKeyAction } = await import("../actions");

    const key = await getOfflineIdentityKeyAction();

    expect(key).toBeTruthy();
    expect(key).not.toBe("session-tok-abc");
    expect(key).not.toBe("tenant-1");
    expect(key).not.toBe("user-1");
  });

  it("resolves the SAME identity key across two SEPARATE logins for the SAME user (no relogin data loss)", async () => {
    fetchAuthIdentity.mockResolvedValue({ kind: "ok", tenantId: "tenant-1", userId: "user-1" });
    const { getOfflineIdentityKeyAction } = await import("../actions");

    cookieGet.mockReturnValue({ value: "session-tok-abc" });
    const first = await getOfflineIdentityKeyAction();

    // A brand-new session token (as issued by a fresh login) for the SAME
    // (tenantId, userId) must resolve to the SAME identity key.
    cookieGet.mockReturnValue({ value: "session-tok-xyz-different-login" });
    const second = await getOfflineIdentityKeyAction();

    expect(first).toBe(second);
  });

  it("resolves a DIFFERENT identity key for a different user (cross-account isolation preserved)", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    const { getOfflineIdentityKeyAction } = await import("../actions");

    fetchAuthIdentity.mockResolvedValue({ kind: "ok", tenantId: "tenant-1", userId: "user-1" });
    const first = await getOfflineIdentityKeyAction();

    fetchAuthIdentity.mockResolvedValue({ kind: "ok", tenantId: "tenant-1", userId: "user-2" });
    const second = await getOfflineIdentityKeyAction();

    expect(first).not.toBe(second);
  });

  it("resolves undefined when there is no session cookie", async () => {
    cookieGet.mockReturnValue(undefined);
    const { getOfflineIdentityKeyAction } = await import("../actions");

    const key = await getOfflineIdentityKeyAction();

    expect(key).toBeUndefined();
    expect(fetchAuthIdentity).not.toHaveBeenCalled();
  });

  it("resolves undefined when the identity lookup fails (e.g. expired session)", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    fetchAuthIdentity.mockResolvedValue({ kind: "error", message: "auth_identity_request_failed" });
    const { getOfflineIdentityKeyAction } = await import("../actions");

    const key = await getOfflineIdentityKeyAction();

    expect(key).toBeUndefined();
  });
});

describe("unwrapWorkoutSession — FlushErrorCode propagation (Phase 4 web offline)", () => {
  it("throws an error carrying the VALIDATION FlushErrorCode from a 4xx failure", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    recordWorkoutSet.mockResolvedValue({
      kind: "error",
      message: "invalid_input",
      code: "VALIDATION",
    });

    await expect(
      recordWorkoutSetAction("session-1", "set-1", { completed: true }),
    ).rejects.toMatchObject({ message: "invalid_input", code: "VALIDATION" });
  });

  it("throws an error carrying the UNREACHABLE FlushErrorCode from a network failure", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    completeWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "api_unreachable",
      code: "UNREACHABLE",
    });

    await expect(completeWorkoutSessionAction("session-1")).rejects.toMatchObject({
      message: "api_unreachable",
      code: "UNREACHABLE",
    });
  });

  it("defaults to the SERVER FlushErrorCode when tracker-client omits a code (defensive fallback)", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    completeWorkoutSession.mockResolvedValue({ kind: "error", message: "boom" });

    await expect(completeWorkoutSessionAction("session-1")).rejects.toMatchObject({
      message: "boom",
      code: "SERVER",
    });
  });
});
