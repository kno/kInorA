import { afterEach, describe, it, expect, vi } from "vitest";
import { apiBaseUrl } from "../stats-client.js";
import { fetchStats } from "../stats-client.js";
import type { PlatformStats } from "../stats-constants";

const SAMPLE: PlatformStats = {
  tenants: { total: 12, signups7d: 2, signups30d: 5 },
  users: { total: 40, signups7d: 6, signups30d: 15 },
  memberships: { activeByRole: { owner: 10, member: 25, trainer: 3 } },
  billing: {
    effectiveTier: { free: 6, pro: 4, trainer: 1, gym: 1 },
    activeStripeSubscriptions: 4,
    trials: 2,
    activeOverridesByTier: { free: 0, pro: 0, trainer: 1, gym: 1 },
  },
  usage: {
    thisPeriod: "2026-08",
    byFeature: { plan_generation: 30, plan_regeneration: 5, memory_write: 12, memory_retrieval: 8 },
  },
  observability: { errors24h: 1, events24h: 20 },
};

function buildFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("fetchStats", () => {
  it("returns ok with the parsed stats on 200", async () => {
    const result = await fetchStats("tok", {
      apiBaseUrl: "http://api",
      fetchImpl: buildFetch(200, SAMPLE) as never,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stats).toEqual(SAMPLE);
    }
  });

  it("maps 401 → unauthorized, 403 → forbidden, other → error", async () => {
    expect(
      (await fetchStats("t", { apiBaseUrl: "http://api", fetchImpl: buildFetch(401, {}) as never }))
        .kind,
    ).toBe("unauthorized");
    expect(
      (await fetchStats("t", { apiBaseUrl: "http://api", fetchImpl: buildFetch(403, {}) as never }))
        .kind,
    ).toBe("forbidden");
    const err = await fetchStats("t", {
      apiBaseUrl: "http://api",
      fetchImpl: buildFetch(500, {}) as never,
    });
    expect(err.kind).toBe("error");
    if (err.kind === "error") expect(err.message).toBe("api_error_500");
  });

  it("returns error when fetch throws (api unreachable)", async () => {
    const result = await fetchStats("t", {
      apiBaseUrl: "http://api",
      fetchImpl: vi.fn().mockRejectedValue(new Error("boom")) as never,
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toBe("api_unreachable");
  });

  it("sends the Bearer token and hits /admin/stats", async () => {
    const fetchMock = buildFetch(200, SAMPLE);
    await fetchStats("my-token", { apiBaseUrl: "http://api", fetchImpl: fetchMock as never });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/admin/stats");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-token");
  });
});

/**
 * `apiBaseUrl` resolves the API host for the platform stats client. Every other
 * test in this file injects an explicit base, so this is the only place the
 * real env-var resolution is exercised — and an unset API_BASE_URL in a
 * container silently pointing at localhost is a production failure mode.
 */

describe("apiBaseUrl", () => {
  const original = process.env.API_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = original;
  });

  it("uses API_BASE_URL when the deployment sets it", () => {
    process.env.API_BASE_URL = "http://api.internal:4000";
    expect(apiBaseUrl()).toBe("http://api.internal:4000");
  });

  it("falls back to the local dev API when API_BASE_URL is unset", () => {
    delete process.env.API_BASE_URL;
    expect(apiBaseUrl()).toBe("http://localhost:4000");
  });

  it("is read per call, so a late-injected env var still takes effect", () => {
    delete process.env.API_BASE_URL;
    expect(apiBaseUrl()).toBe("http://localhost:4000");
    process.env.API_BASE_URL = "http://api.other:4000";
    expect(apiBaseUrl()).toBe("http://api.other:4000");
  });
});
