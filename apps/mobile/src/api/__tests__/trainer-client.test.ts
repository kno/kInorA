import { describe, it, expect, vi } from "vitest";
import type { ClientSummaryDTO } from "@kinora/contracts";
import {
  createPlanForClient,
  fetchClients,
  inviteClient,
  type CreatePlanForClientInput,
  type FetchLike,
} from "../trainer-client";

const token = async () => "tok_123";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchMock = ReturnType<typeof vi.fn<FetchLike>>;

function mockFetch(response: Response | (() => Promise<Response>)): FetchMock {
  return vi.fn<FetchLike>(
    typeof response === "function" ? response : async () => response,
  );
}

const clients: ClientSummaryDTO[] = [
  { clientUserId: "user_1" as never, email: "client1@test.com", status: "active" },
];

describe("fetchClients", () => {
  it("returns no_session without calling fetch when no token is available", async () => {
    const fetchImpl = mockFetch(jsonResponse(clients));
    const result = await fetchClients({ fetchImpl, getToken: async () => null });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed clients on a 200 response", async () => {
    const fetchImpl = mockFetch(jsonResponse(clients));
    const result = await fetchClients({ fetchImpl, getToken: token, apiBaseUrl: "http://api.test" });

    expect(result).toEqual({ kind: "ok", clients });
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://api.test/trainer/clients");
  });

  it("maps a 403 to forbidden (non-trainer/non-entitled)", async () => {
    const fetchImpl = mockFetch(jsonResponse({ error: "forbidden" }, 403));
    const result = await fetchClients({ fetchImpl, getToken: token });

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("maps a network failure to api_unreachable", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("network down");
    });
    const result = await fetchClients({ fetchImpl, getToken: token });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });
});

describe("inviteClient", () => {
  it("POSTs the email and returns ok on success", async () => {
    const fetchImpl = mockFetch(jsonResponse({ id: "a1" }, 201));
    const result = await inviteClient("client@test.com", {
      fetchImpl,
      getToken: token,
      apiBaseUrl: "http://api.test",
    });

    expect(result).toEqual({ kind: "ok" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://api.test/trainer/clients/invite");
    expect(JSON.parse((init as { body: string }).body)).toEqual({ email: "client@test.com" });
  });

  it("maps a 409 (already assigned) to its error key", async () => {
    const fetchImpl = mockFetch(jsonResponse({ error: "client_already_assigned" }, 409));
    const result = await inviteClient("client@test.com", { fetchImpl, getToken: token });

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

  it("POSTs the spec to the client-owned route and returns planId/status", async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ id: "spec_1", planId: "plan_1", status: "generating" }, 201),
    );
    const result = await createPlanForClient("user_1", input, {
      fetchImpl,
      getToken: token,
      apiBaseUrl: "http://api.test",
    });

    expect(result).toEqual({ kind: "ok", planId: "plan_1", status: "generating" });
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://api.test/clients/user_1/plan-specs");
  });

  it("maps a 403 (no active assignment) to its error key", async () => {
    const fetchImpl = mockFetch(jsonResponse({ error: "forbidden" }, 403));
    const result = await createPlanForClient("user_1", input, { fetchImpl, getToken: token });

    expect(result).toEqual({ kind: "error", message: "forbidden" });
  });
});
