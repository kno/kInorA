import { describe, it, expect, vi } from "vitest";
import type { PlanSpecDraft } from "@kinora/contracts";
import {
  confirmPlan,
  getCurrentDraft,
  promoteDraft,
  saveDraft,
  type FetchLike,
} from "../plan-draft-client";

const token = async () => "tok_123";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A 204 No Content response (empty body). */
function noContent(): Response {
  return new Response(null, { status: 204 });
}

type FetchMock = ReturnType<typeof vi.fn<FetchLike>>;

/** Read the first fetch call with the concrete shapes this client sends. */
function firstCall(fetchImpl: FetchMock) {
  const call = fetchImpl.mock.calls[0]!;
  return {
    url: call[0],
    init: call[1] as {
      method: string;
      headers: Record<string, string>;
      body?: string;
    },
  };
}

function mockFetch(response: Response | (() => Promise<Response>)): FetchMock {
  return vi.fn<FetchLike>(
    typeof response === "function" ? response : async () => response,
  );
}

const draftSpec: PlanSpecDraft = {
  goal: "strength",
  daysPerWeek: 3,
  sessionDurationMinutes: 45,
  location: "gym",
};

describe("plan-draft-client", () => {
  describe("getCurrentDraft", () => {
    it("returns no_session error without calling fetch when no token is stored", async () => {
      const fetchImpl = vi.fn<FetchLike>();
      const res = await getCurrentDraft({
        getToken: async () => null,
        fetchImpl,
      });
      expect(res).toEqual({ kind: "error", message: "no_session" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("GETs /plan-specs/drafts/current with a Bearer token and maps a 200 draft", async () => {
      const fetchImpl = mockFetch(
        jsonResponse({ step: 2, spec: draftSpec }),
      );
      const res = await getCurrentDraft({
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", draft: { step: 2, spec: draftSpec } });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/plan-specs/drafts/current");
      expect(init.method).toBe("GET");
      expect(init.headers.authorization).toBe("Bearer tok_123");
    });

    it("maps a 204 (no current draft) to an empty result", async () => {
      const res = await getCurrentDraft({
        getToken: token,
        fetchImpl: mockFetch(noContent()),
      });
      expect(res).toEqual({ kind: "empty" });
    });

    it("defaults a missing spec to an empty draft object", async () => {
      const res = await getCurrentDraft({
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ step: 1 })),
      });
      expect(res).toEqual({ kind: "ok", draft: { step: 1, spec: {} } });
    });

    it("maps a malformed 200 (no numeric step) to invalid_response", async () => {
      const res = await getCurrentDraft({
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ nope: true })),
      });
      expect(res).toEqual({ kind: "error", message: "invalid_response" });
    });

    it("maps a network throw to api_unreachable", async () => {
      const res = await getCurrentDraft({
        getToken: token,
        fetchImpl: mockFetch(() => {
          throw new Error("offline");
        }),
      });
      expect(res).toEqual({ kind: "error", message: "api_unreachable" });
    });
  });

  describe("saveDraft", () => {
    it("returns no_session when no token is stored", async () => {
      const fetchImpl = vi.fn<FetchLike>();
      const res = await saveDraft(2, draftSpec, {
        getToken: async () => null,
        fetchImpl,
      });
      expect(res).toEqual({ kind: "error", message: "no_session" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("POSTs /plan-specs/drafts with the step + spec body and a Bearer token", async () => {
      const fetchImpl = mockFetch(jsonResponse({ step: 2, spec: draftSpec }));
      const res = await saveDraft(2, draftSpec, {
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", draft: { step: 2, spec: draftSpec } });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/plan-specs/drafts");
      expect(init.method).toBe("POST");
      expect(init.headers.authorization).toBe("Bearer tok_123");
      expect(init.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(init.body ?? "{}")).toEqual({ step: 2, spec: draftSpec });
    });

    it("never sends a tenant/user id in the body (tenant is derived from the Bearer token)", async () => {
      const fetchImpl = mockFetch(jsonResponse({ step: 1, spec: draftSpec }));
      await saveDraft(1, draftSpec, {
        getToken: token,
        fetchImpl,
      });
      const { init } = firstCall(fetchImpl);
      const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["spec", "step"]);
      expect(body).not.toHaveProperty("tenantId");
      expect(body).not.toHaveProperty("userId");
    });

    it("maps a non-ok response to a typed error using the server error key", async () => {
      const res = await saveDraft(1, draftSpec, {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "draft_save_failed" }, 400)),
      });
      expect(res).toEqual({ kind: "error", message: "draft_save_failed" });
    });

    it("maps a network throw to api_unreachable", async () => {
      const res = await saveDraft(1, draftSpec, {
        getToken: token,
        fetchImpl: mockFetch(() => {
          throw new Error("offline");
        }),
      });
      expect(res).toEqual({ kind: "error", message: "api_unreachable" });
    });
  });

  describe("promoteDraft", () => {
    it("returns no_session when no token is stored", async () => {
      const fetchImpl = vi.fn<FetchLike>();
      const res = await promoteDraft({
        getToken: async () => null,
        fetchImpl,
      });
      expect(res).toEqual({ kind: "error", message: "no_session" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("POSTs /plan-specs (server-authoritative draft) and returns the new spec id", async () => {
      const fetchImpl = mockFetch(jsonResponse({ id: "spec_1", spec: {} }, 201));
      const res = await promoteDraft({
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", id: "spec_1" });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/plan-specs");
      expect(init.method).toBe("POST");
      expect(init.headers.authorization).toBe("Bearer tok_123");
      // Promote is server-authoritative: it derives the spec from the stored
      // draft. The body carries no client spec (mirrors web's `{}`).
      expect(JSON.parse(init.body ?? "{}")).toEqual({});
    });

    it("maps a 409 (no active draft / incomplete spec) to a typed error", async () => {
      const res = await promoteDraft({
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "no_active_draft" }, 409)),
      });
      expect(res).toEqual({ kind: "error", message: "no_active_draft" });
    });

    it("maps a 201 without an id to no_spec_id", async () => {
      const res = await promoteDraft({
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ spec: {} }, 201)),
      });
      expect(res).toEqual({ kind: "error", message: "no_spec_id" });
    });
  });

  describe("confirmPlan", () => {
    it("returns no_session when no token is stored", async () => {
      const fetchImpl = vi.fn<FetchLike>();
      const res = await confirmPlan("spec_1", {
        getToken: async () => null,
        fetchImpl,
      });
      expect(res).toEqual({ kind: "error", message: "no_session" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("POSTs /plan-specs/:id/confirm and returns planId + status", async () => {
      const fetchImpl = mockFetch(
        jsonResponse({ planId: "plan_9", status: "generating" }),
      );
      const res = await confirmPlan("spec_1", {
        getToken: token,
        apiBaseUrl: "http://api.test",
        fetchImpl,
      });
      expect(res).toEqual({ kind: "ok", planId: "plan_9", status: "generating" });
      const { url, init } = firstCall(fetchImpl);
      expect(url).toBe("http://api.test/plan-specs/spec_1/confirm");
      expect(init.method).toBe("POST");
      expect(init.headers.authorization).toBe("Bearer tok_123");
      expect(JSON.parse(init.body ?? "{}")).toEqual({});
    });

    it("defaults a missing status to generating", async () => {
      const res = await confirmPlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ planId: "plan_9" })),
      });
      expect(res).toEqual({ kind: "ok", planId: "plan_9", status: "generating" });
    });

    it("maps a 403 (premium_required) to a typed error, NOT a session-expiry signal", async () => {
      const res = await confirmPlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "premium_required" }, 403)),
      });
      expect(res).toEqual({ kind: "error", message: "premium_required" });
    });

    it("maps a 200 without a planId to no_plan_id", async () => {
      const res = await confirmPlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ status: "generating" })),
      });
      expect(res).toEqual({ kind: "error", message: "no_plan_id" });
    });
  });

  // Requirement 6.3 — a 401/expired-session response surfaces a re-auth/logout
  // signal (`sessionExpired: true`) on the typed error, without crashing. The
  // caller (C2b screen) reacts by clearing the stored token and routing to Login,
  // mirroring the existing WorkoutTrackerScreen AUTH handling.
  describe("session-expiry signal (401)", () => {
    it("flags a 401 on getCurrentDraft as sessionExpired", async () => {
      const res = await getCurrentDraft({
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "unauthorized" }, 401)),
      });
      expect(res).toEqual({
        kind: "error",
        message: "unauthorized",
        sessionExpired: true,
      });
    });

    it("flags a 401 on saveDraft as sessionExpired", async () => {
      const res = await saveDraft(1, draftSpec, {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "unauthorized" }, 401)),
      });
      expect(res.kind === "error" && res.sessionExpired).toBe(true);
    });

    it("flags a 401 on promoteDraft as sessionExpired", async () => {
      const res = await promoteDraft({
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "unauthorized" }, 401)),
      });
      expect(res.kind === "error" && res.sessionExpired).toBe(true);
    });

    it("flags a 401 on confirmPlan as sessionExpired", async () => {
      const res = await confirmPlan("spec_1", {
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "unauthorized" }, 401)),
      });
      expect(res.kind === "error" && res.sessionExpired).toBe(true);
    });

    it("does NOT flag a non-401 error as sessionExpired", async () => {
      const res = await getCurrentDraft({
        getToken: token,
        fetchImpl: mockFetch(jsonResponse({ error: "boom" }, 500)),
      });
      expect(res.kind === "error" && res.sessionExpired).toBeUndefined();
    });
  });
});
