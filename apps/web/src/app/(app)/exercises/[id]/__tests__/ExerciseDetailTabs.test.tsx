// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { ExerciseDetailTabs } from "../ExerciseDetailTabs";

const props = {
  steps: ["Lie on your back.", "Curl up.", "Lower under control."],
  bodyPart: "waist",
  target: "abs",
  muscleGroup: "hip flexors",
  secondaryMuscles: ["hip flexors", "lower back"],
};

describe("ExerciseDetailTabs", () => {
  it("opens on the numbered execution list", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(screen.getByText("Lie on your back.")).toBeDefined();
  });

  it("numbers every step in order", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);

    const list = screen.getByRole("tabpanel");
    expect(list.textContent).toContain("1");
    expect(list.textContent).toContain("3");
  });

  it("switches to the muscle breakdown, which replaces the prototype's invented coach cues", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);

    fireEvent.click(screen.getByRole("tab", { name: "Muscles worked" }));

    // Taxonomy values render through the i18n catalog: standalone cells are
    // capitalised by `taxonomyLabel`, joined lists stay in sentence form.
    expect(screen.getByText("Waist")).toBeDefined();
    expect(screen.getByText("hip flexors · lower back")).toBeDefined();
    expect(screen.queryByText("Lie on your back.")).toBeNull();
  });

  it("states plainly when no assisting muscle is recorded, instead of inventing one", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} secondaryMuscles={[]} />);

    fireEvent.click(screen.getByRole("tab", { name: "Muscles worked" }));

    expect(screen.getByText("No assisting muscles recorded for this exercise.")).toBeDefined();
  });

  it("switches back to the execution steps", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);

    fireEvent.click(screen.getByRole("tab", { name: "Muscles worked" }));
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));

    expect(screen.getByText("Curl up.")).toBeDefined();
  });

  it("marks the selected tab for assistive technology", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);

    expect(screen.getByRole("tab", { name: "Execution" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Muscles worked" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });
});

/**
 * The ARIA tabs keyboard pattern.
 *
 * `role="tablist"` PROMISES arrow-key navigation. The tabs announced it while
 * implementing none of it: no roving tabindex, no key handling, and a panel
 * that could not be focused. Every test here fails against that version.
 */
describe("ExerciseDetailTabs — keyboard pattern", () => {
  const execution = () => screen.getByRole("tab", { name: "Execution" });
  const muscles = () => screen.getByRole("tab", { name: "Muscles worked" });

  it("moves to the next tab on ArrowRight, with selection following focus", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);
    execution().focus();

    fireEvent.keyDown(execution(), { key: "ArrowRight" });

    expect(document.activeElement).toBe(muscles());
    expect(muscles().getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Waist")).toBeDefined();
  });

  it("wraps past the last tab back to the first", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);

    fireEvent.keyDown(execution(), { key: "ArrowRight" });
    fireEvent.keyDown(muscles(), { key: "ArrowRight" });

    expect(document.activeElement).toBe(execution());
    expect(execution().getAttribute("aria-selected")).toBe("true");
  });

  it("moves backwards on ArrowLeft, wrapping from the first tab to the last", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);

    fireEvent.keyDown(execution(), { key: "ArrowLeft" });

    expect(document.activeElement).toBe(muscles());
    expect(muscles().getAttribute("aria-selected")).toBe("true");
  });

  it("jumps to the first tab with Home and the last with End", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);

    fireEvent.keyDown(execution(), { key: "End" });
    expect(document.activeElement).toBe(muscles());

    fireEvent.keyDown(muscles(), { key: "Home" });
    expect(document.activeElement).toBe(execution());
    expect(execution().getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the whole tablist to a SINGLE tab stop (roving tabindex)", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);

    expect(execution().getAttribute("tabindex")).toBe("0");
    expect(muscles().getAttribute("tabindex")).toBe("-1");

    fireEvent.click(muscles());

    expect(muscles().getAttribute("tabindex")).toBe("0");
    expect(execution().getAttribute("tabindex")).toBe("-1");
  });

  it("leaves keys it does not own alone, so Tab still exits the tablist", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);

    // `fireEvent` answers false when the handler called preventDefault.
    expect(fireEvent.keyDown(execution(), { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(execution(), { key: "ArrowRight" })).toBe(false);
  });

  it("makes the rendered panel focusable, on both tabs", () => {
    renderWithIntl(<ExerciseDetailTabs {...props} />);
    expect(screen.getByRole("tabpanel").getAttribute("tabindex")).toBe("0");

    fireEvent.click(muscles());
    expect(screen.getByRole("tabpanel").getAttribute("tabindex")).toBe("0");
  });
});
