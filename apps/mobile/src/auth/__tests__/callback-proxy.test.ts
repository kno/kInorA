import { describe, it, expect, vi } from "vitest";
import { proxyMobileSocialCallback } from "../callback-proxy";

function fakeJsonResponse(init: {
  ok?: boolean;
  status?: number;
  jsonValue?: unknown;
} = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => init.jsonValue ?? {},
  } as unknown as Response;
}

describe("proxyMobileSocialCallback", () => {
  it("POSTs code+state to the API social callback and returns the token on success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        fakeJsonResponse({ jsonValue: { token: "mobile-session-tok" } })
      );

    const result = await proxyMobileSocialCallback("the-code", "the-state", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(result).toEqual({ kind: "ok", token: "mobile-session-tok" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/social/callback");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      code: "the-code",
      state: "the-state",
    });
  });

  // Triangle: API failure
  it("returns an error when the API callback fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeJsonResponse({
        ok: false,
        status: 400,
        jsonValue: { error: "unverified_email" },
      })
    );

    const result = await proxyMobileSocialCallback("c", "s", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(result).toEqual({ kind: "error", message: "unverified_email" });
  });

  // Triangle: fetch throws
  it("returns api_unreachable when fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await proxyMobileSocialCallback("c", "s", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  // Triangle: 200 but no token
  it("returns no_session when the API succeeds but returns no token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeJsonResponse({ jsonValue: {} })
    );

    const result = await proxyMobileSocialCallback("c", "s", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(result).toEqual({ kind: "error", message: "no_session" });
  });
});
