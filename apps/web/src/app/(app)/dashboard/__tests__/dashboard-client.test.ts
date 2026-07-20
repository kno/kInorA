import { describe, it, expect, vi } from "vitest";
import type { DashboardSummaryDTO } from "@kinora/contracts";
import { fetchDashboardSummary } from "../dashboard-client";

/**
 * dashboard-client — server-only fetch for GET /progress/dashboard.
 * Mirrors history-client.ts's fetch/parse pattern.
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

const summary: DashboardSummaryDTO = {
  streak: 3,
  recentDailyCompletion: [false, false, false, false, true, true, true],
  weeklyCompleted: 2,
  weeklyPlanned: 5,
  weeklyRollup: [],
};

describe("fetchDashboardSummary", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchDashboardSummary(undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed summary on a 200 response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, summary));

    const result = await fetchDashboardSummary(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", summary });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/progress/dashboard",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a network failure to api_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await fetchDashboardSummary(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("maps a non-ok response to a bare error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "server_error" }));

    const result = await fetchDashboardSummary(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "server_error" });
  });

  it("maps a malformed payload to invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { not: "a summary" }));

    const result = await fetchDashboardSummary(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});
