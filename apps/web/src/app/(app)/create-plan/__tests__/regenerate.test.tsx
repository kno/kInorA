/**
 * Tests for the regeneratePlan client function.
 *
 * POST /plan-specs/:specId/regenerate → 202 { planId, status: "generating" }
 *
 * This does NOT delete prior rows — the API creates a new generating row.
 * The prior failed/stuck row is retained for audit.
 */
import { describe, expect, it, vi } from "vitest";
import { regeneratePlan } from "../plan-draft-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("regeneratePlan", () => {
  it("POSTs to /plan-specs/:id/regenerate and returns { planId, status: generating }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(202, { planId: "plan-xyz", status: "generating" }),
    );

    const result = await regeneratePlan("spec-1", "tok-abc", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.planId).toBe("plan-xyz");
      expect(result.status).toBe("generating");
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/plan-specs/spec-1/regenerate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer tok-abc",
          "content-type": "application/json",
        }),
      }),
    );
  });

  it("returns an error when the spec is not yet confirmed (422)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(422, { error: "unconfirmed_spec" }),
    );

    const result = await regeneratePlan("spec-draft", "tok", { fetchImpl });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("unconfirmed_spec");
    }
  });

  it("returns an error when there is no session token", async () => {
    const fetchImpl = vi.fn();
    const result = await regeneratePlan("spec-1", undefined, { fetchImpl });
    expect(result.kind).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns an error on 404 (cross-tenant spec not found)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(404, { error: "not_found" }),
    );

    const result = await regeneratePlan("spec-other", "tok", { fetchImpl });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("not_found");
    }
  });

  it("returns an error when the network call throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network fail"));
    const result = await regeneratePlan("spec-1", "tok", { fetchImpl });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("api_unreachable");
    }
  });
});
