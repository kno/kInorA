import { describe, it, expect, vi } from "vitest";
import type { ClientSummaryDTO } from "@kinora/contracts";
import {
  createPlanForClient,
  fetchClientDashboard,
  fetchClientExerciseDetail,
  fetchClientPlan,
  fetchClientProgressStats,
  fetchClients,
  fetchClientWeeklyOverview,
  inviteClient,
  type CreatePlanForClientInput,
} from "../trainer-client";

/**
 * trainer-client — server-only fetch for the S3/S4 trainer routes.
 * Mirrors dashboard-client.test.ts's fetch/parse pattern.
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

const clients: ClientSummaryDTO[] = [
  { clientUserId: "user_1" as never, email: "client1@test.com", status: "active" },
];

describe("fetchClients", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchClients(undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed clients on a 200 response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, clients));

    const result = await fetchClients(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", clients });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/trainer/clients",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a 403 response to forbidden (non-trainer/non-entitled)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchClients(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("maps a network failure to api_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await fetchClients(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("maps a malformed payload to invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { not: "an array" }));

    const result = await fetchClients(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});

describe("inviteClient", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await inviteClient(undefined, "client@test.com", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs the email and returns ok on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { id: "a1" }));

    const result = await inviteClient(TOKEN, "client@test.com", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/trainer/clients/invite",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "client@test.com" }),
      }),
    );
  });

  it("maps a 409 (already assigned) to its error key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: "client_already_assigned" }));

    const result = await inviteClient(TOKEN, "client@test.com", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "client_already_assigned" });
  });
});

describe("createPlanForClient", () => {
  const input: CreatePlanForClientInput = {
    goal: "strength",
    daysPerWeek: 3,
    sessionDurationMinutes: 45,
    location: "gym",
    equipment: [],
    limitations: [],
  };

  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await createPlanForClient("user_1", input, undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs the spec to the client-owned route and returns the planId/status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { id: "spec_1", planId: "plan_1", status: "generating" }));

    const result = await createPlanForClient("user_1", input, TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", planId: "plan_1", status: "generating" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/clients/user_1/plan-specs",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
  });

  it("maps a 403 (no active assignment) to its error key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await createPlanForClient("user_1", input, TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "forbidden" });
  });
});

describe("fetchClientPlan (#341)", () => {
  const plan = {
    id: "plan_1",
    status: "ready",
    program: { weeklySessions: [], limitationWarnings: [] },
    specId: "spec_1",
    name: "Client plan",
  };

  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchClientPlan("user_1", "plan_1", undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GETs the trainer-scoped read route and returns the plan on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, plan));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", plan });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/clients/user_1/workout-plans/plan_1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("percent-encodes both path segments", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, plan));

    await fetchClientPlan("a/b", "c d", TOKEN, { ...OPTIONS, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/clients/a%2Fb/workout-plans/c%20d",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a 403 (not this client's trainer) to forbidden", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("maps a 404 to notFound, distinct from forbidden", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "notFound" });
  });

  it("maps any other non-ok status to a generic error — never to ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" }));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "boom" });
  });

  it("maps a network failure to api_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("rejects a 200 body without an id as invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { status: "ready" }));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});

describe("fetchClientDashboard (GH #447)", () => {
  const dashboard = {
    rpeTrend: [{ weekStart: "2026-08-03", meanRpe: 7.2, sessionsWithRpe: 3 }],
    completionRate: { periodDays: 28 as const, planned: 12, completed: 10, percent: 83 },
    recentSessions: [{ date: "2026-08-17", volumeKg: 1200, meanRpe: 7 }],
  };

  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchClientDashboard("user_1", undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GETs the trainer-scoped dashboard route and returns the DTO on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, dashboard));

    const result = await fetchClientDashboard("user_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", dashboard });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/trainer/clients/user_1/dashboard",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a 403 (not this client's trainer) to forbidden", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchClientDashboard("user_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("rejects a malformed body as invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { rpeTrend: [] }));

    const result = await fetchClientDashboard("user_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });

  it("maps a network failure to api_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"));

    const result = await fetchClientDashboard("user_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });
});

describe("fetchClientProgressStats (GH #447)", () => {
  const summary = {
    range: "week" as const,
    totalVolumeKg: { value: 8460, deltaVsPreviousPeriod: 6.2 },
    sessionCount: { value: 3, deltaVsPreviousPeriod: null },
    totalDurationMin: { value: 173, deltaVsPreviousPeriod: 4 },
    prCount: { value: 1, deltaVsPreviousPeriod: null },
    volumeTrend: { current: [100, 200], previous: [90, 150] },
    muscleGroupDistribution: [],
    personalRecords: [],
  };

  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchClientProgressStats("user_1", "week", undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GETs the trainer-scoped stats route with the range query and returns the DTO", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, summary));

    const result = await fetchClientProgressStats("user_1", "week", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", summary });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/trainer/clients/user_1/progress/stats?range=week",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a 403 to forbidden", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchClientProgressStats("user_1", "month", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("rejects a malformed body as invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { not: "a summary" }));

    const result = await fetchClientProgressStats("user_1", "year", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});

describe("fetchClientExerciseDetail (GH #447)", () => {
  const detail = { exerciseTitle: "Back squat", recentSets: [{ completedAt: "2026-08-12", weightKg: 92.5, actualReps: 5 }] };

  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchClientExerciseDetail("user_1", "Back squat", undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GETs the trainer-scoped exercise-detail route with the encoded title", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, detail));

    const result = await fetchClientExerciseDetail("user_1", "Back squat", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", detail });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/trainer/clients/user_1/progress/exercise-detail?title=Back%20squat",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a 403 to forbidden", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchClientExerciseDetail("user_1", "Back squat", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("rejects a malformed body as invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { exerciseTitle: "x" }));

    const result = await fetchClientExerciseDetail("user_1", "Back squat", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});

describe("fetchClientWeeklyOverview (GH #447)", () => {
  const overview = {
    weekStart: "2026-08-11",
    weekLabel: "11–17 ago",
    days: [{ date: "2026-08-11", status: "done" as const }],
    previousWeekStart: "2026-08-04",
    nextWeekStart: "2026-08-18",
  };

  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchClientWeeklyOverview("user_1", undefined, undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GETs the trainer-scoped weekly-overview route without a query when weekStart is omitted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, overview));

    const result = await fetchClientWeeklyOverview("user_1", undefined, TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", overview });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/trainer/clients/user_1/progress/weekly-overview",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("appends the weekStart query when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, overview));

    await fetchClientWeeklyOverview("user_1", "2026-08-11", TOKEN, { ...OPTIONS, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/trainer/clients/user_1/progress/weekly-overview?weekStart=2026-08-11",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a 403 to forbidden", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchClientWeeklyOverview("user_1", undefined, TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("rejects a malformed body as invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { weekStart: "x" }));

    const result = await fetchClientWeeklyOverview("user_1", undefined, TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});
