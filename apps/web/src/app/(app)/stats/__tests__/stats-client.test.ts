import { describe, it, expect, vi } from "vitest";
import type { StatsSummaryDTO } from "@kinora/contracts";
import { fetchStatsSummary } from "../stats-client";

/**
 * stats-client — server-only fetch for GET /progress/stats.
 * Mirrors dashboard-client.ts's fetch/parse pattern.
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

const zeroKpi = { value: 0, deltaVsPreviousPeriod: null };
const summary: StatsSummaryDTO = {
  range: "month",
  totalVolumeKg: { value: 500, deltaVsPreviousPeriod: 12 },
  sessionCount: { value: 4, deltaVsPreviousPeriod: null },
  totalDurationMin: { value: 180, deltaVsPreviousPeriod: -5 },
  prCount: zeroKpi,
  volumeTrend: { current: [100, 200], previous: [80, 160] },
  muscleGroupDistribution: [],
  personalRecords: [],
};

describe("fetchStatsSummary", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchStatsSummary(undefined, "month", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed summary on a 200 response, passing range as a query param", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, summary));

    const result = await fetchStatsSummary(TOKEN, "week", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", summary });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/progress/stats?range=week",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a network failure to api_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await fetchStatsSummary(TOKEN, "month", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("maps a non-ok response to a bare error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "server_error" }));

    const result = await fetchStatsSummary(TOKEN, "month", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "server_error" });
  });

  it("maps a malformed payload to invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { not: "a summary" }));

    const result = await fetchStatsSummary(TOKEN, "month", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});
