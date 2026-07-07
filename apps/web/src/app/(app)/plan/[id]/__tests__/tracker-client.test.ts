import { describe, it, expect, vi } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { startWorkoutSession } from "../tracker-client";

/**
 * tracker-client 409/conflict mapping (#93 F3).
 *
 * The API surfaces an active-session conflict as HTTP 409
 * `active_session_conflict`. parseWorkoutSessionResponse (exercised here via
 * startWorkoutSession) must map that into a structured
 * `{ kind:"error"; message:"active_session_conflict"; activePlanName; activeDay }`
 * — carrying the scope forward so the caller never crashes — while every other
 * non-ok status stays a bare error message.
 */

const OPTIONS = { apiBaseUrl: "http://api.test" };
const TOKEN = "session-tok";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const sessionRecord: WorkoutSessionRecord = {
  id: "session-1",
  workoutPlanId: "plan-1",
  status: "active",
  startedAt: "2026-07-06T09:00:00.000Z",
  exercises: [],
};

describe("tracker-client startWorkoutSession — 409 conflict mapping (F3)", () => {
  it("maps a 409 active_session_conflict to a conflict error result carrying the active scope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        error: "active_session_conflict",
        activePlanName: "Summer Cut",
        activeDay: 3,
      }),
    );

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("active_session_conflict");
      expect(result.activePlanName).toBe("Summer Cut");
      expect(result.activeDay).toBe(3);
    }
  });

  it("maps a 409 conflict with a null activeDay (legacy row) without losing the scope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        error: "active_session_conflict",
        activePlanName: "Plan 2026-07-06",
        activeDay: null,
      }),
    );

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("active_session_conflict");
      expect(result.activeDay).toBeNull();
    }
  });

  it("maps a non-409 error to a bare message with no conflict scope", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { error: "not_found" }));

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("not_found");
      expect(result.activePlanName).toBeUndefined();
      expect(result.activeDay).toBeUndefined();
    }
  });

  it("returns an ok result carrying the session on a 200 response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, sessionRecord));

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.session.id).toBe("session-1");
    }
  });
});
