import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicBranding } from "../gym-branding-client";

/**
 * 16a-v3-gym-white-label, Slice 4 — server-side fetch of the S3 PUBLIC
 * read-by-slug endpoint. Mocks `fetch`; never hits a real API. Fails safe
 * (returns null) on 404 / network error / malformed payload — the login
 * page falls back to default branding on any of these.
 */
describe("fetchPublicBranding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the branding payload for a known slug", async () => {
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

    const result = await fetchPublicBranding("gymname");

    expect(result).toEqual({ logoUrl: "/media/branding/abc", palette });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/public/branding/by-slug/gymname")
    );
  });

  it("returns null on a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "not_found" }) }))
    );

    expect(await fetchPublicBranding("unknown-gym")).toBeNull();
  });

  it("returns null on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    expect(await fetchPublicBranding("gymname")).toBeNull();
  });

  it("returns null on a malformed payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    );

    expect(await fetchPublicBranding("gymname")).toBeNull();
  });
});
