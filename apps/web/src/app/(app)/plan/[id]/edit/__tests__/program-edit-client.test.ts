/**
 * program-edit-client — the wire branching for `PUT /workout-plans/:id/program`
 * (17d PR D).
 *
 * The interesting part is the 409 split: two conflicts share a status code but
 * need different remedies, so they must not collapse into one "save failed".
 */
import { describe, it, expect, vi } from "vitest";
import type { WorkoutProgram } from "@kinora/contracts";
import { updatePlanProgram } from "../program-edit-client";

const OPTIONS = { apiBaseUrl: "http://api.test" };
const TOKEN = "session-tok";
const EXPECTED_UPDATED_AT = "2026-08-09T10:00:00.000Z";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const program: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Push Day",
      exercises: [{ name: "Bench Press", sets: 3, reps: "8-10", restSeconds: 90 }],
    },
  ],
  limitationWarnings: [],
};

describe("updatePlanProgram", () => {
  it("returns an error without calling fetch when there is no session token", async () => {
    const fetchImpl = vi.fn();

    const result = await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, undefined, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("PUTs the full program and the expected version to the plan's program path", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: "plan-1", program, updatedAt: "2026-08-09T10:05:00.000Z" }));

    await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://api.test/workout-plans/plan-1/program");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      program,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
  });

  it("returns the saved program and its new version on a 200", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: "plan-1", program, updatedAt: "2026-08-09T10:05:00.000Z" }));

    const result = await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({
      kind: "ok",
      program,
      updatedAt: "2026-08-09T10:05:00.000Z",
    });
  });

  it("maps 409 edit_conflict to its own branch, carrying the current version", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        error: "edit_conflict",
        currentUpdatedAt: "2026-08-09T11:00:00.000Z",
      }),
    );

    const result = await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({
      kind: "conflict",
      currentUpdatedAt: "2026-08-09T11:00:00.000Z",
    });
  });

  it("maps 409 plan_not_ready to a DIFFERENT branch from a conflict", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: "plan_not_ready" }));

    const result = await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "not_ready" });
  });

  it("carries the server's structural issues through on a 422", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(422, { error: "duplicate_day", issues: ["duplicate_day", "empty_session"] }),
      );

    const result = await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({
      kind: "invalid",
      issues: ["duplicate_day", "empty_session"],
    });
  });

  it("falls back to the single error identifier on a 422 with no issues array", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { error: "invalid_program" }));

    const result = await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "invalid", issues: ["invalid_program"] });
  });

  it("maps a 404 to a generic error, not to a conflict", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));

    const result = await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "not_found" });
  });

  it("reports an unreachable API rather than throwing into the caller", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("rejects a 200 whose body is not a saved program, instead of reporting success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "plan-1" }));

    const result = await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });

  it("falls back to a stable identifier when an error body carries no error field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));

    const result = await updatePlanProgram("plan-1", program, EXPECTED_UPDATED_AT, TOKEN, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "update_program_failed" });
  });
});
