import { describe, expect, it, vi } from "vitest";
import { getAuthIdentity, type FetchLike } from "../auth-identity";

const token = async () => "tok_123";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(response: Response | (() => Promise<Response>)): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(
    typeof response === "function" ? response : async () => response,
  );
}

describe("getAuthIdentity", () => {
  it("returns no_session when no token is stored, without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const res = await getAuthIdentity({ getToken: async () => null, fetchImpl });
    expect(res).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GETs /auth/identity with a Bearer token and returns tenantId/userId", async () => {
    const fetchImpl = mockFetch(jsonResponse({ tenantId: "t1", userId: "u1" }));
    const res = await getAuthIdentity({ getToken: token, apiBaseUrl: "http://api.test", fetchImpl });

    expect(res).toEqual({ kind: "ok", tenantId: "t1", userId: "u1" });
    const call = fetchImpl.mock.calls[0]!;
    expect(call[0]).toBe("http://api.test/auth/identity");
    const init = call[1] as { method: string; headers: Record<string, string> };
    expect(init.method).toBe("GET");
    expect(init.headers.authorization).toBe("Bearer tok_123");
  });

  it("maps a non-ok response to an error, without throwing", async () => {
    const res = await getAuthIdentity({
      getToken: token,
      fetchImpl: mockFetch(jsonResponse({ error: "unauthorized" }, 401)),
    });
    expect(res).toEqual({ kind: "error", message: "auth_identity_request_failed" });
  });

  it("maps a network throw to api_unreachable", async () => {
    const res = await getAuthIdentity({
      getToken: token,
      fetchImpl: mockFetch(() => {
        throw new Error("offline");
      }),
    });
    expect(res).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("maps a malformed 200 payload to invalid_response", async () => {
    const res = await getAuthIdentity({
      getToken: token,
      fetchImpl: mockFetch(jsonResponse({ nope: true })),
    });
    expect(res).toEqual({ kind: "error", message: "invalid_response" });
  });
});
