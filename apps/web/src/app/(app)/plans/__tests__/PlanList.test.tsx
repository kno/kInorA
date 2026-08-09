// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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

  /**
   * Issue #412 — the confirmation already claimed `role="alertdialog"` while
   * providing none of the behaviour that role promises. These are the four
   * guarantees a modal makes to a keyboard reader; they are asserted directly
   * so the dialog cannot quietly go back to being a `<section>` in the page.
   */
  describe("archive confirmation is a real modal (issue #412)", () => {
    function openDialog() {
      renderWithIntl(<PlanList plans={[plan({ id: "plan-1", archivedAt: null })]} now={NOW} />);
      fireEvent.click(screen.getByTestId("plan-archive-plan-1"));
      return screen.getByRole("alertdialog");
    }

    it("marks the dialog as modal", () => {
      expect(openDialog().getAttribute("aria-modal")).toBe("true");
    });

    it("moves focus into the dialog when it opens", () => {
      openDialog();

      expect(document.activeElement).toBe(screen.getByTestId("plan-archive-confirm-plan-1"));
    });

    it("traps Tab at the last control, wrapping back to the first", () => {
      const dialog = openDialog();
      const first = screen.getByTestId("plan-archive-confirm-plan-1");
      const last = screen.getByTestId("plan-archive-cancel-plan-1");

      last.focus();
      fireEvent.keyDown(dialog, { key: "Tab" });

      expect(document.activeElement).toBe(first);
    });

    it("traps Shift+Tab at the first control, wrapping back to the last", () => {
      const dialog = openDialog();
      const first = screen.getByTestId("plan-archive-confirm-plan-1");
      const last = screen.getByTestId("plan-archive-cancel-plan-1");

      first.focus();
      fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

      expect(document.activeElement).toBe(last);
    });

    it("leaves focus alone for a Tab that does not reach either edge", () => {
      const dialog = openDialog();
      const first = screen.getByTestId("plan-archive-confirm-plan-1");

      first.focus();
      fireEvent.keyDown(dialog, { key: "Tab" });

      // Forward from the first control is an ordinary move the browser makes.
      expect(document.activeElement).toBe(first);
    });

    it("dismisses on Escape without archiving", () => {
      const onArchive = vi.fn();
      renderWithIntl(
        <PlanList plans={[plan({ id: "plan-1", archivedAt: null })]} now={NOW} onArchive={onArchive} />,
      );
      fireEvent.click(screen.getByTestId("plan-archive-plan-1"));

      fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(onArchive).not.toHaveBeenCalled();
    });

    it("ignores unrelated keys", () => {
      const dialog = openDialog();

      fireEvent.keyDown(dialog, { key: "a" });

      expect(screen.getByRole("alertdialog")).toBeTruthy();
    });

    it("returns focus to the control that opened it when dismissed", () => {
      renderWithIntl(<PlanList plans={[plan({ id: "plan-1", archivedAt: null })]} now={NOW} />);
      const trigger = screen.getByTestId("plan-archive-plan-1");

      fireEvent.click(trigger);
      fireEvent.click(screen.getByTestId("plan-archive-cancel-plan-1"));

      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  // #412 — bulk archive loops the existing one-plan endpoint, so the whole
  // design lives in what happens when only SOME of those calls come back.
  describe("bulk archive (#412)", () => {
    function archived(id: string) {
      return { id, archivedAt: "2026-08-09T00:00:00.000Z" };
    }

    function twoPlans() {
      return [
        plan({ id: "plan-1", name: "Summer Cut" }),
        plan({ id: "plan-2", name: "Winter Bulk" }),
      ];
    }

    /** Select both plans and open the bulk confirmation. */
    function selectBothAndConfirm() {
      fireEvent.click(screen.getByTestId("plan-select-plan-1"));
      fireEvent.click(screen.getByTestId("plan-select-plan-2"));
      fireEvent.click(screen.getByTestId("plan-bulk-archive"));
    }

    it("offers no bulk bar until something is selected", () => {
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} />);

      expect(screen.queryByTestId("plan-bulk-bar")).toBeNull();
    });

    it("counts the selection with a pluralised label", () => {
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} />);

      fireEvent.click(screen.getByTestId("plan-select-plan-1"));
      expect(screen.getByTestId("plan-bulk-count").textContent).toMatch(/1 plan selected/i);

      fireEvent.click(screen.getByTestId("plan-select-plan-2"));
      expect(screen.getByTestId("plan-bulk-count").textContent).toMatch(/2 plans selected/i);
    });

    it("labels each checkbox with its own plan's name", () => {
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} />);

      expect(
        screen.getByTestId("plan-select-plan-2").getAttribute("aria-label"),
      ).toContain("Winter Bulk");
    });

    it("offers no selection on an archived row", () => {
      renderWithIntl(
        <PlanList
          plans={[plan({ id: "plan-3", archivedAt: "2026-08-01T00:00:00.000Z" })]}
          now={NOW}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /show archived/i }));

      expect(screen.getByTestId("plan-card-archived-plan-3")).toBeTruthy();
      expect(screen.queryByTestId("plan-select-plan-3")).toBeNull();
    });

    // The sentence that makes this feature archive-and-not-delete has to be in
    // the bulk confirmation too, not only the singular one.
    it("the bulk confirmation keeps the nothing-is-deleted guarantee and counts the plans", () => {
      const onArchive = vi.fn();
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={onArchive} />);

      selectBothAndConfirm();

      const dialog = screen.getByTestId("plan-bulk-confirm");
      expect(dialog.textContent).toMatch(/nothing is deleted/i);
      expect(dialog.getAttribute("aria-label")).toMatch(/these 2 plans/i);
      expect(onArchive).not.toHaveBeenCalled();
    });

    // It reuses the modal the single-plan confirmation became, rather than
    // introducing a second dialog mechanism beside it — so it must carry the
    // same contract, not merely look similar.
    it("is the same real modal: aria-modal, focus moved in, Escape dismisses", () => {
      const onArchive = vi.fn();
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={onArchive} />);

      selectBothAndConfirm();

      const dialog = screen.getByTestId("plan-bulk-confirm");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("role")).toBe("alertdialog");
      expect(document.activeElement).toBe(screen.getByTestId("plan-bulk-confirm-yes"));

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByTestId("plan-bulk-confirm")).toBeNull();
      expect(onArchive).not.toHaveBeenCalled();
    });

    it("traps Tab inside the bulk dialog, wrapping at the last control", () => {
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={vi.fn()} />);

      selectBothAndConfirm();
      const dialog = screen.getByTestId("plan-bulk-confirm");
      screen.getByTestId("plan-bulk-confirm-cancel").focus();
      fireEvent.keyDown(dialog, { key: "Tab" });

      expect(document.activeElement).toBe(screen.getByTestId("plan-bulk-confirm-yes"));
    });

    // Its own trigger, not whichever row's Archive was pressed last.
    it("returns focus to the bulk Archive button when dismissed", () => {
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={vi.fn()} />);

      selectBothAndConfirm();
      fireEvent.click(screen.getByTestId("plan-bulk-confirm-cancel"));

      expect(document.activeElement).toBe(screen.getByTestId("plan-bulk-archive"));
    });

    it("archives every selected plan with one call each and moves them out of the grid", async () => {
      const onArchive = vi.fn().mockImplementation((id: string) => Promise.resolve(archived(id)));
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={onArchive} />);

      selectBothAndConfirm();
      fireEvent.click(screen.getByTestId("plan-bulk-confirm-yes"));

      await screen.findByTestId("plan-bulk-done");
      expect(onArchive.mock.calls.map((call) => call[0]).sort()).toEqual(["plan-1", "plan-2"]);
      expect(screen.queryByTestId("plan-card-plan-1")).toBeNull();
      expect(screen.queryByTestId("plan-card-plan-2")).toBeNull();
      // A clean run reads as a clean run, not as a warning.
      expect(screen.queryByTestId("plan-bulk-partial")).toBeNull();
      expect(screen.queryByTestId("plan-bulk-bar")).toBeNull();
    });

    // The failure mode the whole design is for.
    it("names exactly which plans were archived and which were not on a partial failure", async () => {
      const onArchive = vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === "plan-2" ? null : archived(id)),
        );
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={onArchive} />);

      selectBothAndConfirm();
      fireEvent.click(screen.getByTestId("plan-bulk-confirm-yes"));

      await screen.findByTestId("plan-bulk-partial");
      expect(screen.getByTestId("plan-bulk-partial-archived").textContent).toContain(
        "Summer Cut",
      );
      expect(screen.getByTestId("plan-bulk-partial-failed").textContent).toContain(
        "Winter Bulk",
      );
      // The one that landed left the grid; the one that did not is still there.
      expect(screen.queryByTestId("plan-card-plan-1")).toBeNull();
      expect(screen.getByTestId("plan-card-plan-2")).toBeTruthy();
    });

    it("keeps only the failed plans selected, so retrying is one click", async () => {
      const onArchive = vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === "plan-2" ? null : archived(id)),
        );
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={onArchive} />);

      selectBothAndConfirm();
      fireEvent.click(screen.getByTestId("plan-bulk-confirm-yes"));

      await screen.findByTestId("plan-bulk-partial");
      expect(screen.getByTestId("plan-bulk-count").textContent).toMatch(/1 plan selected/i);
      expect((screen.getByTestId("plan-select-plan-2") as HTMLInputElement).checked).toBe(true);
    });

    it("reports an all-failed run without claiming anything was archived", async () => {
      const onArchive = vi.fn().mockResolvedValue(null);
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={onArchive} />);

      selectBothAndConfirm();
      fireEvent.click(screen.getByTestId("plan-bulk-confirm-yes"));

      await screen.findByTestId("plan-bulk-partial");
      expect(screen.queryByTestId("plan-bulk-partial-archived")).toBeNull();
      expect(screen.queryByTestId("plan-bulk-done")).toBeNull();
      expect(screen.getByTestId("plan-card-plan-1")).toBeTruthy();
      expect(screen.getByTestId("plan-card-plan-2")).toBeTruthy();
    });

    it("survives a rejected call instead of leaving the list mid-archive", async () => {
      const onArchive = vi
        .fn()
        .mockImplementation((id: string) =>
          id === "plan-2" ? Promise.reject(new Error("boom")) : Promise.resolve(archived(id)),
        );
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={onArchive} />);

      selectBothAndConfirm();
      fireEvent.click(screen.getByTestId("plan-bulk-confirm-yes"));

      await screen.findByTestId("plan-bulk-partial");
      expect(screen.getByTestId("plan-bulk-partial-failed").textContent).toContain(
        "Winter Bulk",
      );
      expect(screen.queryByTestId("plan-card-plan-1")).toBeNull();
    });

    it("cancelling the bulk confirmation archives nothing and keeps the selection", () => {
      const onArchive = vi.fn();
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={onArchive} />);

      fireEvent.click(screen.getByTestId("plan-select-plan-1"));
      fireEvent.click(screen.getByTestId("plan-bulk-archive"));
      fireEvent.click(screen.getByTestId("plan-bulk-confirm-cancel"));

      expect(onArchive).not.toHaveBeenCalled();
      expect(screen.queryByTestId("plan-bulk-confirm")).toBeNull();
      expect(screen.getByTestId("plan-bulk-count").textContent).toMatch(/1 plan selected/i);
    });

    it("clearing the selection removes the bar entirely", () => {
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} />);

      fireEvent.click(screen.getByTestId("plan-select-plan-1"));
      fireEvent.click(screen.getByTestId("plan-bulk-clear"));

      expect(screen.queryByTestId("plan-bulk-bar")).toBeNull();
      expect((screen.getByTestId("plan-select-plan-1") as HTMLInputElement).checked).toBe(false);
    });

    it("deselects a plan when it is clicked a second time", () => {
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} />);

      fireEvent.click(screen.getByTestId("plan-select-plan-1"));
      fireEvent.click(screen.getByTestId("plan-select-plan-1"));

      expect(screen.queryByTestId("plan-bulk-bar")).toBeNull();
    });

    // Decided rather than inherited: the show-archived toggle reveals a section
    // with no checkboxes, so nothing selectable enters or leaves.
    it("flipping the show-archived toggle leaves the selection alone", () => {
      renderWithIntl(
        <PlanList
          plans={[...twoPlans(), plan({ id: "plan-3", archivedAt: "2026-08-01T00:00:00.000Z" })]}
          now={NOW}
        />,
      );

      fireEvent.click(screen.getByTestId("plan-select-plan-1"));
      fireEvent.click(screen.getByRole("button", { name: /show archived/i }));
      fireEvent.click(screen.getByRole("button", { name: /hide archived/i }));

      expect(screen.getByTestId("plan-bulk-count").textContent).toMatch(/1 plan selected/i);
    });

    // Consistent with what a single-row archive allows today: the plan you are
    // following is archivable, and pretending otherwise by skipping it silently
    // would archive fewer plans than the user asked for.
    it("allows the currently-followed plan into the selection", async () => {
      const onArchive = vi.fn().mockImplementation((id: string) => Promise.resolve(archived(id)));
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={onArchive} />);

      expect(screen.getByTestId("plan-card-plan-1").textContent).toMatch(/currently following/i);
      fireEvent.click(screen.getByTestId("plan-select-plan-1"));
      fireEvent.click(screen.getByTestId("plan-bulk-archive"));
      fireEvent.click(screen.getByTestId("plan-bulk-confirm-yes"));

      await screen.findByTestId("plan-bulk-done");
      expect(onArchive).toHaveBeenCalledWith("plan-1");
    });

    it("archiving a selected plan on its own drops it from the selection", async () => {
      const onArchive = vi.fn().mockImplementation((id: string) => Promise.resolve(archived(id)));
      renderWithIntl(<PlanList plans={twoPlans()} now={NOW} onArchive={onArchive} />);

      fireEvent.click(screen.getByTestId("plan-select-plan-1"));
      fireEvent.click(screen.getByTestId("plan-select-plan-2"));
      fireEvent.click(screen.getByTestId("plan-archive-plan-1"));
      fireEvent.click(screen.getByTestId("plan-archive-confirm-plan-1"));

      await waitFor(() =>
        expect(screen.getByTestId("plan-bulk-count").textContent).toMatch(/1 plan selected/i),
      );
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
