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
});
