import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy, config } from "../proxy";

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
  it("sets x-kinora-lang on the forwarded request headers when ?lang= is present", () => {
    const response = proxy(buildRequest("/?lang=es"));
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBe("es");
  });

  it("clears/omits x-kinora-lang when no ?lang= is present", () => {
    const response = proxy(buildRequest("/"));
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBeNull();
  });

  it("sets x-kinora-lang verbatim for an invalid ?lang= value (short-circuit to EN happens downstream)", () => {
    const response = proxy(buildRequest("/?lang=fr"));
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBe("fr");
  });

  it("deletes a client-supplied x-kinora-lang header when no ?lang= is present (anti-spoofing)", () => {
    const response = proxy(buildRequest("/", { headers: { "x-kinora-lang": "fr" } }));
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBeNull();
  });

  it("overrides a client-supplied x-kinora-lang header with the ?lang= value when both are present", () => {
    const response = proxy(
      buildRequest("/?lang=es", { headers: { "x-kinora-lang": "fr" } })
    );
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBe("es");
  });

  it("excludes /_next/*, static assets, and /api/* from the matcher", () => {
    expect(config.matcher).toContain(
      "/((?!_next/|api/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|map|json|woff|woff2|ttf)$).*)"
    );
  });
});

describe("proxy — auth gate (unchanged behavior on protected paths)", () => {
  it("redirects to /login when a protected path has no session cookie", () => {
    const response = proxy(buildRequest("/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("returns 401 for an unauthenticated API/XHR request to a protected path", () => {
    const response = proxy(
      buildRequest("/plan", { headers: { accept: "application/json" } })
    );
    expect(response.status).toBe(401);
  });

  it("passes through (forwarding the lang header) when a session cookie is present on a protected path", () => {
    const response = proxy(
      buildRequest("/dashboard?lang=es", { cookie: "kinora_session=valid-token" })
    );
    expect(response.status).not.toBe(307);
    expect(response.headers.get("x-middleware-request-x-kinora-lang")).toBe("es");
  });

  it("does not gate an unprotected path even without a session cookie", () => {
    const response = proxy(buildRequest("/login"));
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(401);
  });
});
