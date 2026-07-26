import { describe, it, expect, vi } from "vitest";
import type { DashboardSummaryDTO, WorkoutProgram } from "@kinora/contracts";
import {
  adaptPlan,
  fetchDashboardSummary,
  fetchLatestPlanForSpec,
  fetchPlanStatus,
  regeneratePlan,
  type FetchLike,
} from "../plan-status-client";

const token = async () => "tok_123";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchMock = ReturnType<typeof vi.fn<FetchLike>>;

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

const readyPlan = {
  id: "plan_9",
  status: "ready",
  specId: "spec_1",
  name: "My Plan",
  program: { days: [] } as unknown as WorkoutProgram,
};

const lowSummary: DashboardSummaryDTO = {
  streak: 0,
  recentDailyCompletion: [],
  weeklyCompleted: 1,
  weeklyPlanned: 4,
  weeklyRollup: [],
  adaptation: {
    source: "adherence",
    level: "low",
    suggestedChange: { kind: "reduce_frequency", fromDays: 4, toDays: 3 },
    planSpecId: "spec_1",
    rationaleKey: "adaptation.rationale.low",
    adherence: {
      adherence: 0.31,
      periodWeeks: 4,
      completedInWindow: 5,
      plannedInWindow: 16,
    },
  },
};

describe("plan-status-client", () => {
  describe("fetchPlanStatus", () => {
    it("returns a sessionExpired error without calling fetch when no token is stored", async () => {
      const fetchImpl = vi.fn<FetchLike>();
      const res = await fetchPlanStatus("plan_9", {
        getToken: async () => null,
        fetchImpl,
      });
      expect(res).toEqual({
        kind: "error",
        message: "no_session",
        sessionExpired: true,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("GETs /workout-plans/:id with a Bearer token and maps a 200 plan", async () => {
      const fetchImpl = mockFetch(jsonResponse(readyPlan));
      const res = await fetchPlanStatus("plan_9", {
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", plan: readyPlan });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/workout-plans/plan_9");
      expect(init.method).toBe("GET");
      expect(init.headers.authorization).toBe("Bearer tok_123");
      // A GET never sends a body → no tenant/user leak possible.
      expect(init.body).toBeUndefined();
    });

    it("maps a 401 to a sessionExpired error", async () => {
      const res = await fetchPlanStatus("plan_9", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "unauthorized" }, 401)),
      });
      expect(res).toEqual({
        kind: "error",
        message: "unauthorized",
        status: 401,
        sessionExpired: true,
      });
    });

    it("maps a 404 to a not-found error carrying the status (never sessionExpired)", async () => {
      const res = await fetchPlanStatus("plan_missing", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "not_found" }, 404)),
      });
      expect(res).toEqual({
        kind: "error",
        message: "not_found",
        status: 404,
      });
    });

    it("maps a malformed 200 (no id) to invalid_response", async () => {
      const res = await fetchPlanStatus("plan_9", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ status: "ready" })),
      });
      expect(res).toEqual({ kind: "error", message: "invalid_response" });
    });

    it("maps a network throw to api_unreachable", async () => {
      const res = await fetchPlanStatus("plan_9", {
        getToken: token,
        fetchImpl: mockFetch(() => {
          throw new Error("offline");
        }),
      });
      expect(res).toEqual({ kind: "error", message: "api_unreachable" });
    });
  });

  describe("fetchLatestPlanForSpec", () => {
    it("GETs /plan-specs/:id/workout-plan and maps a 200 plan", async () => {
      const fetchImpl = mockFetch(jsonResponse(readyPlan));
      const res = await fetchLatestPlanForSpec("spec_1", {
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", plan: readyPlan });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/plan-specs/spec_1/workout-plan");
      expect(init.method).toBe("GET");
      expect(init.headers.authorization).toBe("Bearer tok_123");
    });

    it("maps a 404 (no plan for spec) to a not-found error", async () => {
      const res = await fetchLatestPlanForSpec("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "not_found" }, 404)),
      });
      expect(res).toEqual({ kind: "error", message: "not_found", status: 404 });
    });

    it("returns sessionExpired without fetching when no token is stored", async () => {
      const fetchImpl = vi.fn<FetchLike>();
      const res = await fetchLatestPlanForSpec("spec_1", {
        getToken: async () => null,
        fetchImpl,
      });
      expect(res).toEqual({
        kind: "error",
        message: "no_session",
        sessionExpired: true,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("regeneratePlan", () => {
    it("returns sessionExpired without fetching when no token is stored", async () => {
      const fetchImpl = vi.fn<FetchLike>();
      const res = await regeneratePlan("spec_1", {
        getToken: async () => null,
        fetchImpl,
      });
      expect(res).toEqual({
        kind: "error",
        message: "no_session",
        sessionExpired: true,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("POSTs an empty body to /plan-specs/:id/regenerate and maps a 202", async () => {
      const fetchImpl = mockFetch(
        jsonResponse({ planId: "plan_9", status: "generating" }, 202),
      );
      const res = await regeneratePlan("spec_1", {
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", planId: "plan_9", status: "generating" });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/plan-specs/spec_1/regenerate");
      expect(init.method).toBe("POST");
      expect(init.headers.authorization).toBe("Bearer tok_123");
      // Body is empty — the server is authoritative. No tenant/user/frequency.
      expect(JSON.parse(init.body ?? "{}")).toEqual({});
    });

    it("defaults a missing status to generating", async () => {
      const res = await regeneratePlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ planId: "plan_9" }, 202)),
      });
      expect(res).toEqual({ kind: "ok", planId: "plan_9", status: "generating" });
    });

    it("maps a 403 quota-exhausted to an error carrying the status and reason", async () => {
      const res = await regeneratePlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(
          jsonResponse({ error: "tenant_quota_exhausted" }, 403),
        ),
      });
      expect(res).toEqual({
        kind: "error",
        message: "tenant_quota_exhausted",
        status: 403,
      });
    });

    it("maps a 404 (cross-tenant/unknown spec) to an error carrying the status", async () => {
      const res = await regeneratePlan("spec_x", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "not_found" }, 404)),
      });
      expect(res).toEqual({ kind: "error", message: "not_found", status: 404 });
    });

    it("maps a 401 to a sessionExpired error", async () => {
      const res = await regeneratePlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "unauthorized" }, 401)),
      });
      expect(res.kind === "error" && res.sessionExpired).toBe(true);
    });

    it("maps a network throw to api_unreachable", async () => {
      const res = await regeneratePlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(() => {
          throw new Error("offline");
        }),
      });
      expect(res).toEqual({ kind: "error", message: "api_unreachable" });
    });
  });

  describe("adaptPlan", () => {
    it("returns sessionExpired without fetching when no token is stored", async () => {
      const fetchImpl = vi.fn<FetchLike>();
      const res = await adaptPlan("spec_1", {
        getToken: async () => null,
        fetchImpl,
      });
      expect(res).toEqual({
        kind: "error",
        message: "no_session",
        sessionExpired: true,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("POSTs an empty body to /plan-specs/:id/adapt and maps a 202", async () => {
      const fetchImpl = mockFetch(
        jsonResponse({ planId: "plan_9", status: "generating" }, 202),
      );
      const res = await adaptPlan("spec_1", {
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", planId: "plan_9", status: "generating" });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/plan-specs/spec_1/adapt");
      expect(init.method).toBe("POST");
      expect(init.headers.authorization).toBe("Bearer tok_123");
      // The server re-derives the reduced frequency — the client sends `{}` only,
      // NEVER a target daysPerWeek or a tenant/user id.
      const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
      expect(body).toEqual({});
      expect(body).not.toHaveProperty("daysPerWeek");
      expect(body).not.toHaveProperty("tenantId");
    });

    it("maps a 409 no_adaptation (stale/recovered) to an error carrying the status", async () => {
      const res = await adaptPlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "no_adaptation" }, 409)),
      });
      expect(res).toEqual({
        kind: "error",
        message: "no_adaptation",
        status: 409,
      });
    });

    it("maps a 403 quota-exhausted to an error carrying the status and reason", async () => {
      const res = await adaptPlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(
          jsonResponse({ error: "member_allocation_exhausted" }, 403),
        ),
      });
      expect(res).toEqual({
        kind: "error",
        message: "member_allocation_exhausted",
        status: 403,
      });
    });

    it("maps a 404 (cross-tenant/unknown spec) to an error carrying the status", async () => {
      const res = await adaptPlan("spec_x", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "not_found" }, 404)),
      });
      expect(res).toEqual({ kind: "error", message: "not_found", status: 404 });
    });

    it("maps a 401 to a sessionExpired error", async () => {
      const res = await adaptPlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "unauthorized" }, 401)),
      });
      expect(res.kind === "error" && res.sessionExpired).toBe(true);
    });

    it("maps a missing planId on a 202 to no_plan_id", async () => {
      const res = await adaptPlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ status: "generating" }, 202)),
      });
      expect(res).toEqual({ kind: "error", message: "no_plan_id" });
    });

    it("maps a network throw to api_unreachable", async () => {
      const res = await adaptPlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(() => {
          throw new Error("offline");
        }),
      });
      expect(res).toEqual({ kind: "error", message: "api_unreachable" });
    });
  });

  describe("fetchDashboardSummary", () => {
    it("returns sessionExpired without fetching when no token is stored", async () => {
      const fetchImpl = vi.fn<FetchLike>();
      const res = await fetchDashboardSummary({
        getToken: async () => null,
        fetchImpl,
      });
      expect(res).toEqual({
        kind: "error",
        message: "no_session",
        sessionExpired: true,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("GETs /progress/dashboard and maps a 200 summary (incl. adaptation)", async () => {
      const fetchImpl = mockFetch(jsonResponse(lowSummary));
      const res = await fetchDashboardSummary({
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", summary: lowSummary });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/progress/dashboard");
      expect(init.method).toBe("GET");
      expect(init.headers.authorization).toBe("Bearer tok_123");
    });

    it("maps a 401 to a sessionExpired error", async () => {
      const res = await fetchDashboardSummary({
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "unauthorized" }, 401)),
      });
      expect(res.kind === "error" && res.sessionExpired).toBe(true);
    });

    it("maps a network throw to api_unreachable", async () => {
      const res = await fetchDashboardSummary({
        getToken: token,
        fetchImpl: mockFetch(() => {
          throw new Error("offline");
        }),
      });
      expect(res).toEqual({ kind: "error", message: "api_unreachable" });
    });

    it("maps a malformed 200 (not an object with streak) to invalid_response", async () => {
      const res = await fetchDashboardSummary({
        getToken: token,
        fetchImpl: mockFetch(jsonResponse(null)),
      });
      expect(res).toEqual({ kind: "error", message: "invalid_response" });
    });
  });
});
