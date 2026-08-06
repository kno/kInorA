// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { StatsView } from "../StatsView";
import type { PlatformStats } from "../stats-constants";

const STATS: PlatformStats = {
  tenants: { total: 12, signups7d: 2, signups30d: 5 },
  users: { total: 40, signups7d: 6, signups30d: 15 },
  memberships: { activeByRole: { owner: 10, member: 25, trainer: 3 } },
  billing: {
    effectiveTier: { free: 6, pro: 4, trainer: 1, gym: 1 },
    activeStripeSubscriptions: 7,
    trials: 2,
    activeOverridesByTier: { free: 0, pro: 0, trainer: 1, gym: 1 },
  },
  usage: {
    thisPeriod: "2026-08",
    byFeature: { plan_generation: 30, plan_regeneration: 5, memory_write: 12, memory_retrieval: 8 },
  },
  observability: { errors24h: 1, events24h: 20 },
  retention: {
    windowWeeks: 12,
    abandonedSessionThresholdHours: 24,
    abandonedSessions: 3,
    cohorts: [
      {
        weekStart: "2026-07-27",
        signups: 4,
        createdPlan: 3,
        completedFirstWorkout: 2,
        completedSecondWorkoutWithin7d: 1,
        activeWeek2: 0,
        activeWeek4: 0,
        trainerSponsoredSignups: 1,
      },
      {
        weekStart: "2026-07-20",
        signups: 6,
        createdPlan: 5,
        completedFirstWorkout: 4,
        completedSecondWorkoutWithin7d: 2,
        activeWeek2: 2,
        activeWeek4: 1,
        trainerSponsoredSignups: 0,
      },
    ],
    totals: {
      signups: 10,
      createdPlan: 8,
      completedFirstWorkout: 6,
      completedSecondWorkoutWithin7d: 3,
      activeWeek2: 2,
      activeWeek4: 1,
      trainerSponsoredSignups: 1,
    },
  },
};

describe("StatsView", () => {
  it("renders the tenant + user scalar metrics", () => {
    renderWithIntl(<StatsView stats={STATS} />);
    expect(within(screen.getByTestId("tenants-total")).getByText("12")).toBeDefined();
    expect(within(screen.getByTestId("tenants-signups7d")).getByText("2")).toBeDefined();
    expect(within(screen.getByTestId("users-total")).getByText("40")).toBeDefined();
    expect(within(screen.getByTestId("users-signups30d")).getByText("15")).toBeDefined();
  });

  it("renders active memberships by role", () => {
    renderWithIntl(<StatsView stats={STATS} />);
    expect(within(screen.getByTestId("role-owner")).getByText("10")).toBeDefined();
    expect(within(screen.getByTestId("role-member")).getByText("25")).toBeDefined();
    expect(within(screen.getByTestId("role-trainer")).getByText("3")).toBeDefined();
  });

  it("renders the effective-tier breakdown and active-override tallies", () => {
    renderWithIntl(<StatsView stats={STATS} />);
    const eff = screen.getByTestId("billing-effective-tier");
    expect(within(eff).getByTestId("effective-tier-pro").textContent).toContain("4");
    expect(within(eff).getByTestId("effective-tier-trainer").textContent).toContain("1");
    const ovr = screen.getByTestId("billing-active-overrides");
    expect(within(ovr).getByTestId("override-tier-trainer").textContent).toContain("1");
    expect(within(ovr).getByTestId("override-tier-gym").textContent).toContain("1");
  });

  it("renders subscriptions, trials, usage-by-feature and observability counts", () => {
    renderWithIntl(<StatsView stats={STATS} />);
    expect(within(screen.getByTestId("billing-active-subscriptions")).getByText("7")).toBeDefined();
    expect(within(screen.getByTestId("billing-trials")).getByText("2")).toBeDefined();
    expect(screen.getByTestId("usage-period").textContent).toContain("2026-08");
    expect(within(screen.getByTestId("usage-plan-generation")).getByText("30")).toBeDefined();
    expect(within(screen.getByTestId("usage-memory-retrieval")).getByText("8")).toBeDefined();
    expect(within(screen.getByTestId("obs-errors24h")).getByText("1")).toBeDefined();
    expect(within(screen.getByTestId("obs-events24h")).getByText("20")).toBeDefined();
  });

  it("renders every retention step as an absolute count WITH its denominator, never a bare percentage", () => {
    renderWithIntl(<StatsView stats={STATS} />);
    const totals = screen.getByTestId("retention-totals");

    // The whole point of #353: "8 of 10", not "80%". If a step ever renders the
    // ratio alone, this fails.
    expect(within(totals).getByTestId("retention-totals-created-plan").textContent).toContain(
      "8 of 10",
    );
    expect(
      within(totals).getByTestId("retention-totals-first-workout").textContent,
    ).toContain("6 of 8");
    expect(
      within(totals).getByTestId("retention-totals-second-workout").textContent,
    ).toContain("3 of 6");
    expect(within(totals).getByTestId("retention-totals-week2").textContent).toContain("2 of 3");
    expect(within(totals).getByTestId("retention-totals-week4").textContent).toContain("1 of 3");
  });

  it("renders one card per signup-week cohort, newest first, with its own denominators", () => {
    renderWithIntl(<StatsView stats={STATS} />);
    const newest = screen.getByTestId("retention-cohort-2026-07-27");
    expect(newest.textContent).toContain("2026-07-27");
    expect(
      within(newest).getByTestId("retention-2026-07-27-created-plan").textContent,
    ).toContain("3 of 4");
    // A cohort too young to have reached week 4 shows 0 against its real
    // denominator rather than an empty or absent row.
    expect(within(newest).getByTestId("retention-2026-07-27-week4").textContent).toContain(
      "0 of 1",
    );

    const older = screen.getByTestId("retention-cohort-2026-07-20");
    expect(within(older).getByTestId("retention-2026-07-20-week2").textContent).toContain(
      "2 of 2",
    );
  });

  it("reports trainer-sponsored signups as a separate segment and the abandoned-session count", () => {
    renderWithIntl(<StatsView stats={STATS} />);
    // Trainer-sponsored users are counted apart so they cannot inflate the B2C
    // cohort: totals.signups is 10 while one trainer-sponsored signup exists.
    expect(
      within(screen.getByTestId("retention-totals")).getByTestId(
        "retention-totals-trainer-sponsored",
      ).textContent,
    ).toContain("1");
    expect(within(screen.getByTestId("retention-totals-signups")).getByText("10")).toBeDefined();
    expect(
      within(screen.getByTestId("retention-abandoned-sessions")).getByText("3"),
    ).toBeDefined();
    expect(screen.getByTestId("retention-window").textContent).toContain("12");
  });
});
