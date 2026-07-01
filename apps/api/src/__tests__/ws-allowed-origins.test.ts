/**
 * Tests for resolveWsAllowedOrigins — the source of truth for the WS CSWSH
 * Origin allowlist (issue #42 hardening review).
 *
 * Priority: WS_ALLOWED_ORIGINS (comma-separated) wins; else WEB_PUBLIC_ORIGIN
 * (the app's canonical web origin, reused from social-redirect config); else
 * empty (fail-closed for browsers).
 */
import { describe, it, expect } from "vitest";
import { resolveWsAllowedOrigins } from "../app.js";

describe("resolveWsAllowedOrigins", () => {
  it("falls back to WEB_PUBLIC_ORIGIN when WS_ALLOWED_ORIGINS is unset", () => {
    const result = resolveWsAllowedOrigins({
      WEB_PUBLIC_ORIGIN: "https://app.kinora.io",
    } as NodeJS.ProcessEnv);
    expect(result).toEqual(["https://app.kinora.io"]);
  });

  it("prefers WS_ALLOWED_ORIGINS (comma-separated) over WEB_PUBLIC_ORIGIN", () => {
    const result = resolveWsAllowedOrigins({
      WEB_PUBLIC_ORIGIN: "https://app.kinora.io",
      WS_ALLOWED_ORIGINS: "https://app.kinora.io, https://staging.kinora.io",
    } as NodeJS.ProcessEnv);
    expect(result).toEqual([
      "https://app.kinora.io",
      "https://staging.kinora.io",
    ]);
  });

  it("trims blanks and drops empty entries in WS_ALLOWED_ORIGINS", () => {
    const result = resolveWsAllowedOrigins({
      WS_ALLOWED_ORIGINS: " https://a.io ,, https://b.io ,",
    } as NodeJS.ProcessEnv);
    expect(result).toEqual(["https://a.io", "https://b.io"]);
  });

  it("returns an empty list (fail-closed for browsers) when neither var is set", () => {
    const result = resolveWsAllowedOrigins({} as NodeJS.ProcessEnv);
    expect(result).toEqual([]);
  });

  it("treats an all-whitespace WEB_PUBLIC_ORIGIN as unset", () => {
    const result = resolveWsAllowedOrigins({
      WEB_PUBLIC_ORIGIN: "   ",
    } as NodeJS.ProcessEnv);
    expect(result).toEqual([]);
  });
});
