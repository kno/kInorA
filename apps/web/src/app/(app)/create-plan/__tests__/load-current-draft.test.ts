import { describe, expect, it, vi } from "vitest";
import { loadCurrentDraft } from "../plan-draft-client";

function jsonResponse(status: number, body?: unknown): Response {
  if (status === 204) {
    return new Response(null, { status: 204 });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("loadCurrentDraft", () => {
  it("returns the draft when the API has one", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { step: 3, spec: { goal: "strength" } }));

    const draft = await loadCurrentDraft("tok", {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(draft).toEqual({ step: 3, spec: { goal: "strength" } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/plan-specs/drafts/current",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer tok" }),
      }),
    );
  });

  it("returns null when the API responds 204 (no draft)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(204));
    const draft = await loadCurrentDraft("tok", { fetchImpl });
    expect(draft).toBeNull();
  });

  it("returns null when there is no session token", async () => {
    const fetchImpl = vi.fn();
    const draft = await loadCurrentDraft(undefined, { fetchImpl });
    expect(draft).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when the API call fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    const draft = await loadCurrentDraft("tok", { fetchImpl });
    expect(draft).toBeNull();
  });
});
