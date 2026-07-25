// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { CreatePlanShell } from "../CreatePlanShell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Isolate the shell's mode/tier logic from the child internals.
vi.mock("../StepperShell", () => ({
  StepperShell: () => <div data-testid="stepper-shell" />,
}));
vi.mock("../AssistantPane", () => ({
  AssistantPane: () => <div data-testid="assistant-pane" />,
}));

const noopSave = () => Promise.resolve();
const noopConfirm = () => Promise.resolve({ planId: "p1", status: "generating" });

function renderShell(overrides: Partial<Parameters<typeof CreatePlanShell>[0]> = {}) {
  renderWithIntl(
    <CreatePlanShell
      defaultMode={overrides.defaultMode ?? "asistente"}
      isPro={overrides.isPro ?? true}
      upgradePath={overrides.upgradePath ?? "/billing#pro-card"}
      saveDraftAction={noopSave}
      confirmPlanSpecAction={noopConfirm}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CreatePlanShell — tier-based default mode", () => {
  it("defaults a Pro tenant to the Asistente pane", () => {
    renderShell({ isPro: true, defaultMode: "asistente" });
    expect(screen.getByTestId("assistant-pane")).toBeTruthy();
    expect(screen.queryByTestId("stepper-shell")).toBeNull();
  });

  it("defaults a Free tenant to the Formulario wizard", () => {
    renderShell({ isPro: false, defaultMode: "formulario" });
    expect(screen.getByTestId("stepper-shell")).toBeTruthy();
    expect(screen.queryByTestId("assistant-pane")).toBeNull();
  });

  it("lets a Pro tenant toggle from Asistente to Formulario and back", () => {
    renderShell({ isPro: true, defaultMode: "asistente" });
    fireEvent.click(screen.getByRole("button", { name: /form/i }));
    expect(screen.getByTestId("stepper-shell")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /assistant/i }));
    expect(screen.getByTestId("assistant-pane")).toBeTruthy();
  });
});

describe("CreatePlanShell — Free teaser + upgrade CTA", () => {
  it("shows an Asistente teaser and a Mejora-a-Pro CTA to Free, never a working chat", () => {
    renderShell({ isPro: false, defaultMode: "formulario" });
    // Switch to the Asistente tab: Free sees a teaser, NOT the chat pane.
    fireEvent.click(screen.getByRole("button", { name: /assistant/i }));
    expect(screen.queryByTestId("assistant-pane")).toBeNull();

    const cta = screen.getByRole("link", { name: /upgrade to pro/i });
    expect(cta.getAttribute("href")).toBe("/billing#pro-card");
  });

  it("never renders the working chat pane for a Free tenant", () => {
    renderShell({ isPro: false, defaultMode: "asistente" });
    // Even if the default were Asistente, a Free tenant gets the teaser only.
    expect(screen.queryByTestId("assistant-pane")).toBeNull();
    expect(screen.getByRole("link", { name: /upgrade to pro/i })).toBeTruthy();
  });
});
