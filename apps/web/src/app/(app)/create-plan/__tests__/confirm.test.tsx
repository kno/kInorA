/**
 * Tests for the confirm-plan client logic.
 *
 * The confirm flow is:
 *   POST /plan-specs/:specId/confirm → { planId, status: "generating" }
 *
 * The web client receives `specId` (from the prior promotePlanSpec response),
 * POSTs to confirm, and returns { planId, status } so the caller can navigate
 * to /plan/[planId].
 */
import { describe, expect, it, vi } from "vitest";
import { confirmPlanGen } from "../plan-draft-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("confirmPlanGen", () => {
  it("POSTs to /plan-specs/:id/confirm with Bearer token and returns { planId, status }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { planId: "plan-abc", status: "generating" }),
    );

    const result = await confirmPlanGen("spec-1", "tok-abc", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.planId).toBe("plan-abc");
      expect(result.status).toBe("generating");
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/plan-specs/spec-1/confirm",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer tok-abc",
          "content-type": "application/json",
        }),
      }),
    );
  });

  it("returns an error result when the API rejects (422 incomplete spec)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(422, { error: "incomplete_spec" }),
    );

    const result = await confirmPlanGen("spec-bad", "tok", { fetchImpl });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("incomplete_spec");
    }
  });

  it("returns an error when there is no session token", async () => {
    const fetchImpl = vi.fn();
    const result = await confirmPlanGen("spec-1", undefined, { fetchImpl });
    expect(result.kind).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns an error on 404 (cross-tenant spec not found)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(404, { error: "not_found" }),
    );

    const result = await confirmPlanGen("spec-other", "tok", { fetchImpl });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("not_found");
    }
  });

  it("returns an error when the network call throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network fail"));
    const result = await confirmPlanGen("spec-1", "tok", { fetchImpl });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("api_unreachable");
    }
  });
});
