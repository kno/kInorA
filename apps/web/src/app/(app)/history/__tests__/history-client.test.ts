import { describe, it, expect, vi } from "vitest";
import type { WorkoutHistoryEntry } from "@kinora/contracts";
import { fetchWorkoutHistory } from "../history-client";

/**
 * history-client — server-only fetch for GET /workout-sessions/history.
 *
 * Mirrors tracker-client.ts's fetch/parse pattern: no-session and
 * unreachable-network map to structured errors, a 200 array maps to
 * `{ kind: "ok"; entries }`, and pagination params are forwarded as query
 * params.
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

const historyEntry: WorkoutHistoryEntry = {
  session: {
    id: "session-1",
    workoutPlanId: "plan-1",
    status: "completed",
    startedAt: "2026-07-04T08:30:00.000Z",
    completedAt: "2026-07-04T09:20:00.000Z",
    exercises: [],
  },
  totalVolume: 100,
  averageRpe: 8,
  trend: { volumeDelta: 20, direction: "up" },
};

describe("fetchWorkoutHistory", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchWorkoutHistory(undefined, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed entries on a 200 response and forwards limit/offset as query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, [historyEntry]));

    const result = await fetchWorkoutHistory(TOKEN, { limit: 5, offset: 10 }, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", entries: [historyEntry] });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/workout-sessions/history?limit=5&offset=10",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("omits query params entirely when the caller supplies no pagination", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, []));

    await fetchWorkoutHistory(TOKEN, {}, { ...OPTIONS, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/workout-sessions/history",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a network failure to api_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await fetchWorkoutHistory(TOKEN, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("maps a non-ok response to a bare error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "server_error" }));

    const result = await fetchWorkoutHistory(TOKEN, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "server_error" });
  });

  it("maps a malformed (non-array) payload to invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { not: "an array" }));

    const result = await fetchWorkoutHistory(TOKEN, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});
