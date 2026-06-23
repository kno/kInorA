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
