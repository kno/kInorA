import { describe, expect, it, vi } from "vitest";
import {
  fetchUserPreferences,
  updateUserPreferences,
} from "../preferences-client.js";

const PREFERENCES = {
  userId: "user-1",
  defaultLocation: "gym" as const,
  defaultDuration: 45,
  defaultEquipment: ["barbell", "bench"],
};

function buildFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("fetchUserPreferences", () => {
  it("returns ok with the stored preferences", async () => {
    const fetchMock = buildFetch(200, PREFERENCES);

    const result = await fetchUserPreferences("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.preferences.defaultLocation).toBe("gym");
      expect(result.preferences.defaultDuration).toBe(45);
      expect(result.preferences.defaultEquipment).toEqual(["barbell", "bench"]);
    }
  });

  it("returns ok when the API responds with null/empty defaults", async () => {
    const fetchMock = buildFetch(200, {
      userId: "user-1",
      defaultLocation: null,
      defaultDuration: null,
      defaultEquipment: null,
    });

    const result = await fetchUserPreferences("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.preferences.defaultLocation).toBeNull();
      expect(result.preferences.defaultDuration).toBeNull();
      expect(result.preferences.defaultEquipment).toBeNull();
    }
  });

  it("returns error when the payload shape is invalid", async () => {
    const fetchMock = buildFetch(200, { nope: true });

    const result = await fetchUserPreferences("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});

describe("updateUserPreferences", () => {
  it("sends only non-null fields and preserves an empty equipment array", async () => {
    const fetchMock = buildFetch(200, {
      userId: "user-1",
      defaultLocation: null,
      defaultDuration: 30,
      defaultEquipment: [],
    });

    const result = await updateUserPreferences(
      "tok-1",
      {
        defaultLocation: null,
        defaultDuration: 30,
        defaultEquipment: [],
      },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result.kind).toBe("ok");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("defaultLocation");
    expect(body.defaultDuration).toBe(30);
    expect(body.defaultEquipment).toEqual([]);
  });

  it("returns validation_error without calling the API when duration is non-positive", async () => {
    const fetchMock = buildFetch(200, PREFERENCES);

    const result = await updateUserPreferences(
      "tok-1",
      {
        defaultLocation: "gym",
        defaultDuration: 0,
        defaultEquipment: null,
      },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result).toEqual({ kind: "validation_error", message: "invalid_default_duration" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
