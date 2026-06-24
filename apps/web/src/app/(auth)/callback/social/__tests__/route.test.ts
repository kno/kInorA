import { describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";
import { proxySocialCallback, SESSION_COOKIE } from "../callback-proxy";

function fakeJsonResponse(
  init: {
    ok?: boolean;
    status?: number;
    jsonValue?: unknown;
  } = {}
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => init.jsonValue ?? {},
  } as unknown as Response;
}

describe("social callback proxy", () => {
  it("proxies valid code+state to the API and redirects home with a session cookie", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeJsonResponse({ jsonValue: { token: "session-tok" } }));

    const res = await proxySocialCallback(
      new URLSearchParams({ code: "the-code", state: "the-state" }),
      { fetchImpl, apiBaseUrl: "http://api.test" }
    );

    expect(res.status).toBe(303);
    // Proxied to the social callback endpoint
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/social/callback");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      code: "the-code",
      state: "the-state",
    });
    // Redirects home (path-contains check — NextResponse.redirect emits a
    // fully-qualified Location).
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/\/$/);
    expect(location).not.toContain("login");
    // Session cookie set with the API-issued token
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("session-tok");
    // Cookie persists across browser restarts (positive maxAge, 7 days).
    expect(res.cookies.get(SESSION_COOKIE)?.maxAge).toBe(60 * 60 * 24 * 7);
    expect(res.cookies.get(SESSION_COOKIE)?.maxAge).toBeGreaterThan(0);
  });

  it("redirects to login with an error when the API responds ok but without a token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeJsonResponse({ ok: true, status: 200, jsonValue: {} }));

    const res = await proxySocialCallback(
      new URLSearchParams({ code: "the-code", state: "the-state" }),
      { fetchImpl, apiBaseUrl: "http://api.test" }
    );

    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("login");
    expect(location).toContain("error=missing_token");
    // No session cookie when there is no token.
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  // Triangle: missing params → error redirect, NO API call
  it("redirects to login with error=missing_params when code or state is absent", async () => {
    const fetchImpl = vi.fn();

    for (const params of [
      new URLSearchParams({ state: "s" }),
      new URLSearchParams({ code: "c" }),
      new URLSearchParams(),
    ]) {
      const res = await proxySocialCallback(params, { fetchImpl, apiBaseUrl: "http://api.test" });
      expect(res.status).toBe(303);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("login");
      expect(location).toContain("error=missing_params");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("redirects to login with the API error when the callback fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        fakeJsonResponse({
          ok: false,
          status: 400,
          jsonValue: { error: "Provider email is not verified" },
        })
      );

    const res = await proxySocialCallback(
      new URLSearchParams({ code: "c", state: "s" }),
      { fetchImpl, apiBaseUrl: "http://api.test" }
    );

    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("login");
    expect(location).toContain("error=Provider+email+is+not+verified");
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("redirects to login with api_unreachable when fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const res = await proxySocialCallback(
      new URLSearchParams({ code: "c", state: "s" }),
      { fetchImpl, apiBaseUrl: "http://api.test" }
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location") ?? "").toContain("error=api_unreachable");
  });
});

describe("apiBaseUrl default fallback", () => {
  it("uses process.env.API_BASE_URL when set", async () => {
    const prev = process.env.API_BASE_URL;
    process.env.API_BASE_URL = "http://custom.test";
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeJsonResponse({ jsonValue: { token: "t" } }));

    await proxySocialCallback(
      new URLSearchParams({ code: "c", state: "s" }),
      { fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://custom.test/auth/social/callback",
      expect.anything()
    );
    process.env.API_BASE_URL = prev;
  });

  it("falls back to http://localhost:4000 when API_BASE_URL is not set", async () => {
    const prev = process.env.API_BASE_URL;
    delete process.env.API_BASE_URL;
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeJsonResponse({ jsonValue: { token: "t" } }));

    await proxySocialCallback(
      new URLSearchParams({ code: "c", state: "s" }),
      { fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/auth/social/callback",
      expect.anything()
    );
    process.env.API_BASE_URL = prev;
  });
});

describe("GET route handler", () => {
  it("extracts searchParams from the request and delegates to proxySocialCallback", async () => {
    const { GET } = await import("../route");

    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeJsonResponse({ jsonValue: { token: "t" } }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;

    try {
      const request = {
        url: "http://localhost:3000/callback/social?code=c&state=s",
        nextUrl: { searchParams: new URLSearchParams({ code: "c", state: "s" }) },
      } as never;

      const res = await GET(request);
      expect(res.status).toBe(303);
      const location = res.headers.get("location") ?? "";
      expect(location).not.toContain("login");
      expect(
        (res.cookies as { get: (n: string) => { value: string } | undefined }).get("kinora_session")?.value
      ).toBe("t");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("redirects to login when params are missing via the handler", async () => {
    const { GET } = await import("../route");

    const origFetch = globalThis.fetch;

    try {
      const request = {
        url: "http://localhost:3000/callback/social",
        nextUrl: { searchParams: new URLSearchParams() },
      } as never;

      const res = await GET(request);
      expect(res.status).toBe(303);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("login");
      expect(location).toContain("error=missing_params");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// Keep the NextResponse import referenced for the type tree in this module.
void NextResponse;