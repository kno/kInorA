import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientDashboardDTO, ClientSummaryDTO, StatsSummaryDTO, WeeklyOverviewDTO } from "@kinora/contracts";

/**
 * ClientDetailPage — trainer client-detail surface (GH #447, PR 2/2).
 * Mirrors `stats/__tests__/page.test.tsx`'s pattern: the page is an async
 * server component using `getTranslations`, which can't run its real RSC
 * build under Vitest, so `next-intl/server` is mocked with the catalog-backed
 * `createServerTranslator`. Assertions inspect the returned React element
 * tree via `JSON.stringify`, mirroring `clients/__tests__/page.test.tsx`.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

const getClientsAction = vi.fn();
const getClientDashboardAction = vi.fn();
const getClientProgressStatsAction = vi.fn();
const getClientExerciseDetailAction = vi.fn();
const getClientWeeklyOverviewAction = vi.fn();

vi.mock("../../actions", () => ({
  getClientsAction: (...args: unknown[]) => getClientsAction(...args),
  getClientDashboardAction: (...args: unknown[]) => getClientDashboardAction(...args),
  getClientProgressStatsAction: (...args: unknown[]) => getClientProgressStatsAction(...args),
  getClientExerciseDetailAction: (...args: unknown[]) => getClientExerciseDetailAction(...args),
  getClientWeeklyOverviewAction: (...args: unknown[]) => getClientWeeklyOverviewAction(...args),
}));

import ClientDetailPage from "../page";
import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

const client: ClientSummaryDTO = { clientUserId: "user_1" as never, email: "elena@test.com", status: "active" };

const dashboard: ClientDashboardDTO = {
  rpeTrend: [{ weekStart: "2026-08-03", meanRpe: 7.2, sessionsWithRpe: 3 }],
  completionRate: { periodDays: 28, planned: 12, completed: 10, percent: 83 },
  recentSessions: [{ date: "2026-08-17", volumeKg: 1200, meanRpe: 7 }],
};

const emptyKpi = { value: 0, deltaVsPreviousPeriod: null };
const statsSummary: StatsSummaryDTO = {
  range: "week",
  totalVolumeKg: { value: 8460, deltaVsPreviousPeriod: 6.2 },
  sessionCount: { value: 3, deltaVsPreviousPeriod: null },
  totalDurationMin: { value: 173, deltaVsPreviousPeriod: 4 },
  prCount: { value: 1, deltaVsPreviousPeriod: null },
  volumeTrend: { current: [100, 200], previous: [90, 150] },
  muscleGroupDistribution: [],
  personalRecords: [
    { exerciseTitle: "Back squat", estimated1RM: 92.5, achievedAt: "2026-08-12", trend: { series: [85, 92.5], delta: 7.5 } },
  ],
};

const weeklyOverview: WeeklyOverviewDTO = {
  weekStart: "2026-08-11",
  weekLabel: "11–17 ago",
  days: [{ date: "2026-08-11", status: "done" }],
  previousWeekStart: "2026-08-04",
  nextWeekStart: "2026-08-18",
};

function renderPage(clientUserId = "user_1", searchParams: Record<string, string> = {}) {
  return ClientDetailPage({
    params: Promise.resolve({ clientUserId }),
    searchParams: Promise.resolve(searchParams),
  });
}

describe("ClientDetailPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the access-restricted message on a forbidden client-list response", async () => {
    getClientsAction.mockResolvedValue({ kind: "forbidden" });

    const page = await renderPage();

    expect(JSON.stringify(page)).toContain("Trainer access required");
  });

  it("renders an honest not-found state for a clientUserId not in the trainer's roster", async () => {
    getClientsAction.mockResolvedValue({ kind: "ok", clients: [] });

    const page = await renderPage();

    expect(JSON.stringify(page)).toContain("client-detail-not-found");
  });

  it("renders the Dashboard tab by default, with completion rate and recent sessions", async () => {
    getClientsAction.mockResolvedValue({ kind: "ok", clients: [client] });
    getClientDashboardAction.mockResolvedValue({ kind: "ok", dashboard });

    const page = await renderPage();
    const text = JSON.stringify(page);

    expect(getClientDashboardAction).toHaveBeenCalledWith("user_1");
    expect(text).toContain("client-dashboard-tab");
    expect(text).toContain("83");
    expect(text).toContain("elena@test.com");
  });

  it("renders the forbidden state on the dashboard tab distinctly from a generic error", async () => {
    getClientsAction.mockResolvedValue({ kind: "ok", clients: [client] });
    getClientDashboardAction.mockResolvedValue({ kind: "forbidden" });

    const page = await renderPage();

    expect(JSON.stringify(page)).toContain("client-detail-forbidden");
  });

  it("renders the Progress tab with KPIs and personal records, and switches range via the query param", async () => {
    getClientsAction.mockResolvedValue({ kind: "ok", clients: [client] });
    getClientProgressStatsAction.mockResolvedValue({ kind: "ok", summary: statsSummary });

    const page = await renderPage("user_1", { tab: "progress", range: "year" });
    const text = JSON.stringify(page);

    expect(getClientProgressStatsAction).toHaveBeenCalledWith("user_1", "year");
    expect(text).toContain("client-progress-tab");
    expect(text).toContain("Back squat");
    expect(text).toContain("92.5 kg");
  });

  it("drills into an exercise's history when ?exercise= is present", async () => {
    getClientsAction.mockResolvedValue({ kind: "ok", clients: [client] });
    getClientProgressStatsAction.mockResolvedValue({ kind: "ok", summary: statsSummary });
    getClientExerciseDetailAction.mockResolvedValue({
      kind: "ok",
      detail: { exerciseTitle: "Back squat", recentSets: [{ completedAt: "2026-08-12", weightKg: 92.5, actualReps: 5 }] },
    });

    const page = await renderPage("user_1", { tab: "progress", exercise: "Back squat" });
    const text = JSON.stringify(page);

    expect(getClientExerciseDetailAction).toHaveBeenCalledWith("user_1", "Back squat");
    expect(text).toContain("client-exercise-detail");
    expect(text).toContain("92.5 kg");
  });

  it("does not fetch exercise detail when no exercise is selected", async () => {
    getClientsAction.mockResolvedValue({ kind: "ok", clients: [client] });
    getClientProgressStatsAction.mockResolvedValue({ kind: "ok", summary: { ...statsSummary, personalRecords: [] } });

    const page = await renderPage("user_1", { tab: "progress" });

    expect(getClientExerciseDetailAction).not.toHaveBeenCalled();
    expect(JSON.stringify(page)).toContain("No personal records yet");
  });

  it("renders the Plan tab as the weekly-overview board with week navigation", async () => {
    getClientsAction.mockResolvedValue({ kind: "ok", clients: [client] });
    getClientWeeklyOverviewAction.mockResolvedValue({ kind: "ok", overview: weeklyOverview });

    const page = await renderPage("user_1", { tab: "plan" });
    const text = JSON.stringify(page);

    expect(getClientWeeklyOverviewAction).toHaveBeenCalledWith("user_1", undefined);
    expect(text).toContain("client-plan-tab");
    expect(text).toContain("client-plan-day");
  });

  it("passes weekStart through to the weekly-overview fetcher", async () => {
    getClientsAction.mockResolvedValue({ kind: "ok", clients: [client] });
    getClientWeeklyOverviewAction.mockResolvedValue({ kind: "ok", overview: weeklyOverview });

    await renderPage("user_1", { tab: "plan", weekStart: "2026-08-04" });

    expect(getClientWeeklyOverviewAction).toHaveBeenCalledWith("user_1", "2026-08-04");
  });

  it("renders real Spanish copy from the ES catalog on the dashboard tab", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    getClientsAction.mockResolvedValue({ kind: "ok", clients: [client] });
    getClientDashboardAction.mockResolvedValue({ kind: "ok", dashboard });

    const page = await renderPage();

    expect(JSON.stringify(page)).toContain("Cumplimiento a 28 días");
  });
});
