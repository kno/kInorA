import { describe, it, expect } from "vitest";
import { resolveErrorRoute } from "../app.js";

/**
 * `resolveErrorRoute` backs the global error handler's `request.error`
 * observability event (#310 review fix). It must never let a query string
 * (potential token/id leakage) reach the persisted `route` field.
 */
describe("resolveErrorRoute", () => {
  it("prefers the matched route pattern when available", () => {
    expect(resolveErrorRoute("/plans/:id", "/plans/abc-123?foo=bar")).toBe("/plans/:id");
  });

  it("strips the query string from the raw URL fallback when no route matched", () => {
    expect(resolveErrorRoute(undefined, "/plans/abc-123?token=secret")).toBe("/plans/abc-123");
    expect(resolveErrorRoute(undefined, "/plans/abc-123?token=secret").includes("?")).toBe(false);
  });

  it("returns the raw URL unchanged when it has no query string", () => {
    expect(resolveErrorRoute(undefined, "/health")).toBe("/health");
  });
});
