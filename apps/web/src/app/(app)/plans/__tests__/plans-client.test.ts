import { describe, it, expect, vi } from "vitest";
import type { WorkoutPlanSummary } from "@kinora/contracts";
import { fetchUserPlansWithProgress } from "../plans-client";

/**
 * plans-client — server-only fetch for GET /workout-plans?progress=1 (17d PR A).
 * Mirrors fetchWorkoutHistory's fetch/parse pattern.
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

const planSummary: WorkoutPlanSummary = {
  id: "plan-1",
  status: "ready",
  createdAt: "2026-06-29T10:00:00.000Z",
  name: "Summer Cut",
  daysPerWeek: 4,
  completedSessions: 3,
  lastTrainedAt: "2026-07-01T10:00:00.000Z",
};

describe("fetchUserPlansWithProgress", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchUserPlansWithProgress(undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed plans on a 200 response and calls GET /workout-plans?progress=1", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, [planSummary]));

    const result = await fetchUserPlansWithProgress(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", plans: [planSummary] });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/workout-plans?progress=1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a network failure to api_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await fetchUserPlansWithProgress(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("maps a non-ok response to a bare error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "server_error" }));

    const result = await fetchUserPlansWithProgress(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "server_error" });
  });

  it("maps a malformed (non-array) payload to invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { not: "an array" }));

    const result = await fetchUserPlansWithProgress(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});
