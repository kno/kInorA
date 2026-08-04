import { describe, expect, it, vi } from "vitest";

const fetchClientPlan = vi.fn();
const cookies = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("next/headers", () => ({ cookies: (...args: unknown[]) => cookies(...args) }));

vi.mock("../../../../trainer-client", () => ({
  fetchClientPlan: (...args: unknown[]) => fetchClientPlan(...args),
}));

import ClientPlanPage from "../page";

/**
 * Trainer-facing client plan page (#341). The page itself performs NO
 * authorization — these tests assert it forwards the route params + session
 * token to the server-authorized read and renders each outcome distinctly.
 */
describe("ClientPlanPage", () => {
  // `null` means "no session cookie" — an explicit `undefined` would trigger
  // the default and silently test the happy path instead.
  function mockSession(token: string | null = "session-token") {
    cookies.mockResolvedValue({ get: vi.fn(() => (token ? { value: token } : undefined)) });
  }

  async function renderPage(clientUserId = "user_1", planId = "plan_1") {
    const page = await ClientPlanPage({ params: Promise.resolve({ clientUserId, planId }) });
    // The page returns the async ClientPlanView element; await its resolved tree.
    return JSON.stringify(await (page.type as (p: unknown) => Promise<unknown>)(page.props));
  }

  it("passes the route params and session token to the trainer-scoped read", async () => {
    mockSession();
    fetchClientPlan.mockResolvedValue({ kind: "ok", plan: { id: "plan_1", status: "ready" } });

    await renderPage("user_1", "plan_1");

    expect(fetchClientPlan).toHaveBeenCalledWith("user_1", "plan_1", "session-token");
  });

  it("renders the access-restricted state on a forbidden (unassigned trainer) response", async () => {
    mockSession();
    fetchClientPlan.mockResolvedValue({ kind: "forbidden" });

    const tree = await renderPage();

    expect(tree).toContain("clients.accessRestrictedTitle");
    expect(tree).not.toContain("plan.ready.title");
  });

  it("renders the empty state on a notFound response, distinct from forbidden", async () => {
    mockSession();
    fetchClientPlan.mockResolvedValue({ kind: "notFound" });

    const tree = await renderPage();

    expect(tree).toContain("plan.nav.empty.title");
    expect(tree).not.toContain("clients.accessRestrictedTitle");
  });

  it("renders the error state on a transport error", async () => {
    mockSession();
    fetchClientPlan.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const tree = await renderPage();

    expect(tree).toContain("plan.error.title");
  });

  it("renders the generating state while the plan is still being generated", async () => {
    mockSession();
    fetchClientPlan.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan_1", status: "generating" },
    });

    const tree = await renderPage();

    expect(tree).toContain("plan.generating.title");
  });

  it("renders the failed state for a failed generation", async () => {
    mockSession();
    fetchClientPlan.mockResolvedValue({ kind: "ok", plan: { id: "plan_1", status: "failed" } });

    const tree = await renderPage();

    expect(tree).toContain("plan.failed.title");
  });

  it("renders the client's program — plan name, day sessions and every exercise", async () => {
    mockSession();
    fetchClientPlan.mockResolvedValue({
      kind: "ok",
      plan: {
        id: "plan_1",
        status: "ready",
        name: "Summer strength block",
        program: {
          weeklySessions: [
            {
              day: 1,
              title: "Upper push",
              exercises: [
                { name: "Bench press", sets: 4, reps: "6-8", restSeconds: 120 },
                { name: "Overhead press", sets: 3, reps: "8-10", restSeconds: 90 },
              ],
            },
          ],
          limitationWarnings: [],
        },
      },
    });

    const tree = await renderPage();

    expect(tree).toContain("Summer strength block");
    expect(tree).toContain("Upper push");
    expect(tree).toContain("Bench press");
    expect(tree).toContain("Overhead press");
    expect(tree).toContain("6-8");
  });

  it("renders limitation warnings when the program carries them", async () => {
    mockSession();
    fetchClientPlan.mockResolvedValue({
      kind: "ok",
      plan: {
        id: "plan_1",
        status: "ready",
        name: "Knee-safe block",
        program: {
          weeklySessions: [],
          limitationWarnings: ["Avoid deep knee flexion"],
        },
      },
    });

    const tree = await renderPage();

    expect(tree).toContain("Avoid deep knee flexion");
    expect(tree).toContain("plan.limitation.title");
  });

  it("forwards an absent session token unchanged — the read decides, not the page", async () => {
    mockSession(null);
    fetchClientPlan.mockResolvedValue({ kind: "error", message: "no_session" });

    await renderPage();

    expect(fetchClientPlan).toHaveBeenCalledWith("user_1", "plan_1", undefined);
  });
});
