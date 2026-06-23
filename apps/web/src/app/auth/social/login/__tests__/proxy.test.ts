import { describe, it, expect, vi } from "vitest";
import { proxySocialLogin } from "../proxy";

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

describe("proxySocialLogin", () => {
  it("fetches the social login URL from the API and redirects to the authorization URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeJsonResponse({
        jsonValue: {
          authorizationUrl: "https://accounts.google.com/o/oauth2/auth?client_id=abc",
          state: "random-state",
        },
      })
    );

    const result = await proxySocialLogin("google", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.location).toBe("https://accounts.google.com/o/oauth2/auth?client_id=abc");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/social/login?provider=google");
    expect(init.method).toBe("GET");
  });

  // Triangle: missing provider → error redirect
  it("returns an error redirect when the provider query param is missing", async () => {
    const fetchImpl = vi.fn();

    const result = await proxySocialLogin("", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.location).toContain("/login");
    expect(result.location).toContain("error=missing_provider");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Triangle: API failure → error redirect
  it("redirects to login with the API error when the social login endpoint fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeJsonResponse({
        ok: false,
        status: 400,
        jsonValue: { error: "unknown_provider" },
      })
    );

    const result = await proxySocialLogin("github", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.location).toContain("error=unknown_provider");
  });

  // Triangle: fetch throws → api_unreachable
  it("redirects to login with api_unreachable when fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await proxySocialLogin("google", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.location).toContain("error=api_unreachable");
  });
});
