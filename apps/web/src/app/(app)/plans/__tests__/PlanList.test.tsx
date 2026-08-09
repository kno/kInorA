// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
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

  describe("archive (17d PR B)", () => {
    it("excludes an archived plan from the default active grid", () => {
      renderWithIntl(
        <PlanList
          plans={[
            plan({ id: "plan-1", archivedAt: null }),
            plan({ id: "plan-2", archivedAt: "2026-08-01T00:00:00.000Z" }),
          ]}
          now={NOW}
        />,
      );

      expect(screen.queryByTestId("plan-card-plan-1")).toBeTruthy();
      expect(screen.queryByTestId("plan-card-plan-2")).toBeNull();
    });

    it("reveals archived plans in their own section, below a separator, only when the show-archived toggle is active", () => {
      renderWithIntl(
        <PlanList
          plans={[
            plan({ id: "plan-1", archivedAt: null }),
            plan({ id: "plan-2", archivedAt: "2026-08-01T00:00:00.000Z" }),
          ]}
          now={NOW}
        />,
      );

      expect(screen.queryByTestId("plan-card-archived-plan-2")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /show archived/i }));

      expect(screen.getByTestId("plan-card-archived-plan-2")).toBeTruthy();
      expect(screen.getByRole("separator")).toBeTruthy();
    });

    it("the archive confirmation copy states that history is preserved", () => {
      const onArchive = vi.fn().mockResolvedValue({ id: "plan-1", archivedAt: "2026-08-09T00:00:00.000Z" });
      renderWithIntl(
        <PlanList plans={[plan({ id: "plan-1", archivedAt: null })]} now={NOW} onArchive={onArchive} />,
      );

      fireEvent.click(screen.getByTestId("plan-archive-plan-1"));

      const dialog = screen.getByRole("alertdialog");
      expect(dialog.textContent).toMatch(/nothing is deleted/i);
      expect(onArchive).not.toHaveBeenCalled();
    });

    it("confirming archive calls onArchive and moves the plan out of the active grid", async () => {
      const onArchive = vi.fn().mockResolvedValue({ id: "plan-1", archivedAt: "2026-08-09T00:00:00.000Z" });
      renderWithIntl(
        <PlanList plans={[plan({ id: "plan-1", archivedAt: null })]} now={NOW} onArchive={onArchive} />,
      );

      fireEvent.click(screen.getByTestId("plan-archive-plan-1"));
      fireEvent.click(screen.getByTestId("plan-archive-confirm-plan-1"));

      await screen.findByRole("button", { name: /show archived/i });
      expect(onArchive).toHaveBeenCalledWith("plan-1");
      expect(screen.queryByTestId("plan-card-plan-1")).toBeNull();
    });

    it("unarchiving from the archived section moves the plan back into the default grid without a page reload", async () => {
      const onUnarchive = vi.fn().mockResolvedValue({ id: "plan-2", archivedAt: null });
      renderWithIntl(
        <PlanList
          plans={[plan({ id: "plan-2", archivedAt: "2026-08-01T00:00:00.000Z" })]}
          now={NOW}
          onUnarchive={onUnarchive}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /show archived/i }));
      fireEvent.click(screen.getByTestId("plan-unarchive-plan-2"));

      await screen.findByTestId("plan-card-plan-2");
      expect(onUnarchive).toHaveBeenCalledWith("plan-2");
      expect(screen.queryByTestId("plan-card-archived-plan-2")).toBeNull();
    });
  });

  describe("edit affordance (17d PR D)", () => {
    it("links a ready plan to its program editor", () => {
      renderWithIntl(<PlanList plans={[plan({ id: "plan-1", status: "ready" })]} now={NOW} />);

      const link = screen.getByTestId("plan-edit-plan-1");
      expect(link.getAttribute("href")).toBe("/plan/plan-1/edit");
    });

    it("renders no edit affordance on a generating or failed plan", () => {
      renderWithIntl(
        <PlanList
          plans={[
            plan({ id: "plan-1", status: "generating" }),
            plan({ id: "plan-2", status: "failed" }),
          ]}
          now={NOW}
        />,
      );

      expect(screen.queryByTestId("plan-edit-plan-1")).toBeNull();
      expect(screen.queryByTestId("plan-edit-plan-2")).toBeNull();
    });

    it("renders no edit affordance on an archived row", () => {
      renderWithIntl(
        <PlanList
          plans={[plan({ id: "plan-3", archivedAt: "2026-08-01T00:00:00.000Z" })]}
          now={NOW}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /show archived/i }));

      expect(screen.getByTestId("plan-card-archived-plan-3")).toBeTruthy();
      expect(screen.queryByTestId("plan-edit-plan-3")).toBeNull();
    });
  });
});
