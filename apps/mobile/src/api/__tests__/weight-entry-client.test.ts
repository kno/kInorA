import { describe, it, expect, vi } from "vitest";
import type { WeightEntryDTO } from "@kinora/contracts";
import { createWeightEntry, fetchWeightEntries } from "../weight-entry-client";

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

const entry: WeightEntryDTO = { id: "we_1", weightKg: 68, recordedAt: "2026-08-01T00:00:00.000Z" };

describe("weight-entry-client", () => {
  describe("fetchWeightEntries", () => {
    it("returns no_session without calling fetch when no token is stored", async () => {
      const fetchImpl = vi.fn();
      const res = await fetchWeightEntries({ getToken: async () => null, fetchImpl });
      expect(res).toEqual({ kind: "error", message: "no_session" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("GETs /weight-entries and maps a 200 list, newest-first order preserved", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ entries: [entry] }));
      const res = await fetchWeightEntries({
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", entries: [entry] });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/weight-entries");
      expect(init.method).toBe("GET");
      expect(init.headers.Authorization).toBe("Bearer tok_123");
    });
  });

  describe("createWeightEntry", () => {
    it("POSTs weightKg and maps a 201 response, including wasFirstEntry", async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ entry, wasFirstEntry: true }, 201),
      );
      const res = await createWeightEntry(
        { weightKg: 68 },
        { getToken: token, apiBaseUrl: "http://api.test", fetchImpl },
      );
      expect(res).toEqual({ kind: "ok", entry, wasFirstEntry: true });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/weight-entries");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body!)).toEqual({ weightKg: 68 });
    });

    it("maps a 422 for a non-positive weightKg to a validation_error carrying the API's error code", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ error: "invalid_weight_kg" }, 422));
      const res = await createWeightEntry({ weightKg: 0 }, { getToken: token, fetchImpl });
      expect(res).toEqual({ kind: "validation_error", message: "invalid_weight_kg" });
    });
  });
});
