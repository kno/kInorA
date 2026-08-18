import { afterEach, describe, expect, it, vi } from "vitest";

const fetchClients = vi.fn();
const cookies = vi.fn();
const getClientDashboardAction = vi.fn();
const getClientProgressStatsAction = vi.fn();
const getClientExerciseDetailAction = vi.fn();
const getClientWeeklyOverviewAction = vi.fn();

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
  getClientDashboardAction: (...args: unknown[]) => getClientDashboardAction(...args),
  getClientProgressStatsAction: (...args: unknown[]) => getClientProgressStatsAction(...args),
  getClientExerciseDetailAction: (...args: unknown[]) => getClientExerciseDetailAction(...args),
  getClientWeeklyOverviewAction: (...args: unknown[]) => getClientWeeklyOverviewAction(...args),
}));

import ClientsPage from "../page";

function searchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

describe("ClientsPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the access-restricted message on a forbidden (non-trainer) response", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    fetchClients.mockResolvedValue({ kind: "forbidden" });

    const page = await ClientsPage({ searchParams: searchParams() });

    expect(JSON.stringify(page)).toContain("Trainer access required");
  });

  it("passes fetched clients to ClientsWorkspaceClient on success", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    fetchClients.mockResolvedValue({
      kind: "ok",
      clients: [{ clientUserId: "u1", email: "a@test.com", status: "active" }],
    });
    getClientDashboardAction.mockResolvedValue({ kind: "ok", dashboard: { rpeTrend: [], completionRate: { periodDays: 28, planned: 0, completed: 0, percent: 0 }, recentSessions: [] } });

    const page = await ClientsPage({ searchParams: searchParams() });

    expect(page.props.clients).toEqual([{ clientUserId: "u1", email: "a@test.com", status: "active" }]);
    expect(page.props.initialError).toBeNull();
    // Defaults to the FIRST client when no `?client=` is present.
    expect(page.props.selectedClientUserId).toBe("u1");
    expect(page.props.detailHeader).toBeDefined();
    expect(page.props.detailBody).toBeDefined();
    expect(page.props.detailNotFound).toBe(false);
  });

  it("passes a safe initial error when the fetch fails", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    fetchClients.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = await ClientsPage({ searchParams: searchParams() });

    expect(page.props.clients).toEqual([]);
    expect(page.props.initialError).toBe("api_unreachable");
  });

  it("selects the client named by ?client= instead of the first one", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    fetchClients.mockResolvedValue({
      kind: "ok",
      clients: [
        { clientUserId: "u1", email: "a@test.com", status: "active" },
        { clientUserId: "u2", email: "b@test.com", status: "active" },
      ],
    });
    getClientDashboardAction.mockResolvedValue({ kind: "ok", dashboard: { rpeTrend: [], completionRate: { periodDays: 28, planned: 0, completed: 0, percent: 0 }, recentSessions: [] } });

    const page = await ClientsPage({ searchParams: searchParams({ client: "u2" }) });

    expect(page.props.selectedClientUserId).toBe("u2");
    expect(getClientDashboardAction).toHaveBeenCalledWith("u2");
  });

  it("reports detailNotFound for a ?client= not in the trainer's roster, without crashing", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    fetchClients.mockResolvedValue({
      kind: "ok",
      clients: [{ clientUserId: "u1", email: "a@test.com", status: "active" }],
    });

    const page = await ClientsPage({ searchParams: searchParams({ client: "ghost" }) });

    expect(page.props.detailNotFound).toBe(true);
    expect(page.props.selectedClientUserId).toBeUndefined();
    expect(getClientDashboardAction).not.toHaveBeenCalled();
  });
});
