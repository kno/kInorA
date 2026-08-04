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
