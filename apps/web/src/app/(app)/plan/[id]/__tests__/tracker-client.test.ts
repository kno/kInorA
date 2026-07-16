import { describe, it, expect, vi } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { startWorkoutSession, fetchAuthIdentity } from "../tracker-client";

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

describe("tracker-client FlushErrorCode propagation (Phase 4 web offline)", () => {
  it("maps a 400 validation failure to the VALIDATION FlushErrorCode", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: "invalid_input" }));

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("VALIDATION");
    }
  });

  it("maps a 404 not-found failure to the NOT_FOUND FlushErrorCode", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { error: "not_found" }));

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("NOT_FOUND");
    }
  });

  it("maps a 401 unauthorized failure to the AUTH FlushErrorCode (retryable, NOT poison-dropped)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AUTH");
    }
  });

  it("maps a 403 forbidden failure (e.g. suspended membership) to the AUTH FlushErrorCode", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AUTH");
    }
  });

  it("still maps a 400/422 validation failure to VALIDATION, not AUTH", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { error: "invalid_input" }));

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("VALIDATION");
    }
  });

  it("maps a 500 server failure to the SERVER FlushErrorCode (retryable, not poisoned)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: "internal_error" }));

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("SERVER");
    }
  });

  it("maps a thrown fetch (network down) to the UNREACHABLE FlushErrorCode", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await startWorkoutSession("plan-1", 1, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("UNREACHABLE");
    }
  });
});

describe("fetchAuthIdentity (Phase 4 web offline — stable identity derivation)", () => {
  it("calls GET /auth/identity with the Bearer token and returns tenantId + userId on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { tenantId: "tenant-1", userId: "user-1" }),
    );

    const result = await fetchAuthIdentity(TOKEN, { ...OPTIONS, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/auth/identity",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: `Bearer ${TOKEN}` }),
      }),
    );
    expect(result).toEqual({ kind: "ok", tenantId: "tenant-1", userId: "user-1" });
  });

  it("returns an error result when there is no session token", async () => {
    const result = await fetchAuthIdentity(undefined, OPTIONS);
    expect(result).toEqual({ kind: "error", message: "no_session" });
  });

  it("returns an error result on a non-ok response (e.g. 401)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    const result = await fetchAuthIdentity(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result.kind).toBe("error");
  });

  it("returns an error result when the fetch throws (network down)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await fetchAuthIdentity(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });
});
