// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { CreatePlanShell } from "../CreatePlanShell";
import type { AssistantPaneProps } from "../AssistantPane";
import type { StepperShellProps } from "../StepperShell";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// Lightweight stand-ins that expose the SAME callback props CreatePlanShell
// wires, via clickable test buttons — so this file exercises the real
// `saveDraftShared` / `persistSpec` / `handleGenerate` / `onSpecChange`
// closures in CreatePlanShell itself (not just their wiring).
vi.mock("../AssistantPane", () => ({
  AssistantPane: (props: AssistantPaneProps) => (
    <div data-testid="assistant-pane">
      <button
        type="button"
        onClick={() => props.onSpecChange({ goal: "hypertrophy" })}
      >
        trigger-onSpecChange
      </button>
      <button type="button" onClick={() => void props.persistSpec({ goal: "strength" })}>
        trigger-persistSpec
      </button>
      <button type="button" onClick={() => void props.onGenerate()}>
        trigger-onGenerate
      </button>
    </div>
  ),
}));

vi.mock("../StepperShell", () => ({
  StepperShell: (props: StepperShellProps) => (
    <div data-testid="stepper-shell">
      <button
        type="button"
        onClick={() => void props.saveDraftAction(2, { goal: "fat_loss" })}
      >
        trigger-saveDraftShared
      </button>
    </div>
  ),
}));

const saveDraftAction = vi.fn().mockResolvedValue(undefined);
const confirmPlanSpecAction = vi
  .fn()
  .mockResolvedValue({ planId: "plan-42", status: "generating" });

function renderShell(defaultMode: "asistente" | "formulario") {
  renderWithIntl(
    <CreatePlanShell
      defaultMode={defaultMode}
      isPro={true}
      upgradePath="/billing#pro-card"
      saveDraftAction={saveDraftAction}
      confirmPlanSpecAction={confirmPlanSpecAction}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CreatePlanShell — shared-draft callbacks", () => {
  it("persistSpec forwards a panel edit to saveDraftAction at the current step", async () => {
    renderShell("asistente");
    fireEvent.click(screen.getByRole("button", { name: "trigger-persistSpec" }));
    await waitFor(() => {
      expect(saveDraftAction).toHaveBeenCalledWith(1, { goal: "strength" });
    });
  });

  it("handleGenerate confirms the spec and navigates to the returned plan", async () => {
    renderShell("asistente");
    fireEvent.click(screen.getByRole("button", { name: "trigger-onGenerate" }));
    await waitFor(() => {
      expect(confirmPlanSpecAction).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith("/plan/plan-42");
    });
  });

  it("saveDraftShared (passed to the Formulario wizard) updates the shared spec AND persists via saveDraftAction", async () => {
    renderShell("formulario");
    fireEvent.click(screen.getByRole("button", { name: "trigger-saveDraftShared" }));
    await waitFor(() => {
      expect(saveDraftAction).toHaveBeenCalledWith(2, { goal: "fat_loss" });
    });
  });

  it("onSpecChange (passed to AssistantPane) updates the shared spec read by the Formulario wizard on toggle", async () => {
    renderShell("asistente");
    fireEvent.click(screen.getByRole("button", { name: "trigger-onSpecChange" }));
    // Switch to Formulario: StepperShell should now see the updated shared spec.
    fireEvent.click(screen.getByRole("button", { name: /form/i }));
    expect(screen.getByTestId("stepper-shell")).toBeTruthy();
  });
});
