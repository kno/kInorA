import { describe, expect, it, vi } from "vitest";

const fetchClients = vi.fn();
const cookies = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => ((key: string) => ({
    "clients.accessRestrictedTitle": "Trainer access required",
    "clients.accessRestrictedBody": "This page is only available to trainer accounts.",
  })[key] ?? key),
}));

vi.mock("next/headers", () => ({ cookies: (...args: unknown[]) => cookies(...args) }));

vi.mock("../trainer-client", () => ({
  fetchClients: (...args: unknown[]) => fetchClients(...args),
}));

vi.mock("../actions", () => ({
  inviteClientAction: vi.fn(),
}));

import ClientsPage from "../page";

describe("ClientsPage", () => {
  it("renders the access-restricted message on a forbidden (non-trainer) response", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    fetchClients.mockResolvedValue({ kind: "forbidden" });

    const page = await ClientsPage();

    expect(JSON.stringify(page)).toContain("Trainer access required");
  });

  it("passes fetched clients to ClientListClient on success", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    fetchClients.mockResolvedValue({
      kind: "ok",
      clients: [{ clientUserId: "u1", email: "a@test.com", status: "active" }],
    });

    const page = await ClientsPage();

    expect(page.props.initialClients).toEqual([
      { clientUserId: "u1", email: "a@test.com", status: "active" },
    ]);
    expect(page.props.initialError).toBeNull();
  });

  it("passes a safe initial error when the fetch fails", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    fetchClients.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = await ClientsPage();

    expect(page.props.initialClients).toEqual([]);
    expect(page.props.initialError).toBe("api_unreachable");
  });
});
