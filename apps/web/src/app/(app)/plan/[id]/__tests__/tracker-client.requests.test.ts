import { describe, it, expect, vi } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import {
  fetchWorkoutSession,
  recordWorkoutSet,
  completeWorkoutSession,
} from "../tracker-client";

/**
 * `tracker-client.test.ts` covers the shared response mapping through
 * `startWorkoutSession`. These tests cover the three remaining exported
 * entry points, whose whole job is to build a DIFFERENT request: each one
 * must hit its own path with its own method and body. A wrong URL or verb
 * here silently writes to the wrong session, so the request shape is the
 * behaviour worth asserting.
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

/** The (url, init) pair the client passed to fetch. */
function callOf(fetchImpl: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe("fetchWorkoutSession", () => {
  it("GETs the session by id, uncached, with the bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, sessionRecord));

    const result = await fetchWorkoutSession("session-1", TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    const { url, init, headers } = callOf(fetchImpl);
    expect(url).toBe("http://api.test/workout-sessions/session-1");
    expect(init.method).toBe("GET");
    expect(headers.authorization).toBe("Bearer session-tok");
    // A tracker read must never be served from cache — a stale session would
    // show already-logged sets as pending.
    expect(init.cache).toBe("no-store");
    expect(init.body).toBeUndefined();
    expect(result).toEqual({ kind: "ok", session: sessionRecord });
  });

  it("returns no_session without calling the API when the token is missing", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchWorkoutSession("session-1", undefined, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a transport failure to a retryable UNREACHABLE error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchWorkoutSession("session-1", TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({
      kind: "error",
      message: "api_unreachable",
      code: "UNREACHABLE",
    });
  });
});

describe("recordWorkoutSet", () => {
  it("PATCHes the set nested under its session, sending the update as JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, sessionRecord));

    await recordWorkoutSet(
      "session-1",
      "set-9",
      { actualReps: 8, weightKg: 60, completed: true },
      TOKEN,
      { ...OPTIONS, fetchImpl },
    );

    const { url, init, headers } = callOf(fetchImpl);
    expect(url).toBe("http://api.test/workout-sessions/session-1/sets/set-9");
    expect(init.method).toBe("PATCH");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ actualReps: 8, weightKg: 60, completed: true });
    // Writes must not carry the GET-only no-store hint.
    expect(init.cache).toBeUndefined();
  });

  it("maps a 404 to the NOT_FOUND code so the offline queue can drop it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { error: "set_not_found" }));

    const result = await recordWorkoutSet(
      "session-1",
      "set-gone",
      { actualReps: 8, completed: true },
      TOKEN,
      { ...OPTIONS, fetchImpl },
    );

    expect(result).toEqual({
      kind: "error",
      message: "set_not_found",
      code: "NOT_FOUND",
    });
  });

  it("keeps a 401 retryable as AUTH rather than poison-dropping the set", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    const result = await recordWorkoutSet("session-1", "set-9", { actualReps: 8, completed: true }, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.code).toBe("AUTH");
  });
});

describe("completeWorkoutSession", () => {
  it("POSTs to the session's complete sub-resource", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { ...sessionRecord, status: "completed" }),
      );

    const result = await completeWorkoutSession("session-1", TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    const { url, init } = callOf(fetchImpl);
    expect(url).toBe("http://api.test/workout-sessions/session-1/complete");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({});
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.session.status).toBe("completed");
  });

  it("rejects an ok response whose body is not a session record", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { nope: true }));

    const result = await completeWorkoutSession("session-1", TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });

  it("maps a 500 to the retryable SERVER code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));

    const result = await completeWorkoutSession("session-1", TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("SERVER");
      expect(result.message).toBe("workout_session_request_failed");
    }
  });
});
