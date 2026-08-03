import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOwnBranding } from "../gym-branding-client";

/**
 * 16a-v3-gym-white-label, Slice 5 — server-side fetch of the AUTHENTICATED
 * S3 `GET /branding` endpoint. Mocks `fetch`; never hits a real API.
 *
 * The result is a discriminated union (not a fail-safe-to-null value) so
 * the `(app)` layout can tell a NON-gym tenant (403 → "forbidden") apart
 * from a gym tenant with no branding row yet (404 → "not_found") — both
 * cases fall back to default branding styling, but ONLY the former means
 * the tenant is not gym-tier (nav entry GH #322).
 */
describe("fetchOwnBranding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an ok result with the caller's own-tenant branding payload, authenticated via Bearer token", async () => {
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
      status: 200,
      json: async () => ({ logoUrl: "/media/branding/abc", palette }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchOwnBranding("session-token-123");

    expect(result).toEqual({
      kind: "ok",
      data: { logoUrl: "/media/branding/abc", palette },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/branding"),
      expect.objectContaining({
        headers: { Authorization: "Bearer session-token-123" },
      })
    );
  });

  it("returns a forbidden result when the tenant is not gym-entitled (403)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) }))
    );

    expect(await fetchOwnBranding("session-token-123")).toEqual({ kind: "forbidden" });
  });

  it("returns a not_found result when the gym tenant has no branding row yet (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "not_found" }) }))
    );

    expect(await fetchOwnBranding("session-token-123")).toEqual({ kind: "not_found" });
  });

  it("returns an error result on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    expect(await fetchOwnBranding("session-token-123")).toEqual({ kind: "error" });
  });

  it("returns an error result on a malformed payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    );

    expect(await fetchOwnBranding("session-token-123")).toEqual({ kind: "error" });
  });

  it("returns an error result on an unexpected non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    );

    expect(await fetchOwnBranding("session-token-123")).toEqual({ kind: "error" });
  });
});
