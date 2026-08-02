import { describe, it, expect, vi } from "vitest";
import { fetchLogs } from "../logs-client.js";

const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";

function buildFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("fetchLogs", () => {
  it("returns ok with events + nextCursor on 200", async () => {
    const body = {
      events: [
        {
          id: "e1",
          tenantId: TENANT_ID,
          actorUserId: "u1",
          level: "info",
          event: "plan.generated",
          outcome: "success",
          metadata: { planId: "p1" },
          createdAt: "2026-07-30T10:00:00.000Z",
        },
      ],
      nextCursor: "cursor-2",
    };
    const result = await fetchLogs(
      "tok",
      {},
      { apiBaseUrl: "http://api", fetchImpl: buildFetch(200, body) as never },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.event).toBe("plan.generated");
      expect(result.nextCursor).toBe("cursor-2");
    }
  });

  it("returns ok with empty events and undefined nextCursor when the API omits them", async () => {
    const result = await fetchLogs(
      "tok",
      {},
      { apiBaseUrl: "http://api", fetchImpl: buildFetch(200, {}) as never },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.events).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    }
  });

  it("maps 401 → unauthorized, 403 → forbidden, 422 → invalid, other → error", async () => {
    expect(
      (
        await fetchLogs("t", {}, { apiBaseUrl: "http://api", fetchImpl: buildFetch(401, {}) as never })
      ).kind,
    ).toBe("unauthorized");
    expect(
      (
        await fetchLogs("t", {}, { apiBaseUrl: "http://api", fetchImpl: buildFetch(403, {}) as never })
      ).kind,
    ).toBe("forbidden");
    expect(
      (
        await fetchLogs("t", {}, { apiBaseUrl: "http://api", fetchImpl: buildFetch(422, {}) as never })
      ).kind,
    ).toBe("invalid");
    const err = await fetchLogs("t", {}, {
      apiBaseUrl: "http://api",
      fetchImpl: buildFetch(500, {}) as never,
    });
    expect(err.kind).toBe("error");
    if (err.kind === "error") expect(err.message).toBe("api_error_500");
  });

  it("returns error when fetch throws (api unreachable)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await fetchLogs("t", {}, {
      apiBaseUrl: "http://api",
      fetchImpl: fetchImpl as never,
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toBe("api_unreachable");
  });

  it("sends the Bearer token and hits /admin/logs with no query when filters are empty", async () => {
    const fetchMock = buildFetch(200, { events: [] });
    await fetchLogs("my-token", {}, {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/admin/logs");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-token");
  });

  it("builds the querystring from the filters, omitting empty params and URL-encoding", async () => {
    const fetchMock = buildFetch(200, { events: [] });
    await fetchLogs(
      "tok",
      {
        tenantId: TENANT_ID,
        level: "error",
        event: "plan generated",
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-31T00:00:00.000Z",
        limit: 50,
        cursor: "c/1",
        // empty values must be omitted
      },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      `http://api/admin/logs?tenantId=${TENANT_ID}` +
        `&level=error` +
        `&event=plan+generated` +
        `&from=2026-07-01T00%3A00%3A00.000Z` +
        `&to=2026-07-31T00%3A00%3A00.000Z` +
        `&limit=50` +
        `&cursor=c%2F1`,
    );
  });

  it("omits blank string filters", async () => {
    const fetchMock = buildFetch(200, { events: [] });
    await fetchLogs(
      "tok",
      { tenantId: "", event: "   ", level: "warn", cursor: "" },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://api/admin/logs?level=warn");
  });
});
