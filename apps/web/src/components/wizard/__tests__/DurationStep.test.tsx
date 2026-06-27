// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DurationStep } from "../DurationStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DurationStep", () => {
  it("renders a card for each session-duration option", () => {
    render(<DurationStep onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /30 min/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /60 min/i })).toBeTruthy();
  });

  it("calls onSelect with the duration in minutes", () => {
    const onSelect = vi.fn();
    render(<DurationStep onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /45 min/i }));
    expect(onSelect).toHaveBeenCalledWith(45);
  });

  it("reflects the pre-selected duration", () => {
    render(<DurationStep value={90} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /90 min/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
