// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FrequencyStep } from "../FrequencyStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FrequencyStep", () => {
  it("renders a card for each supported day-count", () => {
    render(<FrequencyStep onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /2 days/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /5 days/i })).toBeTruthy();
  });

  it("calls onSelect with the numeric day count", () => {
    const onSelect = vi.fn();
    render(<FrequencyStep onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /4 days/i }));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it("reflects the pre-selected frequency", () => {
    render(<FrequencyStep value={3} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /3 days/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
