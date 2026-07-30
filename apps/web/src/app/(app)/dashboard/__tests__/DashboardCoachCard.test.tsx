// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import type { AdaptationRecommendation } from "@kinora/contracts";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { DashboardCoachCard } from "../DashboardCoachCard";

const lowAdaptation: AdaptationRecommendation = {
  source: "adherence",
  level: "low",
  suggestedChange: { kind: "reduce_frequency", fromDays: 4, toDays: 3 },
  rationaleKey: "adaptation.adherence.reduceFrequency",
  planSpecId: "spec-1",
  adherence: { adherence: 0.31, periodWeeks: 4, completedInWindow: 5, plannedInWindow: 16 },
};

const decreaseLoadAdaptation: AdaptationRecommendation = {
  source: "rpe",
  level: "low",
  suggestedChange: { kind: "adjust_load", direction: "decrease", from: "maintain", to: "reduce" },
  rationaleKey: "adaptation.rpe.highTrend",
  planSpecId: "spec-2",
  rpe: { meanRpe: 9.0, windowSessions: 3, sessionsWithRpe: 3, setsWithRpe: 12 },
};

const increaseLoadAdaptation: AdaptationRecommendation = {
  source: "rpe",
  level: "low",
  suggestedChange: { kind: "adjust_load", direction: "increase", from: "maintain", to: "increase" },
  rationaleKey: "adaptation.rpe.lowTrend",
  planSpecId: "spec-3",
  rpe: { meanRpe: 5.0, windowSessions: 3, sessionsWithRpe: 3, setsWithRpe: 12 },
};

