import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProfile } from "../profile-client";

/**
 * Foundation for the admin backoffice access point (GH #306): the sidebar
 * profile fetch must thread `isAdmin` through so the layout can conditionally
 * render the Admin nav entry — without changing the existing fail-safe
 * behavior of `fetchProfile` (null on any failure).
 */
describe("fetchProfile — isAdmin threading (GH #306)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps isAdmin: true through from the API payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          email: "root@example.com",
          initials: "R",
          tenantName: "root's workspace",
          isAdmin: true,
        }),
      })),
    );

    const result = await fetchProfile("session-token-123");

    expect(result?.isAdmin).toBe(true);
  });

  it("maps isAdmin: false when the API payload says false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          email: "user@example.com",
          initials: "U",
          tenantName: "user's workspace",
          isAdmin: false,
        }),
      })),
    );

    const result = await fetchProfile("session-token-123");

    expect(result?.isAdmin).toBe(false);
  });

  it("defaults to isAdmin: false when the API payload omits the field (backward compatibility)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          email: "user@example.com",
          initials: "U",
          tenantName: "user's workspace",
        }),
      })),
    );

    const result = await fetchProfile("session-token-123");

    expect(result?.isAdmin).toBe(false);
  });
});
