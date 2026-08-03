import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearGymSlugConfigCache,
  isGymSlugConfigured,
  resolveHostRedirect,
} from "../host-guard";

/**
 * White-label host guard (16a-v3-gym-white-label). Mirrors the pure
 * `evaluateAuthGate` pattern: `resolveHostRedirect` is a pure, I/O-free
 * decision (fully unit-testable) and `isGymSlugConfigured` owns the single
 * cached, fail-open network lookup. No real network is ever hit — `fetch`
 * is stubbed.
 */

const APEX = "kinora.aitsai.com";

describe("resolveHostRedirect (pure decision)", () => {
  it("passes for the bare apex host (never redirects — would loop)", () => {
    expect(
      resolveHostRedirect({
        host: APEX,
        pathname: "/dashboard",
        search: "",
        apexHost: APEX,
        isConfigured: false,
      })
    ).toEqual({ kind: "pass" });
  });

  it("passes for www / localhost / unrelated hosts (no slug)", () => {
    for (const host of ["www." + APEX, "localhost", "localhost:3000", "example.com"]) {
      expect(
        resolveHostRedirect({
          host,
          pathname: "/",
          search: "",
          apexHost: APEX,
          isConfigured: false,
        })
      ).toEqual({ kind: "pass" });
    }
  });

  it("passes for a missing host header", () => {
    expect(
      resolveHostRedirect({
        host: null,
        pathname: "/",
        search: "",
        apexHost: APEX,
        isConfigured: false,
      })
    ).toEqual({ kind: "pass" });
  });

  it("redirects an unconfigured subdomain to the apex, preserving path + query", () => {
    expect(
      resolveHostRedirect({
        host: `unknown-gym.${APEX}`,
        pathname: "/plan/today",
        search: "?lang=es&foo=bar",
        apexHost: APEX,
        isConfigured: false,
      })
    ).toEqual({
      kind: "redirect",
      location: `https://${APEX}/plan/today?lang=es&foo=bar`,
    });
  });

  it("redirects to the apex root when path is '/' with no query", () => {
    expect(
      resolveHostRedirect({
        host: `unknown-gym.${APEX}`,
        pathname: "/",
        search: "",
        apexHost: APEX,
        isConfigured: false,
      })
    ).toEqual({ kind: "redirect", location: `https://${APEX}/` });
  });

  it("passes for a CONFIGURED subdomain (renders normally)", () => {
    expect(
      resolveHostRedirect({
        host: `downtown.${APEX}`,
        pathname: "/",
        search: "",
        apexHost: APEX,
        isConfigured: true,
      })
    ).toEqual({ kind: "pass" });
  });

  it("passes (fail-open) when configuration is 'unknown'", () => {
    expect(
      resolveHostRedirect({
        host: `downtown.${APEX}`,
        pathname: "/",
        search: "",
        apexHost: APEX,
        isConfigured: "unknown",
      })
    ).toEqual({ kind: "pass" });
  });
});

describe("isGymSlugConfigured (cached fail-open lookup)", () => {
  beforeEach(() => {
    __clearGymSlugConfigCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns true on HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200 })));
    expect(await isGymSlugConfigured("downtown")).toBe(true);
  });

  it("returns false on HTTP 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404 })));
    expect(await isGymSlugConfigured("unknown-gym")).toBe(false);
  });

  it("returns 'unknown' on a 500 (fail-open)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 500 })));
    expect(await isGymSlugConfigured("downtown")).toBe("unknown");
  });

  it("returns 'unknown' when fetch throws (fail-open)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    expect(await isGymSlugConfigured("downtown")).toBe("unknown");
  });

  it("calls the PUBLIC by-slug endpoint using API_BASE_URL", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await isGymSlugConfigured("downtown");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/public/branding/by-slug/downtown")
    );
  });

  it("caches a definitive 200 result — no second fetch within the TTL", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await isGymSlugConfigured("downtown")).toBe(true);
    expect(await isGymSlugConfigured("downtown")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches a definitive 404 result — no second fetch within the TTL", async () => {
    const fetchMock = vi.fn(async () => ({ status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await isGymSlugConfigured("unknown-gym")).toBe(false);
    expect(await isGymSlugConfigured("unknown-gym")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache an 'unknown' result — a follow-up call re-fetches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    expect(await isGymSlugConfigured("downtown")).toBe("unknown");
    expect(await isGymSlugConfigured("downtown")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-fetches once the cached entry has expired past the TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchMock = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await isGymSlugConfigured("downtown")).toBe(true);
    // Advance beyond the 5-minute TTL.
    vi.setSystemTime(300_001);
    expect(await isGymSlugConfigured("downtown")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
