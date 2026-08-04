import { describe, it, expect, vi } from "vitest";
import type { ExerciseDetailDTO } from "@kinora/contracts";
import { fetchExerciseDetail } from "../exercise-detail-client";

/**
 * exercise-detail-client — server-only fetch for
 * GET /progress/exercise-detail (09c-v1 Slice 4b). Mirrors
 * dashboard-client.ts's fetch/parse pattern.
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

const detail: ExerciseDetailDTO = {
  exerciseTitle: "Bench Press",
  recentSets: [{ completedAt: "2026-07-10T09:00:00.000Z", weightKg: 80, actualReps: 8, rpe: 8 }],
};

describe("fetchExerciseDetail", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchExerciseDetail(undefined, "Bench Press", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed detail on a 200 response, URL-encoding the title", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, detail));

    const result = await fetchExerciseDetail(TOKEN, "Bench Press", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", detail });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/progress/exercise-detail?title=Bench%20Press",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
  });

  it("returns the API error code on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchExerciseDetail(TOKEN, "Bench Press", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "forbidden" });
  });

  it("falls back to a generic code when the error body carries none", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));

    const result = await fetchExerciseDetail(TOKEN, "Bench Press", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "fetch_exercise_detail_failed" });
  });

  it("falls back to a generic code when the error body is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    const result = await fetchExerciseDetail(TOKEN, "Bench Press", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "fetch_exercise_detail_failed" });
  });

  it("returns api_unreachable when fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchExerciseDetail(TOKEN, "Bench Press", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("returns invalid_response when the payload is missing recentSets", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { exerciseTitle: "Bench Press" }));

    const result = await fetchExerciseDetail(TOKEN, "Bench Press", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });

  it("returns invalid_response when the payload is missing exerciseTitle", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { recentSets: [] }));

    const result = await fetchExerciseDetail(TOKEN, "Bench Press", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });

  it("returns invalid_response when the body is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    const result = await fetchExerciseDetail(TOKEN, "Bench Press", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});
