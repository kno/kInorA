import { describe, expect, it } from "vitest";
import { isActivePath } from "../nav-utils";

describe("isActivePath", () => {
  it("matches an exact path", () => {
    expect(isActivePath("/plan", "/plan")).toBe(true);
    expect(isActivePath("/dashboard", "/dashboard")).toBe(true);
  });

  it("treats a nested dashboard route as active", () => {
    expect(isActivePath("/dashboard/workout/123", "/dashboard")).toBe(true);
  });

  it("treats a nested plan route as active", () => {
    expect(isActivePath("/plan/week-1", "/plan")).toBe(true);
  });

  it("does NOT activate plan for a sibling prefix without a slash boundary", () => {
    // "/planning" shares the "/plan" prefix but is a different route.
    expect(isActivePath("/planning", "/plan")).toBe(false);
  });

  it("does NOT activate dashboard for a sibling prefix without a slash boundary", () => {
    expect(isActivePath("/dashboards", "/dashboard")).toBe(false);
  });

  it("does not activate an unrelated path", () => {
    expect(isActivePath("/stats", "/plan")).toBe(false);
  });
});
