// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PlanSpec } from "@kinora/contracts";
import { StepperShell } from "../StepperShell";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
});

function noopSave(): Promise<void> {
  return Promise.resolve();
}
function noopConfirm(): Promise<{ planId: string; status: string }> {
  return Promise.resolve({ planId: "plan-noop", status: "generating" });
}

describe("StepperShell", () => {
  it("renders the first step (goal) when there is no initial draft", () => {
    render(
      <StepperShell saveDraftAction={noopSave} confirmPlanSpecAction={noopConfirm} />,
    );
    expect(screen.getByRole("button", { name: /Strength/i })).toBeTruthy();
  });

  it("passes step progress to OrbitProgress (value=step-1, max=5)", () => {
    render(
      <StepperShell saveDraftAction={noopSave} confirmPlanSpecAction={noopConfirm} />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0"); // step 1 → value 0
    expect(bar.getAttribute("aria-valuemax")).toBe("5"); // total 6 → max 5
    expect(screen.getByText("1 / 6")).toBeTruthy();
  });

  it("disables Continue until the current required step has a value", () => {
    // The duration step (4) keeps the classic "select then Continue" flow
    // because it also offers a custom input, so it is not an auto-advance step.
    render(
      <StepperShell
        saveDraftAction={noopSave}
        confirmPlanSpecAction={noopConfirm}
        initialDraft={{
          step: 4,
          spec: { goal: "strength", location: "gym", daysPerWeek: 3 },
        }}
      />,
    );
    const cont = screen.getByRole("button", { name: /Continue/i }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /60 min/i }));
    expect(cont.disabled).toBe(false);
  });

  it("advances to the next step and saves a draft when a single choice is made", async () => {
    const saveDraftAction =
      vi.fn<(step: number, spec: Partial<PlanSpec>) => Promise<void>>().mockResolvedValue(
        undefined,
      );
    render(
      <StepperShell
        saveDraftAction={saveDraftAction}
        confirmPlanSpecAction={noopConfirm}
      />,
    );
    // Single-choice step: picking the goal advances without a Continue click.
    fireEvent.click(screen.getByRole("button", { name: /Strength/i }));

    await waitFor(() => {
      expect(saveDraftAction).toHaveBeenCalledTimes(1);
    });
    // We are now on step 2 (location)
    expect(screen.getByText("2 / 6")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Home/i })).toBeTruthy();
    // The draft submission carried step 2 and the chosen goal
    const firstCall = saveDraftAction.mock.calls[0]!;
    const [step, spec] = firstCall;
    expect(step).toBe(2);
    expect(spec.goal).toBe("strength");
  });

  it("preserves prior values when navigating Back (local, no server call)", () => {
    const saveDraftAction = vi.fn().mockResolvedValue(undefined);
    render(
      <StepperShell
        saveDraftAction={saveDraftAction}
        confirmPlanSpecAction={noopConfirm}
        initialDraft={{ step: 2, spec: { goal: "hypertrophy" } }}
      />,
    );
    // Start at step 2 (location); go Back to step 1 (goal)
    fireEvent.click(screen.getByRole("button", { name: /Back/i }));
    expect(screen.getByText("1 / 6")).toBeTruthy();
    // The previously chosen goal is still selected
    expect(
      screen.getByRole("button", { name: /Hypertrophy/i }).getAttribute("aria-pressed"),
    ).toBe("true");
    // Back does not hit the server
    expect(saveDraftAction).not.toHaveBeenCalled();
  });

  it("resumes at the draft step with pre-filled values", () => {
    render(
      <StepperShell
        saveDraftAction={noopSave}
        confirmPlanSpecAction={noopConfirm}
        initialDraft={{
          step: 3,
          spec: { goal: "strength", location: "gym" },
        }}
      />,
    );
    expect(screen.getByText("3 / 6")).toBeTruthy();
    // Step 3 is frequency
    expect(screen.getByRole("button", { name: /3 days/i })).toBeTruthy();
  });

  it("keeps Finish disabled until all required inputs are present", () => {
    render(
      <StepperShell
        saveDraftAction={noopSave}
        confirmPlanSpecAction={noopConfirm}
        initialDraft={{
          step: 6,
          spec: {
            goal: "strength",
            location: "gym",
            daysPerWeek: 3,
            // sessionDurationMinutes missing → incomplete
            equipment: [],
            limitations: [],
          },
        }}
      />,
    );
    const finish = screen.getByRole("button", { name: /Finish/i }) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
  });

  it("saves a complete draft then confirms and navigates on Finish", async () => {
    const saveDraftAction =
      vi.fn<(step: number, spec: Partial<PlanSpec>) => Promise<void>>().mockResolvedValue(
        undefined,
      );
    const confirmPlanSpecAction = vi.fn().mockResolvedValue({ planId: "plan-999", status: "generating" });
    render(
      <StepperShell
        saveDraftAction={saveDraftAction}
        confirmPlanSpecAction={confirmPlanSpecAction}
        initialDraft={{
          step: 6,
          spec: {
            goal: "strength",
            location: "gym",
            daysPerWeek: 3,
            sessionDurationMinutes: 60,
            equipment: ["barbell"],
            limitations: [],
          },
        }}
      />,
    );
    const finish = screen.getByRole("button", { name: /Finish/i }) as HTMLButtonElement;
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish);
    await waitFor(() => {
      expect(confirmPlanSpecAction).toHaveBeenCalledTimes(1);
    });
    // The final answers are persisted before promote. The server action
    // enriches the draft with preferenceScores; the shell forwards the spec.
    const [step, finalSpec] = saveDraftAction.mock.calls[0]!;
    expect(step).toBe(6);
    expect(finalSpec.goal).toBe("strength");
    expect(finalSpec.sessionDurationMinutes).toBe(60);
    // On success the wizard navigates to the plan status view with the planId.
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/plan/plan-999");
    });
  });

  it("renders the equipment step and defaults equipment to [] when entered", async () => {
    const saveDraftAction =
      vi.fn<(step: number, spec: Partial<PlanSpec>) => Promise<void>>().mockResolvedValue(
        undefined,
      );
    render(
      <StepperShell
        saveDraftAction={saveDraftAction}
        confirmPlanSpecAction={noopConfirm}
        initialDraft={{
          step: 4,
          spec: { goal: "strength", location: "gym", daysPerWeek: 3 },
        }}
      />,
    );
    // step 4 (duration) → pick 60 → Continue lands on step 5 (equipment)
    fireEvent.click(screen.getByRole("button", { name: /60 min/i }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText("5 / 6")).toBeTruthy());
    // Equipment options for gym are shown
    expect(screen.getByRole("button", { name: /Barbell/i })).toBeTruthy();
    // The draft submitted for step 5 carries an empty equipment array
    const [, spec] = saveDraftAction.mock.calls[0]!;
    expect(spec.equipment).toEqual([]);
  });

  it("renders the limitations step (step 6) with a text input", () => {
    render(
      <StepperShell
        saveDraftAction={noopSave}
        confirmPlanSpecAction={noopConfirm}
        initialDraft={{
          step: 6,
          spec: {
            goal: "strength",
            location: "gym",
            daysPerWeek: 3,
            sessionDurationMinutes: 60,
            equipment: [],
            limitations: [],
          },
        }}
      />,
    );
    expect(screen.getByRole("textbox", { name: /limitation/i })).toBeTruthy();
  });

  it("offers a continue-or-overwrite choice when resuming an existing draft", () => {
    render(
      <StepperShell
        saveDraftAction={noopSave}
        confirmPlanSpecAction={noopConfirm}
        initialDraft={{ step: 3, spec: { goal: "strength", location: "gym" } }}
      />,
    );
    // The overwrite affordance is offered when a saved draft is resumed
    expect(screen.getByRole("button", { name: /Start over/i })).toBeTruthy();
  });

  it("resets to step 1 with empty values when Start over is chosen", () => {
    render(
      <StepperShell
        saveDraftAction={noopSave}
        confirmPlanSpecAction={noopConfirm}
        initialDraft={{ step: 3, spec: { goal: "strength", location: "gym" } }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Start over/i }));
    expect(screen.getByText("1 / 6")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Strength/i }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  describe("auto-advance on single-choice steps", () => {
    it("advances to the next step immediately after picking a goal (step 1)", async () => {
      const saveDraftAction = vi.fn().mockResolvedValue(undefined);
      render(
        <StepperShell
          saveDraftAction={saveDraftAction}
          confirmPlanSpecAction={noopConfirm}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /Strength/i }));
      // No explicit Continue click — selection alone advances to step 2.
      await waitFor(() => expect(screen.getByText("2 / 6")).toBeTruthy());
      expect(screen.getByRole("button", { name: /Home/i })).toBeTruthy();
      const [step, spec] = saveDraftAction.mock.calls[0]!;
      expect(step).toBe(2);
      expect(spec.goal).toBe("strength");
    });

    it("advances after picking a location (step 2)", async () => {
      const saveDraftAction = vi.fn().mockResolvedValue(undefined);
      render(
        <StepperShell
          saveDraftAction={saveDraftAction}
          confirmPlanSpecAction={noopConfirm}
          initialDraft={{ step: 2, spec: { goal: "strength" } }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /Gym/i }));
      await waitFor(() => expect(screen.getByText("3 / 6")).toBeTruthy());
    });

    it("advances after picking a frequency (step 3)", async () => {
      const saveDraftAction = vi.fn().mockResolvedValue(undefined);
      render(
        <StepperShell
          saveDraftAction={saveDraftAction}
          confirmPlanSpecAction={noopConfirm}
          initialDraft={{ step: 3, spec: { goal: "strength", location: "gym" } }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /4 days/i }));
      await waitFor(() => expect(screen.getByText("4 / 6")).toBeTruthy());
    });

    it("does NOT auto-advance on the duration step (step 4 has a custom input)", async () => {
      const saveDraftAction = vi.fn().mockResolvedValue(undefined);
      render(
        <StepperShell
          saveDraftAction={saveDraftAction}
          confirmPlanSpecAction={noopConfirm}
          initialDraft={{
            step: 4,
            spec: { goal: "strength", location: "gym", daysPerWeek: 3 },
          }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /60 min/i }));
      // Still on step 4 — the user confirms duration with Continue.
      expect(screen.getByText("4 / 6")).toBeTruthy();
      expect(saveDraftAction).not.toHaveBeenCalled();
    });

    it("does NOT auto-advance on the equipment step (step 5, multi-choice)", async () => {
      const saveDraftAction = vi.fn().mockResolvedValue(undefined);
      render(
        <StepperShell
          saveDraftAction={saveDraftAction}
          confirmPlanSpecAction={noopConfirm}
          initialDraft={{
            step: 5,
            spec: {
              goal: "strength",
              location: "gym",
              daysPerWeek: 3,
              sessionDurationMinutes: 60,
              equipment: [],
            },
          }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /Barbell/i }));
      // Multi-choice: stay so the user can pick more before Continue.
      expect(screen.getByText("5 / 6")).toBeTruthy();
      expect(saveDraftAction).not.toHaveBeenCalled();
    });

    it("keeps a picked value selected after navigating Back to a single-choice step", async () => {
      const saveDraftAction = vi.fn().mockResolvedValue(undefined);
      render(
        <StepperShell
          saveDraftAction={saveDraftAction}
          confirmPlanSpecAction={noopConfirm}
          initialDraft={{ step: 2, spec: { goal: "strength" } }}
        />,
      );
      // Pick a location → auto-advance to step 3.
      fireEvent.click(screen.getByRole("button", { name: /Gym/i }));
      await waitFor(() => expect(screen.getByText("3 / 6")).toBeTruthy());
      // Back to step 2 → the earlier location is still selected.
      fireEvent.click(screen.getByRole("button", { name: /Back/i }));
      expect(screen.getByText("2 / 6")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /Gym/i }).getAttribute("aria-pressed"),
      ).toBe("true");
    });
  });
});
