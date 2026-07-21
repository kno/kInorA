import { describe, it, expect, vi } from "vitest";
import {
  fetchUserProfile,
  updateUserProfile,
  type GetProfileResult,
  type SaveProfileResult,
} from "../profile-form-client.js";

// --- Fixtures ---

const PROFILE = {
  userId: "user-1",
  name: "Ada Rivera",
  goal: "strength" as const,
  experienceLevel: "intermediate" as const,
};

function buildFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

// --- fetchUserProfile ---

describe("fetchUserProfile", () => {
  it("returns ok with the profile when the API responds 200", async () => {
    const fetchMock = buildFetch(200, PROFILE);

    const result = await fetchUserProfile("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.profile.name).toBe("Ada Rivera");
      expect(result.profile.goal).toBe("strength");
      expect(result.profile.experienceLevel).toBe("intermediate");
    }
  });

  it("returns ok when goal/experienceLevel are null (not chosen yet)", async () => {
    const fetchMock = buildFetch(200, { ...PROFILE, goal: null, experienceLevel: null });

    const result = await fetchUserProfile("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.profile.goal).toBeNull();
      expect(result.profile.experienceLevel).toBeNull();
    }
  });

  it("returns error 'no_session' when no token is supplied", async () => {
    const fetchMock = buildFetch(200, PROFILE);

    const result = await fetchUserProfile(undefined, {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toBe("no_session");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns error 'api_unreachable' when fetch throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await fetchUserProfile("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toBe("api_unreachable");
  });

  it("returns error with the API error code on a non-2xx response", async () => {
    const fetchMock = buildFetch(500, { error: "internal_error" });

    const result = await fetchUserProfile("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toBe("internal_error");
  });

  it("returns error 'invalid_response' when the body is not a profile", async () => {
    const fetchMock = buildFetch(200, { random: "shape" });

    const result = await fetchUserProfile("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toBe("invalid_response");
  });

  it("sends the Bearer token in the Authorization header on GET", async () => {
    const fetchMock = buildFetch(200, PROFILE);

    await fetchUserProfile("my-token", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/user-profile");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-token");
    expect(init.method).toBe("GET");
  });
});

// --- updateUserProfile ---

describe("updateUserProfile", () => {
  it("returns ok with the updated profile when the API responds 200", async () => {
    const fetchMock = buildFetch(200, { ...PROFILE, name: "Ada R." });

    const result = await updateUserProfile(
      "tok-1",
      { name: "Ada R.", goal: "strength", experienceLevel: "intermediate" },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.profile.name).toBe("Ada R.");
  });

  it("returns validation_error when the API responds 422", async () => {
    const fetchMock = buildFetch(422, { error: "name_required" });

    // A valid-looking input reaches the API, which replies 422 (e.g. a stale
    // enum value); the client maps it to validation_error with the API code.
    const result = await updateUserProfile(
      "tok-1",
      { name: "Ada", goal: "strength", experienceLevel: null },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result.kind).toBe("validation_error");
    if (result.kind === "validation_error") expect(result.message).toBe("name_required");
  });

  it("returns validation_error 'name_required' without calling the API when name is blank", async () => {
    const fetchMock = buildFetch(200, PROFILE);

    const result = await updateUserProfile(
      "tok-1",
{ name: "   ", goal: null, experienceLevel: null },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result.kind).toBe("validation_error");
    if (result.kind === "validation_error") expect(result.message).toBe("name_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns error 'no_session' when no token is supplied", async () => {
    const fetchMock = buildFetch(200, PROFILE);

    const result = await updateUserProfile(
      undefined,
      { name: "Ada", goal: null, experienceLevel: null },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toBe("no_session");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns error 'api_unreachable' when fetch throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await updateUserProfile(
      "tok-1",
      { name: "Ada", goal: null, experienceLevel: null },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toBe("api_unreachable");
  });

  it("sends PUT with name, goal and experienceLevel in the JSON body", async () => {
    const fetchMock = buildFetch(200, PROFILE);

    await updateUserProfile(
      "tok-1",
      { name: "Ada", goal: "hypertrophy", experienceLevel: "advanced" },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/user-profile");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-1");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.name).toBe("Ada");
    expect(body.goal).toBe("hypertrophy");
    expect(body.experienceLevel).toBe("advanced");
  });

  it("omits goal/experienceLevel from the body when they are null (preserve stored)", async () => {
    const fetchMock = buildFetch(200, PROFILE);

    await updateUserProfile(
      "tok-1",
      { name: "Ada", goal: null, experienceLevel: null },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(body.name).toBe("Ada");
    expect(body).not.toHaveProperty("goal");
    expect(body).not.toHaveProperty("experienceLevel");
  });
});

// --- Compile-time discriminated-union sanity (no runtime effect) ---

describe("result types", () => {
  it("narrowing on kind exposes the right fields", () => {
    const ok: GetProfileResult = { kind: "ok", profile: PROFILE };
    const err: GetProfileResult = { kind: "error", message: "x" };
    if (ok.kind === "ok") expect(ok.profile.name).toBe("Ada Rivera");
    if (err.kind === "error") expect(err.message).toBe("x");

    const saved: SaveProfileResult = { kind: "ok", profile: PROFILE };
    const ve: SaveProfileResult = { kind: "validation_error", message: "name_required" };
    const se: SaveProfileResult = { kind: "error", message: "api_unreachable" };
    if (saved.kind === "ok") expect(saved.profile.name).toBeDefined();
    if (ve.kind === "validation_error") expect(ve.message).toContain("name");
    if (se.kind === "error") expect(se.message).toBe("api_unreachable");
  });
});