import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingVisibilityDTO } from "@kinora/contracts";
import { getBillingVisibility } from "../billing-client";

const OPTIONS = { apiBaseUrl: "http://api.test" };
const TOKEN = "session-tok";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VISIBILITY: BillingVisibilityDTO = {
  billing: {
    tenantId: "tenant-1" as never,
    tier: "pro",
    status: "trialing",
    source: "system",
    trialStartedAt: "2026-06-28T00:00:00.000Z",
    trialEndsAt: "2026-07-28T00:00:00.000Z",
    activeOverrideEndsAt: null,
    updatedAt: "2026-06-28T00:00:00.000Z",
  },
  tenantUsage: [{ feature: "plan_generation", period: "2026-07", used: 3, limit: 1_000_000 }],
  memberUsage: [{ userId: "user-1" as never, feature: "plan_generation", period: "2026-07", used: 1, limit: 5 }],
};

describe("getBillingVisibility", () => {
  it("returns ok with the parsed BillingVisibilityDTO on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, VISIBILITY));

    const result = await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/billing/visibility",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(result).toEqual({ kind: "ok", data: VISIBILITY });
  });

  it("sends the bearer token in the authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, VISIBILITY));

    await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("returns no_session without calling fetch when no token is present", async () => {
    const fetchImpl = vi.fn();

    const result = await getBillingVisibility(undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns api_unreachable when fetch throws (offline)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("maps a non-2xx response to the server error code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "inactive_membership" }));

    const result = await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "inactive_membership" });
  });

  it("returns invalid_response when the payload does not match BillingVisibilityDTO", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true }));

    const result = await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });

  // FIX 6 (review correction): malformed usage rows must be rejected, not
  // silently rendered as "undefined/undefined used".
  it("returns invalid_response when a tenantUsage row is malformed (missing fields)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { ...VISIBILITY, tenantUsage: [{ feature: "plan_generation" }] }),
    );

    const result = await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });

  it("returns invalid_response when a memberUsage row has the wrong field types", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...VISIBILITY,
        memberUsage: [{ userId: "user-1", feature: "plan_generation", period: "2026-07", used: "1", limit: 5 }],
      }),
    );

    const result = await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });

  // FIX 4 (review correction): the SSR fetch must carry a timeout signal so a
  // hung API maps quickly to api_unreachable instead of stalling on undici's
  // ~300s default.
  it("passes an AbortSignal (timeout) on every request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, VISIBILITY));

    await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps an aborted/timed-out fetch to api_unreachable", async () => {
    const abortError = new DOMException("The operation was aborted.", "TimeoutError");
    const fetchImpl = vi.fn().mockRejectedValue(abortError);

    const result = await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  // -------------------------------------------------------------------------
  // #176 — billing-visibility read failures must be observable (structured
  // server-side log). Previously non-ok / unreachable / invalid-JSON responses
  // mapped silently to a typed Result with no telemetry. The token is NEVER
  // included in the logged payload.
  // -------------------------------------------------------------------------
  describe("read-failure telemetry (#176)", () => {
    const FAILURE_EVENT = "billing_visibility_read_failed";
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    function failureCalls() {
      return errorSpy.mock.calls.filter(
        ([obj]) => (obj as { event?: string })?.event === FAILURE_EVENT,
      );
    }

    it("logs a structured server_error telemetry event on a 5xx response", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: "upstream_down" }));

      const result = await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

      expect(result.kind).toBe("error");
      expect(console.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: FAILURE_EVENT, kind: "server_error", status: 503 }),
      );
    });

    it("logs an api_unreachable telemetry event when fetch throws", async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

      await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

      expect(console.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: FAILURE_EVENT, kind: "api_unreachable" }),
      );
    });

    it("logs an invalid_response telemetry event when the payload is malformed", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true }));

      await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

      expect(console.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: FAILURE_EVENT, kind: "invalid_response" }),
      );
    });

    it("does NOT log a failure telemetry event on the success path (200)", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, VISIBILITY));

      await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

      expect(failureCalls()).toHaveLength(0);
    });

    it("does NOT log a failure telemetry event on an expected 4xx business denial (403)", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "inactive_membership" }));

      const result = await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

      expect(result).toEqual({ kind: "error", message: "inactive_membership" });
      expect(failureCalls()).toHaveLength(0);
    });

    it("never includes the session token in the logged telemetry payload", async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

      await getBillingVisibility(TOKEN, { ...OPTIONS, fetchImpl });

      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(TOKEN);
    });
  });

  it("uses API_BASE_URL when no explicit API base is supplied", async () => {
    const previousBaseUrl = process.env.API_BASE_URL;
    process.env.API_BASE_URL = "http://env-api.test";
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, VISIBILITY));

    try {
      await getBillingVisibility(TOKEN, { fetchImpl });
      expect(fetchImpl).toHaveBeenCalledWith("http://env-api.test/billing/visibility", expect.any(Object));
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = previousBaseUrl;
      }
    }
  });
});
