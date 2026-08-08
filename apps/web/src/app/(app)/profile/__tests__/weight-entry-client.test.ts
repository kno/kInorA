import { describe, it, expect, vi } from "vitest";
import { fetchWeightEntries, createWeightEntry } from "../weight-entry-client.js";

const ENTRY = { id: "e-1", weightKg: 72.5, recordedAt: "2026-08-01T00:00:00.000Z" };

function buildFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("fetchWeightEntries", () => {
  it("returns error with no_session when no token is present", async () => {
    const result = await fetchWeightEntries(undefined);
    expect(result).toEqual({ kind: "error", message: "no_session" });
  });

  it("returns ok with the entries when the API responds 200", async () => {
    const fetchMock = buildFetch(200, { entries: [ENTRY] });

    const result = await fetchWeightEntries("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result).toEqual({ kind: "ok", entries: [ENTRY] });
  });

  it("returns error on a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await fetchWeightEntries("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("returns error on a non-2xx response", async () => {
    const fetchMock = buildFetch(500, { error: "internal" });

    const result = await fetchWeightEntries("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result).toEqual({ kind: "error", message: "internal" });
  });

  it("returns error on a malformed response body", async () => {
    const fetchMock = buildFetch(200, { entries: "not-an-array" });

    const result = await fetchWeightEntries("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});

describe("createWeightEntry", () => {
  it("returns error with no_session when no token is present", async () => {
    const result = await createWeightEntry(undefined, { weightKg: 72.5 });
    expect(result).toEqual({ kind: "error", message: "no_session" });
  });

  it("returns ok with the entry and wasFirstEntry when the API responds 201", async () => {
    const fetchMock = buildFetch(201, { entry: ENTRY, wasFirstEntry: true });

    const result = await createWeightEntry(
      "tok-1",
      { weightKg: 72.5 },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result).toEqual({ kind: "ok", entry: ENTRY, wasFirstEntry: true });
  });

  it("omits recordedAt from the request body when not supplied", async () => {
    const fetchMock = buildFetch(201, { entry: ENTRY, wasFirstEntry: false });

    await createWeightEntry(
      "tok-1",
      { weightKg: 72.5 },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(requestBody).toEqual({ weightKg: 72.5 });
  });

  it("includes recordedAt in the request body when supplied", async () => {
    const fetchMock = buildFetch(201, { entry: ENTRY, wasFirstEntry: false });

    await createWeightEntry(
      "tok-1",
      { weightKg: 72.5, recordedAt: "2026-01-01" },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(requestBody).toEqual({ weightKg: 72.5, recordedAt: "2026-01-01" });
  });

  it("returns validation_error on a 422, surfacing the API's error code", async () => {
    const fetchMock = buildFetch(422, { error: "invalid_weight_kg" });

    const result = await createWeightEntry(
      "tok-1",
      { weightKg: 0 },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result).toEqual({ kind: "validation_error", message: "invalid_weight_kg" });
  });

  it("returns error on a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await createWeightEntry(
      "tok-1",
      { weightKg: 72.5 },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("returns error on a non-2xx, non-422 response", async () => {
    const fetchMock = buildFetch(500, { error: "internal" });

    const result = await createWeightEntry(
      "tok-1",
      { weightKg: 72.5 },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result).toEqual({ kind: "error", message: "internal" });
  });

  it("returns error on a malformed 201 response body", async () => {
    const fetchMock = buildFetch(201, { entry: {} });

    const result = await createWeightEntry(
      "tok-1",
      { weightKg: 72.5 },
      { apiBaseUrl: "http://api", fetchImpl: fetchMock as never },
    );

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});
