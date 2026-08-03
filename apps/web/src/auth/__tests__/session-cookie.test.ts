import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sessionCookieOptions,
  shouldUseParentDomain,
} from "../session-cookie";

/**
 * Parent-domain session cookie logic (multi-tenant OAuth fix, part C).
 *
 * The session cookie must be shared across the apex and all gym subdomains in
 * production so the post-OAuth apex→subdomain redirect does not land the user
 * logged-out — but it must stay host-only on localhost, where a
 * `Domain=.kinora.aitsai.com` cookie is rejected by the browser and would
 * break local login.
 */
describe("shouldUseParentDomain", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false outside production (localhost dev safety)", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(shouldUseParentDomain("kinora.aitsai.com")).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(shouldUseParentDomain("kinora.aitsai.com")).toBe(false);
  });

  it("is false in production when the apex host is localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldUseParentDomain("localhost")).toBe(false);
    expect(shouldUseParentDomain("127.0.0.1")).toBe(false);
  });

  it("is false in production when the apex host has no dot (not a real domain)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldUseParentDomain("kinora")).toBe(false);
  });

  it("is true only in production with a real registrable apex domain", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldUseParentDomain("kinora.aitsai.com")).toBe(true);
  });
});

describe("sessionCookieOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits a host-only cookie (no Domain, not Secure) on localhost/non-prod", () => {
    vi.stubEnv("NODE_ENV", "test");
    const opts = sessionCookieOptions("kinora.aitsai.com");
    expect(opts.domain).toBeUndefined();
    expect(opts.secure).toBe(false);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("adds the parent Domain and Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const opts = sessionCookieOptions("kinora.aitsai.com");
    expect(opts.domain).toBe(".kinora.aitsai.com");
    expect(opts.secure).toBe(true);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
  });

  it("never sets Domain in production when served under localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    const opts = sessionCookieOptions("localhost");
    expect(opts.domain).toBeUndefined();
  });

  it("defaults the apex host from NEXT_PUBLIC_APEX_HOST", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APEX_HOST", "staging.kinora.aitsai.com");
    const opts = sessionCookieOptions();
    expect(opts.domain).toBe(".staging.kinora.aitsai.com");
  });
});
