import { describe, it, expect, vi } from "vitest";
import type { ClientSummaryDTO } from "@kinora/contracts";
import {
  createPlanForClient,
  fetchClientPlan,
  fetchClients,
  inviteClient,
  type CreatePlanForClientInput,
} from "../trainer-client";

/**
 * trainer-client — server-only fetch for the S3/S4 trainer routes.
 * Mirrors dashboard-client.test.ts's fetch/parse pattern.
 */

const OPTIONS = { apiBaseUrl: "http://api.test" };
const TOKEN = "session-tok";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const clients: ClientSummaryDTO[] = [
  { clientUserId: "user_1" as never, email: "client1@test.com", status: "active" },
];

describe("fetchClients", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchClients(undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed clients on a 200 response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, clients));

    const result = await fetchClients(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", clients });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/trainer/clients",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a 403 response to forbidden (non-trainer/non-entitled)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchClients(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("maps a network failure to api_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await fetchClients(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("maps a malformed payload to invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { not: "an array" }));

    const result = await fetchClients(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});

describe("inviteClient", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await inviteClient(undefined, "client@test.com", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs the email and returns ok on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { id: "a1" }));

    const result = await inviteClient(TOKEN, "client@test.com", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/trainer/clients/invite",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "client@test.com" }),
      }),
    );
  });

  it("maps a 409 (already assigned) to its error key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: "client_already_assigned" }));

    const result = await inviteClient(TOKEN, "client@test.com", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "client_already_assigned" });
  });
});

describe("createPlanForClient", () => {
  const input: CreatePlanForClientInput = {
    goal: "strength",
    daysPerWeek: 3,
    sessionDurationMinutes: 45,
    location: "gym",
    equipment: [],
    limitations: [],
  };

  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await createPlanForClient("user_1", input, undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs the spec to the client-owned route and returns the planId/status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { id: "spec_1", planId: "plan_1", status: "generating" }));

    const result = await createPlanForClient("user_1", input, TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", planId: "plan_1", status: "generating" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/clients/user_1/plan-specs",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
  });

  it("maps a 403 (no active assignment) to its error key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await createPlanForClient("user_1", input, TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "forbidden" });
  });
});

describe("fetchClientPlan (#341)", () => {
  const plan = {
    id: "plan_1",
    status: "ready",
    program: { weeklySessions: [], limitationWarnings: [] },
    specId: "spec_1",
    name: "Client plan",
  };

  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchClientPlan("user_1", "plan_1", undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GETs the trainer-scoped read route and returns the plan on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, plan));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", plan });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/clients/user_1/workout-plans/plan_1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("percent-encodes both path segments", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, plan));

    await fetchClientPlan("a/b", "c d", TOKEN, { ...OPTIONS, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/clients/a%2Fb/workout-plans/c%20d",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a 403 (not this client's trainer) to forbidden", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("maps a 404 to notFound, distinct from forbidden", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" }));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "notFound" });
  });

  it("maps any other non-ok status to a generic error — never to ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" }));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "boom" });
  });

  it("maps a network failure to api_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("rejects a 200 body without an id as invalid_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { status: "ready" }));

    const result = await fetchClientPlan("user_1", "plan_1", TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});
