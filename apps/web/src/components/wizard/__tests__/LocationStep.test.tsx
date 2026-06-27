// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LocationStep } from "../LocationStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LocationStep", () => {
  it("renders the three training-location options", () => {
    render(<LocationStep onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Home/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gym/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Outdoor/i })).toBeTruthy();
  });

  it("calls onSelect with the location value", () => {
    const onSelect = vi.fn();
    render(<LocationStep onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Gym/i }));
    expect(onSelect).toHaveBeenCalledWith("gym");
  });

  it("reflects the pre-selected location", () => {
    render(<LocationStep value="outdoor" onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Outdoor/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
