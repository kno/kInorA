import { afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy, config } from "../proxy";
import { __clearGymSlugConfigCache } from "../host-guard";

/**
 * Build a NextRequest for a given URL/header/cookie combination, exercising
 * the proxy exactly as Next.js would invoke it per-request.
 */
function buildRequest(
  url: string,
  options?: { headers?: Record<string, string>; cookie?: string }
): NextRequest {
  const headers = { ...options?.headers };
  if (options?.cookie) headers.cookie = options.cookie;
  return new NextRequest(new URL(url, "https://kinora.example"), { headers });
}

describe("proxy — ?lang= header injection", () => {
  it("sets x-kinora-lang on the forwarded request headers when ?lang= is present", async () => {
    const response = await proxy(buildRequest("/?lang=es"));
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBe("es");
  });

  it("clears/omits x-kinora-lang when no ?lang= is present", async () => {
    const response = await proxy(buildRequest("/"));
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBeNull();
  });

  it("sets x-kinora-lang verbatim for an invalid ?lang= value (short-circuit to EN happens downstream)", async () => {
    const response = await proxy(buildRequest("/?lang=fr"));
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBe("fr");
  });

  it("deletes a client-supplied x-kinora-lang header when no ?lang= is present (anti-spoofing)", async () => {
    const response = await proxy(buildRequest("/", { headers: { "x-kinora-lang": "fr" } }));
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBeNull();
  });

  it("overrides a client-supplied x-kinora-lang header with the ?lang= value when both are present", async () => {
    const response = await proxy(
      buildRequest("/?lang=es", { headers: { "x-kinora-lang": "fr" } })
    );
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBe("es");
  });

  it("fails soft (no 500) and omits x-kinora-lang when ?lang= contains control chars", async () => {
    const request = buildRequest("/");
    request.nextUrl.searchParams.set("lang", "es\r\nX-Injected: 1");
    const response = await proxy(request);
    expect(response.status).not.toBe(500);
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBeNull();
  });

  it("excludes /_next/*, static assets, and /api/* from the matcher", () => {
    expect(config.matcher).toContain(
      "/((?!_next/|api/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|map|json|woff|woff2|ttf)$).*)"
    );
  });
});

describe("proxy — auth gate (unchanged behavior on protected paths)", () => {
  it("redirects to /login when a protected path has no session cookie", async () => {
    const response = await proxy(buildRequest("/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("returns 401 for an unauthenticated API/XHR request to a protected path", async () => {
    const response = await proxy(
      buildRequest("/plan", { headers: { accept: "application/json" } })
    );
    expect(response.status).toBe(401);
  });

  it("passes through (forwarding the lang header) when a session cookie is present on a protected path", async () => {
    const response = await proxy(
      buildRequest("/dashboard?lang=es", { cookie: "kinora_session=valid-token" })
    );
    expect(response.status).not.toBe(307);
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBe("es");
  });

  it("does not gate an unprotected path even without a session cookie", async () => {
    const response = await proxy(buildRequest("/login"));
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(401);
  });
});

describe("proxy — white-label host guard", () => {
  const APEX = "kinora.aitsai.com";

  afterEach(() => {
    vi.unstubAllGlobals();
    __clearGymSlugConfigCache();
  });

  it("307-redirects an UNCONFIGURED subdomain to the apex, preserving path + query", async () => {
    // 404 ⇒ not configured. No real network — fetch is stubbed.
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404 })));

    const response = await proxy(
      buildRequest("/plan?lang=es", { headers: { host: `unknown-gym.${APEX}` } })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://${APEX}/plan?lang=es`
    );
  });

  it("falls through for a CONFIGURED subdomain (existing lang behavior intact)", async () => {
    // 200 ⇒ configured.
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200 })));

    const response = await proxy(
      buildRequest("/?lang=es", { headers: { host: `downtown.${APEX}` } })
    );

    expect(response.status).not.toBe(307);
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBe("es");
  });

  it("NEVER redirects the apex host itself (no loop) — never touches the API", async () => {
    const fetchMock = vi.fn(async () => ({ status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxy(
      buildRequest("/", { headers: { host: APEX } })
    );

    expect(response.status).not.toBe(307);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails OPEN (no redirect) when the branding API errors on a subdomain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("api down");
      })
    );

    const response = await proxy(
      buildRequest("/", { headers: { host: `downtown.${APEX}` } })
    );

    expect(response.status).not.toBe(307);
  });
});
