import { describe, it, expect, vi } from "vitest";
import type { UserProfile } from "@kinora/contracts";
import { fetchUserProfile, updateUserProfile } from "../user-profile-client";

const token = async () => "tok_123";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function firstCall(fetchImpl: ReturnType<typeof vi.fn>) {
  const call = fetchImpl.mock.calls[0]!;
  return {
    url: call[0],
    init: call[1] as { method: string; headers: Record<string, string>; body?: string },
  };
}

const profile: UserProfile = {
  userId: "user_1",
  name: "Ada",
  goal: "strength",
  experienceLevel: "intermediate",
  selfDescribedSex: "female",
  heightCm: 172,
};

describe("user-profile-client", () => {
  describe("fetchUserProfile", () => {
    it("returns no_session without calling fetch when no token is stored", async () => {
      const fetchImpl = vi.fn();
      const res = await fetchUserProfile({ getToken: async () => null, fetchImpl });
      expect(res).toEqual({ kind: "error", message: "no_session" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("GETs /user-profile with a Bearer token and maps a 200 profile", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(profile));
      const res = await fetchUserProfile({
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", profile });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/user-profile");
      expect(init.method).toBe("GET");
      expect(init.headers.Authorization).toBe("Bearer tok_123");
    });

    it("surfaces a non-2xx response as an error", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ error: "boom" }, 500));
      const res = await fetchUserProfile({ getToken: token, fetchImpl });
      expect(res).toEqual({ kind: "error", message: "boom" });
    });
  });

  describe("updateUserProfile", () => {
    it("rejects a blank name at the edge without calling fetch", async () => {
      const fetchImpl = vi.fn();
      const res = await updateUserProfile(
        { name: "  ", goal: null, experienceLevel: null, selfDescribedSex: null, heightCm: null },
        { getToken: token, fetchImpl },
      );
      expect(res).toEqual({ kind: "validation_error", message: "name_required" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("PUTs the partial body, omitting null selectors, and round-trips the saved profile", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(profile));
      const res = await updateUserProfile(
        {
          name: "Ada",
          goal: "strength",
          experienceLevel: null,
          selfDescribedSex: "female",
          heightCm: 172,
        },
        { getToken: token, apiBaseUrl: "http://api.test", fetchImpl },
      );
      expect(res).toEqual({ kind: "ok", profile });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/user-profile");
      expect(init.method).toBe("PUT");
      const sent = JSON.parse(init.body!);
      expect(sent).toEqual({
        name: "Ada",
        goal: "strength",
        selfDescribedSex: "female",
        heightCm: 172,
      });
      expect(sent).not.toHaveProperty("experienceLevel");
    });

    it("maps a 422 to a validation_error carrying the API's error code, e.g. an invalid selfDescribedSex", async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ error: "invalid_self_described_sex" }, 422),
      );
      const res = await updateUserProfile(
        {
          name: "Ada",
          goal: null,
          experienceLevel: null,
          selfDescribedSex: "female",
          heightCm: null,
        },
        { getToken: token, fetchImpl },
      );
      expect(res).toEqual({
        kind: "validation_error",
        message: "invalid_self_described_sex",
      });
    });

    it("maps a 422 for a non-positive/out-of-range heightCm to a validation_error", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ error: "invalid_height_cm" }, 422));
      const res = await updateUserProfile(
        { name: "Ada", goal: null, experienceLevel: null, selfDescribedSex: null, heightCm: 0 },
        { getToken: token, fetchImpl },
      );
      expect(res).toEqual({ kind: "validation_error", message: "invalid_height_cm" });
    });
  });
});
