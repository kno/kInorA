// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EquipmentStep } from "../EquipmentStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EquipmentStep", () => {
  it("offers gym-specific options when location is gym", () => {
    render(<EquipmentStep location="gym" value={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Barbell/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cable machine/i })).toBeTruthy();
  });

  it("offers a DIFFERENT (home) set when location is home", () => {
    render(<EquipmentStep location="home" value={[]} onSelect={vi.fn()} />);
    // Home does not expose the gym-only cable machine
    expect(screen.queryByRole("button", { name: /Cable machine/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Resistance bands/i })).toBeTruthy();
  });

  it("adds an item to the selection on click (multi-select)", () => {
    const onSelect = vi.fn();
    render(<EquipmentStep location="gym" value={["barbell"]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Dumbbells/i }));
    expect(onSelect).toHaveBeenCalledWith(["barbell", "dumbbells"]);
  });

  it("removes an already-selected item on click (toggle off)", () => {
    const onSelect = vi.fn();
    render(<EquipmentStep location="gym" value={["barbell"]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Barbell/i }));
    expect(onSelect).toHaveBeenCalledWith([]);
  });

  it("marks already-selected items as pressed", () => {
    render(<EquipmentStep location="gym" value={["barbell"]} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Barbell/i }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /Dumbbells/i }).getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
