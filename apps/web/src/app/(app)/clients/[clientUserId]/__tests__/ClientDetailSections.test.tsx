// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ClientDashboardDTO, ClientSummaryDTO, StatsSummaryDTO, WeeklyOverviewDTO } from "@kinora/contracts";
import { ClientDetailHeader, DashboardTab, PlanTab, ProgressTab, type Translator } from "../ClientDetailSections";

/**
 * Regression coverage for GH #460's review: the tab/range/week-nav links
 * were built by naively string-concatenating a literal `?` (or `&`) onto
 * `hrefBase`, which already carries its own query string when the `/clients`
 * master-detail workspace passes `hrefBase="/clients?client=<id>"` — that
 * produced a malformed double-`?` URL. `appendParams` must join with `?`
 * only when the base has no query yet, `&` otherwise, at every join site.
 */

const fakeT: Translator = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);

const client: ClientSummaryDTO = {
  clientUserId: "user_1" as never,
  email: "elena.lopez@correo.com",
  status: "active",
};

describe("ClientDetailHeader identity", () => {
  it("shows the display name as the title and the email underneath, not the email as the title", () => {
    render(
      <ClientDetailHeader
        client={{ ...client, name: "Elena López" }}
        tab="dashboard"
        t={fakeT}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Elena López");
    expect(screen.getByText("elena.lopez@correo.com")).toBeDefined();
  });

  it("falls back to the email local-part as the title when there is no name", () => {
    render(<ClientDetailHeader client={client} tab="dashboard" t={fakeT} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("elena.lopez");
  });

  it("marks the create-plan CTA aria-disabled for a non-active client", () => {
    render(<ClientDetailHeader client={{ ...client, status: "invited" }} tab="dashboard" t={fakeT} />);

    expect(screen.getByText("clients.createPlanCta").getAttribute("aria-disabled")).toBe("true");
  });

  it("leaves the create-plan CTA enabled for an active client", () => {
    render(<ClientDetailHeader client={client} tab="dashboard" t={fakeT} />);

    expect(screen.getByText("clients.createPlanCta").getAttribute("aria-disabled")).toBe("false");
  });
});

describe("ClientDetailHeader tab links", () => {
  it("joins with '&' when hrefBase already carries a query", () => {
    render(<ClientDetailHeader client={client} tab="dashboard" t={fakeT} hrefBase="/clients?client=user_1" />);

    expect(screen.getByTestId("client-detail-tab-progress").getAttribute("href")).toBe(
      "/clients?client=user_1&tab=progress",
    );
  });

  it("joins with '?' on the standalone default base (no hrefBase)", () => {
    render(<ClientDetailHeader client={client} tab="dashboard" t={fakeT} />);

    expect(screen.getByTestId("client-detail-tab-progress").getAttribute("href")).toBe(
      "/clients/user_1?tab=progress",
    );
  });
});

const emptyKpi = { value: 0, deltaVsPreviousPeriod: null };
const statsSummary: StatsSummaryDTO = {
  range: "week",
  totalVolumeKg: emptyKpi,
  sessionCount: emptyKpi,
  totalDurationMin: emptyKpi,
  prCount: emptyKpi,
  volumeTrend: { current: [], previous: [] },
  muscleGroupDistribution: [],
  personalRecords: [
    { exerciseTitle: "Back squat", estimated1RM: 92.5, achievedAt: "2026-08-12", trend: { series: [85, 92.5], delta: 7.5 } },
  ],
};

describe("ProgressTab range and exercise links", () => {
  it("builds '/clients?client=c1&tab=progress&range=week' from a hrefBase with a query", () => {
    render(
      <ProgressTab
        clientUserId="c1"
        range="week"
        statsResult={{ kind: "ok", summary: statsSummary }}
        t={fakeT}
        hrefBase="/clients?client=c1"
      />,
    );

    expect(screen.getByTestId("client-progress-range-week").getAttribute("href")).toBe(
      "/clients?client=c1&tab=progress&range=week",
    );
  });

  it("builds '/clients/c1?tab=progress&range=week' on the standalone default base", () => {
    render(
      <ProgressTab
        clientUserId="c1"
        range="week"
        statsResult={{ kind: "ok", summary: statsSummary }}
        t={fakeT}
      />,
    );

    expect(screen.getByTestId("client-progress-range-week").getAttribute("href")).toBe(
      "/clients/c1?tab=progress&range=week",
    );
  });

  it("the exercise drill-down link joins params correctly with a queried hrefBase", () => {
    render(
      <ProgressTab
        clientUserId="c1"
        range="week"
        statsResult={{ kind: "ok", summary: statsSummary }}
        t={fakeT}
        hrefBase="/clients?client=c1"
      />,
    );

    const link = screen.getByRole("link", { name: /Back squat/i });
    expect(link.getAttribute("href")).toBe(
      "/clients?client=c1&tab=progress&range=week&exercise=Back%20squat",
    );
  });

  it("the exercise drill-down link joins params correctly on the standalone default base", () => {
    render(
      <ProgressTab clientUserId="c1" range="week" statsResult={{ kind: "ok", summary: statsSummary }} t={fakeT} />,
    );

    const link = screen.getByRole("link", { name: /Back squat/i });
    expect(link.getAttribute("href")).toBe("/clients/c1?tab=progress&range=week&exercise=Back%20squat");
  });
});

const weeklyOverview: WeeklyOverviewDTO = {
  weekStart: "2026-08-11",
  weekLabel: "11–17 ago",
  days: [],
  previousWeekStart: "2026-08-04",
  nextWeekStart: "2026-08-18",
};

const dashboard: ClientDashboardDTO = {
  rpeTrend: [{ weekStart: "2026-06-29T00:00:00.000Z", meanRpe: 7.2, sessionsWithRpe: 3 }],
  completionRate: { periodDays: 28, planned: 12, completed: 10, percent: 83 },
  recentSessions: [{ date: "2026-08-17T00:00:00.000Z", volumeKg: 1200, meanRpe: 7 }],
};

describe("DashboardTab date formatting", () => {
  it("formats the RPE-trend week label and recent-session date as a localized short date, not the raw ISO string", () => {
    render(<DashboardTab result={{ kind: "ok", dashboard }} t={fakeT} locale="en" />);

    expect(screen.getByText("Jun 29, 2026")).toBeDefined();
    expect(screen.getByText("Aug 17, 2026")).toBeDefined();
    expect(screen.queryByText("2026-06-29T00:00:00.000Z")).toBeNull();
    expect(screen.queryByText("2026-08-17T00:00:00.000Z")).toBeNull();
  });

  it("defaults to 'en' formatting when no locale is passed", () => {
    render(<DashboardTab result={{ kind: "ok", dashboard }} t={fakeT} />);

    expect(screen.getByText("Jun 29, 2026")).toBeDefined();
  });
});

describe("PlanTab week-nav links", () => {
  it("builds '/clients?client=c1&tab=plan&weekStart=...' from a hrefBase with a query", () => {
    render(
      <PlanTab
        clientUserId="c1"
        weekResult={{ kind: "ok", overview: weeklyOverview }}
        t={fakeT}
        hrefBase="/clients?client=c1"
      />,
    );

    expect(screen.getByText("clients.plan.nextWeek").getAttribute("href")).toBe(
      "/clients?client=c1&tab=plan&weekStart=2026-08-18",
    );
    expect(screen.getByText("clients.plan.previousWeek").getAttribute("href")).toBe(
      "/clients?client=c1&tab=plan&weekStart=2026-08-04",
    );
  });

  it("builds '/clients/c1?tab=plan&weekStart=...' on the standalone default base", () => {
    render(<PlanTab clientUserId="c1" weekResult={{ kind: "ok", overview: weeklyOverview }} t={fakeT} />);

    expect(screen.getByText("clients.plan.nextWeek").getAttribute("href")).toBe(
      "/clients/c1?tab=plan&weekStart=2026-08-18",
    );
    expect(screen.getByText("clients.plan.previousWeek").getAttribute("href")).toBe(
      "/clients/c1?tab=plan&weekStart=2026-08-04",
    );
  });
});
