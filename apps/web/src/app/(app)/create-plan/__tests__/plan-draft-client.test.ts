import { describe, expect, it, vi } from "vitest";
import type { PlanSpec } from "@kinora/contracts";
import {
  submitDraft,
  promotePlanSpec,
  isSpecComplete,
  fetchUserPlans,
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

describe("isSpecComplete", () => {
  it("is true only when every required field is present", () => {
    expect(
      isSpecComplete({
        goal: "strength",
        location: "gym",
        daysPerWeek: 3,
        sessionDurationMinutes: 60,
        equipment: [],
        limitations: [],
      }),
    ).toBe(true);
  });

  it("is false when a required field is missing", () => {
    expect(
      isSpecComplete({ goal: "strength", location: "gym", daysPerWeek: 3 }),
    ).toBe(false);
  });
});

// saveDraftAction must send the raw partial spec unchanged — the server derives
// preferenceScores on promote. The client must NOT inject preferenceScores or
// confirmed into the draft body (web-side enrichment was a workaround that is
// architecturally wrong and has been removed).
describe("submitDraft — sends raw spec without client-side enrichment", () => {
  it("sends the spec exactly as provided (no preferenceScores injected)", async () => {
    const rawSpec: Partial<PlanSpec> = {
      goal: "strength",
      daysPerWeek: 3,
      sessionDurationMinutes: 60,
      location: "gym",
      equipment: ["barbell"],
      limitations: [{ text: "knee pain", isWarning: true }],
    };

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ step: 2, spec: rawSpec }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await submitDraft(2, rawSpec, "tok-abc", { fetchImpl, apiBaseUrl: "http://api.test" });

    const sentBody = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    // The spec sent to the API must NOT have preferenceScores or confirmed
    expect(sentBody.spec).not.toHaveProperty("preferenceScores");
    expect(sentBody.spec).not.toHaveProperty("confirmed");
    // All original fields must be preserved
    expect(sentBody.spec.goal).toBe("strength");
    expect(sentBody.spec.daysPerWeek).toBe(3);
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

describe("fetchUserPlans", () => {
  it("GETs /workout-plans with the Bearer token and returns plan summaries on 200", async () => {
    const summaries = [
      { id: "plan-1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" },
      { id: "plan-2", status: "generating", createdAt: "2026-06-28T09:00:00.000Z" },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(summaries), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await fetchUserPlans("tok-abc", { fetchImpl, apiBaseUrl: "http://api.test" });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.plans).toHaveLength(2);
      expect(result.plans[0]!.id).toBe("plan-1");
      expect(result.plans[0]!.status).toBe("ready");
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/workout-plans",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer tok-abc" }),
      })
    );
  });

  it("returns { kind: 'ok', plans: [] } when the user has no plans (empty array)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await fetchUserPlans("tok-abc", { fetchImpl, apiBaseUrl: "http://api.test" });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.plans).toHaveLength(0);
    }
  });

  it("returns an error when no token is provided", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchUserPlans(undefined, { fetchImpl });
    expect(result.kind).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns an error when the API returns 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await fetchUserPlans("tok", { fetchImpl });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("unauthorized");
    }
  });

  it("returns an error when the fetch itself throws (network unreachable)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Network error"));
    const result = await fetchUserPlans("tok", { fetchImpl });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("api_unreachable");
    }
  });
});
