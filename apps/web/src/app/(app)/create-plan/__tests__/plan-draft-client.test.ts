import { describe, expect, it, vi } from "vitest";
import type { PlanSpec } from "@kinora/contracts";
import {
  submitDraft,
  promotePlanSpec,
} from "../plan-draft-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("submitDraft", () => {
  it("POSTs the step and spec with a Bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { step: 2, spec: {} }));
    const spec: Partial<PlanSpec> = { goal: "strength" };

    const result = await submitDraft(2, spec, "tok-123", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(result.kind).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/plan-specs/drafts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer tok-123",
          "content-type": "application/json",
        }),
        body: JSON.stringify({ step: 2, spec }),
      }),
    );
  });

  it("returns an error when the API rejects the draft", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));
    const result = await submitDraft(1, {}, "tok", { fetchImpl });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("unauthorized");
    }
  });

  it("returns an error when there is no session token", async () => {
    const fetchImpl = vi.fn();
    const result = await submitDraft(1, {}, undefined, { fetchImpl });
    expect(result.kind).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("promotePlanSpec", () => {
  it("POSTs to /plan-specs with the Bearer token and returns the new id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { id: "spec-1", spec: {} }));

    const result = await promotePlanSpec("tok-9", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.id).toBe("spec-1");
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/plan-specs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer tok-9" }),
      }),
    );
  });

  it("returns an incomplete error on a 409 response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { error: "incomplete_spec" }));
    const result = await promotePlanSpec("tok", { fetchImpl });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("incomplete_spec");
    }
  });

  it("returns an error when there is no session token", async () => {
    const fetchImpl = vi.fn();
    const result = await promotePlanSpec(undefined, { fetchImpl });
    expect(result.kind).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
