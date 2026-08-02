import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOwnBranding } from "../gym-branding-client";

/**
 * 16a-v3-gym-white-label, Slice 5 — server-side fetch of the AUTHENTICATED
 * S3 `GET /branding` endpoint. Mocks `fetch`; never hits a real API. Fails
 * safe (returns null) on 403 (non-gym tenant) / 404 (no branding row yet) /
 * network error / malformed payload — the `(app)` layout falls back to
 * default branding on any of these.
 */
describe("fetchOwnBranding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the caller's own-tenant branding payload, authenticated via Bearer token", async () => {
    const palette = {
      accent: "#112233",
      accentFg: "#ffffff",
      surface: "#000000",
      surface2: "#111111",
      fg: "#eeeeee",
      muted: "#999999",
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ logoUrl: "/media/branding/abc", palette }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchOwnBranding("session-token-123");

    expect(result).toEqual({ logoUrl: "/media/branding/abc", palette });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/branding"),
      expect.objectContaining({
        headers: { Authorization: "Bearer session-token-123" },
      })
    );
  });

  it("returns null when the tenant is not gym-entitled (403)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "forbidden" }) }))
    );

    expect(await fetchOwnBranding("session-token-123")).toBeNull();
  });

  it("returns null when the gym tenant has no branding row yet (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "not_found" }) }))
    );

    expect(await fetchOwnBranding("session-token-123")).toBeNull();
  });

  it("returns null on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    expect(await fetchOwnBranding("session-token-123")).toBeNull();
  });

  it("returns null on a malformed payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    );

    expect(await fetchOwnBranding("session-token-123")).toBeNull();
  });
});
