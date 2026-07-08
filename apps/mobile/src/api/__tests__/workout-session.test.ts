import { describe, it, expect, vi } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import {
  completeWorkoutSession,
  getWorkoutSession,
  recordWorkoutSet,
  startWorkoutSession,
  type FetchLike,
} from "../workout-session";

const token = async () => "tok_123";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchMock = ReturnType<typeof vi.fn<FetchLike>>;

/** Read the first fetch call with the concrete shapes this client sends. */
function firstCall(fetchImpl: FetchMock) {
  const call = fetchImpl.mock.calls[0]!;
  return {
    url: call[0],
    init: call[1] as {
      method: string;
      headers: Record<string, string>;
      body?: string;
    },
  };
}

function mockFetch(response: Response | (() => Promise<Response>)): FetchMock {
  return vi.fn<FetchLike>(
    typeof response === "function" ? response : async () => response,
  );
}

const sessionFixture: WorkoutSessionRecord = {
  id: "sess_1",
  workoutPlanId: "plan_1",
  status: "active",
  startedAt: "2026-07-08T10:00:00.000Z",
  exercises: [],
};

describe("workout-session client", () => {
  it("returns no_session when no token is stored", async () => {
    const res = await startWorkoutSession("plan_1", 1, {
      getToken: async () => null,
      fetchImpl: vi.fn(),
    });
    expect(res).toEqual({ kind: "error", message: "no_session" });
  });

  it("POSTs to /workout-sessions with a Bearer token and body", async () => {
    const fetchImpl = mockFetch(jsonResponse(sessionFixture));
    const res = await startWorkoutSession("plan_1", 2, {
      getToken: token,
      apiBaseUrl: "http://api.test",
      fetchImpl,
    });
    expect(res.kind).toBe("ok");
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe("http://api.test/workout-sessions");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer tok_123");
    expect(JSON.parse(init.body ?? "{}")).toEqual({
      workoutPlanId: "plan_1",
      day: 2,
    });
  });

  it("surfaces a 409 active_session_conflict with its scope", async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        {
          error: "active_session_conflict",
          activePlanName: "Fuerza total",
          activeDay: 3,
        },
        409,
      ),
    );
    const res = await startWorkoutSession("plan_1", 1, {
      getToken: token,
      fetchImpl,
    });
    expect(res).toEqual({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: "Fuerza total",
      activeDay: 3,
    });
  });

  it("maps a network throw to api_unreachable", async () => {
    const res = await getWorkoutSession("sess_1", {
      getToken: token,
      fetchImpl: mockFetch(() => {
        throw new Error("offline");
      }),
    });
    expect(res).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("PATCHes a set update", async () => {
    const fetchImpl = mockFetch(jsonResponse(sessionFixture));
    await recordWorkoutSet(
      "sess_1",
      "set_9",
      { completed: true, weightKg: 45, actualReps: 8 },
      { getToken: token, apiBaseUrl: "http://api.test", fetchImpl },
    );
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe("http://api.test/workout-sessions/sess_1/sets/set_9");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body ?? "{}")).toEqual({
      completed: true,
      weightKg: 45,
      actualReps: 8,
    });
  });

  it("POSTs completion", async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ ...sessionFixture, status: "completed" }),
    );
    const res = await completeWorkoutSession("sess_1", {
      getToken: token,
      apiBaseUrl: "http://api.test",
      fetchImpl,
    });
    expect(res.kind).toBe("ok");
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe("http://api.test/workout-sessions/sess_1/complete");
    expect(init.method).toBe("POST");
  });

  it("flags a malformed 200 as invalid_response", async () => {
    const res = await getWorkoutSession("sess_1", {
      getToken: token,
      fetchImpl: mockFetch(jsonResponse({ nope: true })),
    });
    expect(res).toEqual({ kind: "error", message: "invalid_response" });
  });
});
