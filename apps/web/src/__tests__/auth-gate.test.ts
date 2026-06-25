import { describe, it, expect } from "vitest";
import { evaluateAuthGate } from "../auth-gate";

describe("evaluateAuthGate", () => {
  it("allows the request through when a session cookie is present", () => {
    const result = evaluateAuthGate({
      cookieValue: "valid-session-token",
      pathname: "/dashboard",
      origin: "http://localhost:3000",
    });

    expect(result).toEqual({ kind: "pass" });
  });

  // Triangle: no cookie → redirect to login with `from` param
  it("redirects to /login with a from param when no session cookie is present", () => {
    const result = evaluateAuthGate({
      cookieValue: undefined,
      pathname: "/dashboard",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.location).toContain("/login");
    expect(result.location).toContain("from=%2Fdashboard");
  });

  // Triangle: empty-string cookie → redirect (treated as absent)
  it("redirects to /login when the session cookie is an empty string", () => {
    const result = evaluateAuthGate({
      cookieValue: "",
      pathname: "/plan",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.location).toContain("from=%2Fplan");
  });

  // Triangle: different protected paths preserved in from param
  it("preserves the original pathname in the from param for different protected routes", () => {
    const result = evaluateAuthGate({
      cookieValue: undefined,
      pathname: "/profile/settings",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.location).toContain("from=%2Fprofile%2Fsettings");
  });

  // Triangle: whitespace-only cookie → redirect
  it("redirects when the session cookie is only whitespace", () => {
    const result = evaluateAuthGate({
      cookieValue: "   ",
      pathname: "/dashboard",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("redirect");
  });
});

// --- 05b: hybrid 401/redirect based on request headers ---

describe("evaluateAuthGate with API/XHR header detection (05b)", () => {
  const baseInput = {
    cookieValue: undefined,
    pathname: "/dashboard",
    origin: "http://localhost:3000",
  };

  it("redirects to /login for HTML requests without API headers", () => {
    const result = evaluateAuthGate({
      ...baseInput,
      acceptHeader: "text/html,application/xhtml+xml",
      requestedWithHeader: null,
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.location).toContain("/login");
  });

  it("returns unauthorized for API requests with Accept: application/json", () => {
    const result = evaluateAuthGate({
      ...baseInput,
      acceptHeader: "application/json",
      requestedWithHeader: null,
    });

    expect(result).toEqual({ kind: "unauthorized" });
  });

  it("returns unauthorized for XHR requests with x-requested-with: XMLHttpRequest", () => {
    const result = evaluateAuthGate({
      ...baseInput,
      acceptHeader: null,
      requestedWithHeader: "XMLHttpRequest",
    });

    expect(result).toEqual({ kind: "unauthorized" });
  });

  // Triangle: Accept header containing application/json among other types
  it("returns unauthorized when Accept includes application/json among other types", () => {
    const result = evaluateAuthGate({
      ...baseInput,
      acceptHeader: "application/json, text/javascript, */*",
      requestedWithHeader: null,
    });

    expect(result).toEqual({ kind: "unauthorized" });
  });

  // Triangle: session present + API headers → pass (auth takes priority over 401)
  it("passes through when a session cookie is present, even with API headers", () => {
    const result = evaluateAuthGate({
      cookieValue: "valid-session-token",
      pathname: "/dashboard",
      origin: "http://localhost:3000",
      acceptHeader: "application/json",
      requestedWithHeader: "XMLHttpRequest",
    });

    expect(result).toEqual({ kind: "pass" });
  });

  // Triangle: no headers at all → redirect (backward compat with 05a)
  it("redirects to /login when no headers are provided", () => {
    const result = evaluateAuthGate(baseInput);

    expect(result.kind).toBe("redirect");
  });

  // Triangle: new protected routes from 06b scaffold — /stats
  it("redirects /stats to login when no session cookie is present", () => {
    const result = evaluateAuthGate({
      cookieValue: undefined,
      pathname: "/stats",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.location).toContain("from=%2Fstats");
  });

  // Triangle: new protected routes from 06b scaffold — /create-plan
  it("redirects /create-plan to login when no session cookie is present", () => {
    const result = evaluateAuthGate({
      cookieValue: undefined,
      pathname: "/create-plan",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.location).toContain("from=%2Fcreate-plan");
  });

  // Triangle: new protected routes from 06b scaffold — /exercises
  it("redirects /exercises to login when no session cookie is present", () => {
    const result = evaluateAuthGate({
      cookieValue: undefined,
      pathname: "/exercises",
      origin: "http://localhost:3000",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.location).toContain("from=%2Fexercises");
  });

  // Triangle: session present on new routes → pass
  it("allows /stats through when a session cookie is present", () => {
    const result = evaluateAuthGate({
      cookieValue: "valid-session-token",
      pathname: "/stats",
      origin: "http://localhost:3000",
    });

    expect(result).toEqual({ kind: "pass" });
  });

  // Triangle: session present on /create-plan with API headers → pass
  it("allows /create-plan through with session even with API headers", () => {
    const result = evaluateAuthGate({
      cookieValue: "valid-session-token",
      pathname: "/create-plan",
      origin: "http://localhost:3000",
      acceptHeader: "application/json",
    });

    expect(result).toEqual({ kind: "pass" });
  });
});
