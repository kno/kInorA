// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GoalStep } from "../GoalStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GoalStep", () => {
  it("renders a selectable card for each goal option", () => {
    render(<GoalStep onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Strength/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hypertrophy/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Fat loss/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /General fitness/i })).toBeTruthy();
  });

  it("calls onSelect with the goal value when a card is chosen", () => {
    const onSelect = vi.fn();
    render(<GoalStep onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Hypertrophy/i }));
    expect(onSelect).toHaveBeenCalledWith("hypertrophy");
  });

  it("marks the pre-selected goal as pressed", () => {
    render(<GoalStep value="strength" onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Strength/i }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /Fat loss/i }).getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
