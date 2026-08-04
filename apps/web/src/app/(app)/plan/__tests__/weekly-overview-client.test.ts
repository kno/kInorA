import { describe, it, expect, vi } from "vitest";
import type { WeeklyOverviewDTO } from "@kinora/contracts";
import { fetchWeeklyOverview } from "../weekly-overview-client";

/**
 * `fetchWeeklyOverview` backs the plan board's week strip. The behaviour
 * worth pinning is the request it builds (the optional `weekStart` query
 * param, correctly encoded) and its refusal to hand back a malformed
 * payload as if it were a real overview.
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

const overview = {
  weekStart: "2026-08-03",
  days: [],
} as unknown as WeeklyOverviewDTO;

describe("fetchWeeklyOverview", () => {
  it("requests the current week with no query param when weekStart is undefined", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, overview));

    const result = await fetchWeeklyOverview(TOKEN, undefined, {
      ...OPTIONS,
      fetchImpl,
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/progress/weekly-overview");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer session-tok",
    );
    expect(init.cache).toBe("no-store");
    expect(result).toEqual({ kind: "ok", overview });
  });

  it("appends weekStart as an encoded query param when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, overview));

    await fetchWeeklyOverview(TOKEN, "2026-08-03", { ...OPTIONS, fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe(
      "http://api.test/progress/weekly-overview?weekStart=2026-08-03",
    );
  });

  it("percent-encodes a weekStart containing URL-significant characters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, overview));

    await fetchWeeklyOverview(TOKEN, "2026-08-03&x=1", { ...OPTIONS, fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string];
    // The `&` must not be able to smuggle a second query parameter.
    expect(url).toBe(
      "http://api.test/progress/weekly-overview?weekStart=2026-08-03%26x%3D1",
    );
  });

  it("returns no_session without calling the API when the token is missing", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchWeeklyOverview(undefined, undefined, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a transport failure to api_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchWeeklyOverview(TOKEN, undefined, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("surfaces the API's error code on a non-ok response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchWeeklyOverview(TOKEN, undefined, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "forbidden" });
  });

  it("falls back to a generic message when a non-ok body carries no error code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));

    const result = await fetchWeeklyOverview(TOKEN, undefined, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({
      kind: "error",
      message: "fetch_weekly_overview_failed",
    });
  });

  it("rejects an ok response missing the days array", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { weekStart: "2026-08-03" }));

    const result = await fetchWeeklyOverview(TOKEN, undefined, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });

  it("rejects an ok response whose weekStart is not a string", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { weekStart: 20260803, days: [] }));

    const result = await fetchWeeklyOverview(TOKEN, undefined, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});
