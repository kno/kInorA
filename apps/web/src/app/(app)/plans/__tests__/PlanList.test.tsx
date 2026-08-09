// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import type { WorkoutPlanSummary } from "@kinora/contracts";
import { PlanList } from "../PlanList";

afterEach(() => {
  cleanup();
});

const NOW = new Date("2026-08-09T12:00:00.000Z");

function plan(overrides: Partial<WorkoutPlanSummary> = {}): WorkoutPlanSummary {
  return {
    id: "plan-1",
    status: "ready",
    createdAt: "2026-06-01T10:00:00.000Z",
    name: "Summer Cut",
    ...overrides,
  };
}

describe("PlanList", () => {
  it("renders days per week, completed sessions, and the last-trained date for a plan", () => {
    renderWithIntl(
      <PlanList
        plans={[
          plan({ daysPerWeek: 4, completedSessions: 12, lastTrainedAt: "2026-08-08T10:00:00.000Z" }),
        ]}
        now={NOW}
      />,
    );

    expect(screen.getByText("Summer Cut")).toBeTruthy();
    expect(screen.getByText(/4/)).toBeTruthy();
    expect(screen.getByText(/12/)).toBeTruthy();
  });

  it("shows 'never trained' copy for a plan with no lastTrainedAt, not a fabricated date", () => {
    renderWithIntl(<PlanList plans={[plan({ completedSessions: 0 })]} now={NOW} />);

    expect(screen.getByTestId("plan-card-plan-1").textContent).toMatch(/never trained/i);
  });

  it("marks the first ready plan as the one currently being followed", () => {
    renderWithIntl(
      <PlanList
        plans={[
          plan({ id: "plan-1", status: "ready" }),
          plan({ id: "plan-2", status: "ready" }),
        ]}
        now={NOW}
      />,
    );

    const card1 = screen.getByTestId("plan-card-plan-1");
    const card2 = screen.getByTestId("plan-card-plan-2");
    expect(card1.textContent).toMatch(/currently following/i);
    expect(card2.textContent).not.toMatch(/currently following/i);
  });

  it("does not mark any plan as currently followed when none is ready", () => {
    renderWithIntl(
      <PlanList plans={[plan({ id: "plan-1", status: "generating" })]} now={NOW} />,
    );

    expect(screen.getByTestId("plan-card-plan-1").textContent).not.toMatch(/currently following/i);
  });

  it("renders the existing generating status copy for a generating plan (real body, not blank)", () => {
    renderWithIntl(
      <PlanList plans={[plan({ id: "plan-1", status: "generating" })]} now={NOW} />,
    );

    const card = screen.getByTestId("plan-card-plan-1");
    expect(card.textContent).toContain("Generating your plan…");
  });

  it("renders the existing failed status copy for a failed plan (real body, not blank)", () => {
    renderWithIntl(<PlanList plans={[plan({ id: "plan-1", status: "failed" })]} now={NOW} />);

    const card = screen.getByTestId("plan-card-plan-1");
    expect(card.textContent).toContain("Plan generation failed");
  });

  it("disables the Open action on a generating plan with aria-disabled and an explanatory title", () => {
    renderWithIntl(
      <PlanList plans={[plan({ id: "plan-1", status: "generating" })]} now={NOW} />,
    );

    const button = screen.getByTestId("plan-open-plan-1");
    expect(button.tagName).toBe("BUTTON");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("title")).toBeTruthy();
  });

  it("disables the Open action on a failed plan with aria-disabled and an explanatory title", () => {
    renderWithIntl(<PlanList plans={[plan({ id: "plan-1", status: "failed" })]} now={NOW} />);

    const button = screen.getByTestId("plan-open-plan-1");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("title")).toBeTruthy();
  });

  it("renders a real link (not disabled) for the Open action on a ready plan", () => {
    renderWithIntl(<PlanList plans={[plan({ id: "plan-1", status: "ready" })]} now={NOW} />);

    const link = screen.getByTestId("plan-open-plan-1");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/plan?planId=plan-1");
    expect(link.getAttribute("aria-disabled")).toBeNull();
  });

  it("color-codes a recently trained plan (within 7 days) as recent", () => {
    renderWithIntl(
      <PlanList
        plans={[plan({ id: "plan-1", lastTrainedAt: "2026-08-05T10:00:00.000Z" })]}
        now={NOW}
      />,
    );

    expect(screen.getByTestId("plan-last-trained-plan-1").className).toMatch(/recent/i);
  });

  it("color-codes a plan trained weeks ago (8-30 days) as aging", () => {
    renderWithIntl(
      <PlanList
        plans={[plan({ id: "plan-1", lastTrainedAt: "2026-07-20T10:00:00.000Z" })]}
        now={NOW}
      />,
    );

    expect(screen.getByTestId("plan-last-trained-plan-1").className).toMatch(/aging/i);
  });

  it("color-codes a plan trained months ago (>30 days) as stale", () => {
    renderWithIntl(
      <PlanList
        plans={[plan({ id: "plan-1", lastTrainedAt: "2026-01-01T10:00:00.000Z" })]}
        now={NOW}
      />,
    );

    expect(screen.getByTestId("plan-last-trained-plan-1").className).toMatch(/stale/i);
  });

  it("renders a plan with no lastTrainedAt neutrally, not as stale", () => {
    renderWithIntl(<PlanList plans={[plan({ id: "plan-1" })]} now={NOW} />);

    const el = screen.getByTestId("plan-last-trained-plan-1");
    expect(el.className).not.toMatch(/stale/i);
    expect(el.className).not.toMatch(/recent/i);
    expect(el.className).not.toMatch(/aging/i);
  });

  it("a missing daysPerWeek renders no fabricated 0", () => {
    renderWithIntl(<PlanList plans={[plan({ id: "plan-1" })]} now={NOW} />);

    const card = screen.getByTestId("plan-card-plan-1");
    expect(card.textContent).not.toMatch(/\b0\b.*days/i);
  });
});