describe("DashboardCoachCard — static fallback (no adaptation)", () => {
  it("renders the presentational coach copy when there is no low adaptation", () => {
    renderWithIntl(<DashboardCoachCard />);

    expect(screen.getByText("Coach AI")).toBeDefined();
    expect(screen.getByText(/Train hard/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Apply advice" })).toBeDefined();
  });

  it("does not render the adaptation banner when level is ok", () => {
    renderWithIntl(
      <DashboardCoachCard adaptation={{ source: "adherence", level: "ok", planSpecId: "spec-1" }} />,
    );

    expect(screen.queryByRole("button", { name: /Try 3 days/ })).toBeNull();
    // Falls back to the static coach card.
    expect(screen.getByRole("button", { name: "Apply advice" })).toBeDefined();
  });

  it("does not render the banner when low but there is no suggestedChange (already at the floor)", () => {
    renderWithIntl(
      <DashboardCoachCard adaptation={{ source: "adherence", level: "low", planSpecId: "spec-1" }} />,
    );

    expect(screen.queryByText(/Want to try/)).toBeNull();
    expect(screen.getByRole("button", { name: "Apply advice" })).toBeDefined();
  });

  it("does not render the adaptation banner when level is insufficient_data", () => {
    renderWithIntl(
      <DashboardCoachCard
        adaptation={{ source: "adherence", level: "insufficient_data", planSpecId: "spec-1" }}
      />,
    );

    expect(screen.queryByText(/Want to try/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Try 3 days/ })).toBeNull();
    // Nothing adaptation-related leaks — the static coach content stays.
    expect(screen.getByRole("button", { name: "Apply advice" })).toBeDefined();
  });
});

describe("DashboardCoachCard — adherence adaptation banner", () => {
  it("renders the option-framed suggestion with accept + dismiss actions on low adherence", () => {
    renderWithIntl(<DashboardCoachCard adaptation={lowAdaptation} />);

    expect(screen.getByText(/Want to try 3 days per week instead of 4/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Try 3 days" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Not now" })).toBeDefined();
  });

  it("interpolates the from→to days from suggestedChange (not hardcoded) — 5→4 renders too", () => {
    renderWithIntl(
      <DashboardCoachCard
        adaptation={{
          ...lowAdaptation,
          suggestedChange: { kind: "reduce_frequency", fromDays: 5, toDays: 4 },
        }}
      />,
    );

    expect(screen.getByText(/Want to try 4 days per week instead of 5/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Try 4 days" })).toBeDefined();
  });

  it("accept → calls onAccept with the planSpecId and shows the regenerating state", async () => {
    const onAccept = vi.fn().mockResolvedValue({ kind: "ok" });
    renderWithIntl(<DashboardCoachCard adaptation={lowAdaptation} onAccept={onAccept} />);

    fireEvent.click(screen.getByRole("button", { name: "Try 3 days" }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith("spec-1");
    expect(await screen.findByText(/Adjusting your plan/)).toBeDefined();
  });

  it("dismiss → makes NO request and removes the banner (plan unchanged)", () => {
    const onAccept = vi.fn().mockResolvedValue({ kind: "ok" });
    renderWithIntl(<DashboardCoachCard adaptation={lowAdaptation} onAccept={onAccept} />);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(onAccept).not.toHaveBeenCalled();
    expect(screen.queryByText(/Want to try 3 days per week/)).toBeNull();
  });

  it("generic error → shows a clear inline error, plan unchanged, and keeps the retry affordance", async () => {
    const onAccept = vi.fn().mockResolvedValue({ kind: "error", message: "api_unreachable" });
    renderWithIntl(<DashboardCoachCard adaptation={lowAdaptation} onAccept={onAccept} />);

    fireEvent.click(screen.getByRole("button", { name: "Try 3 days" }));

    // The failure surfaces as an alert; the accept button remains so the user
    // can retry, and no "regenerating" state is shown (the plan is unchanged).
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("We couldn't adjust your plan");
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Try 3 days" })).toBeDefined();
    expect(screen.queryByText(/Adjusting your plan/)).toBeNull();
  });

  it("403 quota-exhausted → distinct upgrade message (not the generic error)", async () => {
    const onAccept = vi.fn().mockResolvedValue({ kind: "error", message: "tenant_quota_exhausted" });
    renderWithIntl(<DashboardCoachCard adaptation={lowAdaptation} onAccept={onAccept} />);

    fireEvent.click(screen.getByRole("button", { name: "Try 3 days" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("used your plan change for this period");
    expect(alert.textContent).toContain("Upgrade");
    // The plan is unchanged and the retry affordance remains.
    expect(screen.getByRole("button", { name: "Try 3 days" })).toBeDefined();
    expect(screen.queryByText(/Adjusting your plan/)).toBeNull();
  });

  it("member allocation exhausted also maps to the quota-exhausted upgrade message", async () => {
    const onAccept = vi.fn().mockResolvedValue({ kind: "error", message: "member_allocation_exhausted" });
    renderWithIntl(<DashboardCoachCard adaptation={lowAdaptation} onAccept={onAccept} />);

    fireEvent.click(screen.getByRole("button", { name: "Try 3 days" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("used your plan change for this period");
  });

  it("409 no_adaptation → distinct 'already a good fit' message (not the generic error)", async () => {
    const onAccept = vi.fn().mockResolvedValue({ kind: "error", message: "no_adaptation" });
    renderWithIntl(<DashboardCoachCard adaptation={lowAdaptation} onAccept={onAccept} />);

    fireEvent.click(screen.getByRole("button", { name: "Try 3 days" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("already looks like a good fit");
    expect(alert.textContent).not.toContain("Upgrade");
    expect(screen.getByRole("button", { name: "Try 3 days" })).toBeDefined();
  });

  it("submitting → shows a pending affordance while the request is in flight", async () => {
    let resolveAccept: ((result: { kind: "ok" }) => void) | undefined;
    const onAccept = vi.fn(
      () =>
        new Promise<{ kind: "ok" }>((resolve) => {
          resolveAccept = resolve;
        }),
    );
    renderWithIntl(<DashboardCoachCard adaptation={lowAdaptation} onAccept={onAccept} />);

    fireEvent.click(screen.getByRole("button", { name: "Try 3 days" }));

    // A clear pending/regenerating message is announced while submitting, and
    // the actions are disabled.
    expect(screen.getByText(/Adjusting your plan/)).toBeDefined();
    expect((screen.getByRole("button", { name: "Try 3 days" }) as HTMLButtonElement).disabled).toBe(true);

    resolveAccept?.({ kind: "ok" });
    expect(await screen.findByText(/Adjusting your plan/)).toBeDefined();
  });

  // Review fix (B1 4R reliability WARNING): a rapid double-click must NOT fire
  // two POSTs (two generating plan rows, and — with the API-side fresh-nonce
  // fix — two consumed quota units). The accept (and dismiss) action must
  // disable while the request is in flight.
  it("disables the accept button while the request is in flight, so a rapid double-click sends only ONE request", async () => {
    let resolveAccept: ((result: { kind: "ok" }) => void) | undefined;
    const onAccept = vi.fn(
      () =>
        new Promise<{ kind: "ok" }>((resolve) => {
          resolveAccept = resolve;
        }),
    );
    renderWithIntl(<DashboardCoachCard adaptation={lowAdaptation} onAccept={onAccept} />);

    const acceptButton = screen.getByRole("button", { name: "Try 3 days" });
    fireEvent.click(acceptButton);
    // Rapid second click while the first request is still pending.
    fireEvent.click(acceptButton);

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect((acceptButton as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Not now" }) as HTMLButtonElement).disabled).toBe(true);

    resolveAccept?.({ kind: "ok" });
    expect(await screen.findByText(/Adjusting your plan/)).toBeDefined();
  });
});

describe("DashboardCoachCard — RPE (adjust_load) adaptation banner", () => {
  it("renders the reduce-load copy for a decrease direction, distinct from reduce_frequency", () => {
    renderWithIntl(<DashboardCoachCard adaptation={decreaseLoadAdaptation} />);

    expect(screen.getByText(/ease off the load/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Ease off load" })).toBeDefined();
    expect(screen.queryByText(/days per week/)).toBeNull();
  });

  it("renders the increase-load copy for an increase direction", () => {
    renderWithIntl(<DashboardCoachCard adaptation={increaseLoadAdaptation} />);

    expect(screen.getByText(/bump up the load/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Increase load" })).toBeDefined();
  });

  it("accept → calls onAccept with the planSpecId for an adjust_load recommendation", async () => {
    const onAccept = vi.fn().mockResolvedValue({ kind: "ok" });
    renderWithIntl(<DashboardCoachCard adaptation={decreaseLoadAdaptation} onAccept={onAccept} />);

    fireEvent.click(screen.getByRole("button", { name: "Ease off load" }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith("spec-2");
  });
});
