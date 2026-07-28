import { describe, it, expect, vi } from "vitest";
import {
  isTransientStatus,
  fetchWithTransientRetry,
} from "../retry-transient.js";

/** Minimal response shape the helper cares about. */
interface FakeResponse {
  status: number;
}

describe("isTransientStatus", () => {
  it("treats 429 and 503 as transient", () => {
    expect(isTransientStatus(429)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
  });

  it("also treats 500/502/504 as transient", () => {
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(502)).toBe(true);
    expect(isTransientStatus(504)).toBe(true);
  });

  it("does not treat 400/401/403/404/200 as transient", () => {
    expect(isTransientStatus(400)).toBe(false);
    expect(isTransientStatus(401)).toBe(false);
    expect(isTransientStatus(403)).toBe(false);
    expect(isTransientStatus(404)).toBe(false);
    expect(isTransientStatus(200)).toBe(false);
  });
});

describe("fetchWithTransientRetry", () => {
  it("503 then 200 → returns the 200 after 1 retry", async () => {
    const responses: FakeResponse[] = [{ status: 503 }, { status: 200 }];
    const doFetch = vi.fn(async () => responses.shift()!);

    const result = await fetchWithTransientRetry(doFetch, { backoffMs: [0, 0] });

    expect(result.status).toBe(200);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("429 twice then 200 → returns 200 after 2 retries", async () => {
    const responses: FakeResponse[] = [
      { status: 429 },
      { status: 429 },
      { status: 200 },
    ];
    const doFetch = vi.fn(async () => responses.shift()!);

    const result = await fetchWithTransientRetry(doFetch, { backoffMs: [0, 0] });

    expect(result.status).toBe(200);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it("503 on every attempt → returns the final failing response (no throw)", async () => {
    const doFetch = vi.fn(async (): Promise<FakeResponse> => ({ status: 503 }));

    const result = await fetchWithTransientRetry(doFetch, { backoffMs: [0, 0] });

    expect(result.status).toBe(503);
    // 1 initial attempt + 2 retries = 3 total calls.
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it("400 → returned immediately, no retry", async () => {
    const doFetch = vi.fn(async (): Promise<FakeResponse> => ({ status: 400 }));

    const result = await fetchWithTransientRetry(doFetch, { backoffMs: [0, 0] });

    expect(result.status).toBe(400);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("stops retrying once the signal aborts during backoff", async () => {
    const controller = new AbortController();
    const doFetch = vi.fn(async (): Promise<FakeResponse> => {
      if (doFetch.mock.calls.length === 1) {
        // Abort right after the first (transient) response comes back, while
        // the helper is about to sleep before the next attempt.
        controller.abort();
      }
      return { status: 503 };
    });

    const result = await fetchWithTransientRetry(doFetch, {
      backoffMs: [50, 50],
      signal: controller.signal,
    });

    expect(result.status).toBe(503);
    // Only the first attempt ran; the abort during backoff stopped retries.
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("defaults to 400ms/800ms backoff when none is provided", async () => {
    // Not exercised with real timers here — just assert the default export
    // constant matches the documented policy.
    const { DEFAULT_BACKOFF_MS } = await import("../retry-transient.js");
    expect(DEFAULT_BACKOFF_MS).toEqual([400, 800]);
  });
});
