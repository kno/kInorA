import { describe, it, expect } from "vitest";
import {
  resolveInitialRoute,
  shouldGuardRoute,
} from "../session-guard";

describe("resolveInitialRoute", () => {
  it("returns the main home route when a session token is present", () => {
    expect(resolveInitialRoute(true)).toBe("Home");
  });

  // Triangle: no token → login
  it("returns the login route when no session token is present", () => {
    expect(resolveInitialRoute(false)).toBe("Login");
  });
});

describe("shouldGuardRoute", () => {
  const protectedRoutes = ["Home", "Plan", "Profile"];

  it("allows access to a protected route when authenticated", () => {
    expect(shouldGuardRoute("Home", true, protectedRoutes)).toBe(false);
  });

  // Triangle: unauthenticated → guard blocks
  it("blocks access to a protected route when not authenticated", () => {
    expect(shouldGuardRoute("Home", false, protectedRoutes)).toBe(true);
  });

  // Triangle: auth pages never guarded
  it("never guards auth routes even when unauthenticated", () => {
    expect(shouldGuardRoute("Login", false, protectedRoutes)).toBe(false);
    expect(shouldGuardRoute("SignUp", false, protectedRoutes)).toBe(false);
  });

  // Triangle: different protected routes
  it("guards all listed protected routes when unauthenticated", () => {
    expect(shouldGuardRoute("Plan", false, protectedRoutes)).toBe(true);
    expect(shouldGuardRoute("Profile", false, protectedRoutes)).toBe(true);
  });
});
