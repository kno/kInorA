// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { LocationStep } from "../LocationStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LocationStep", () => {
  it("renders the three training-location options via next-intl", () => {
    renderWithIntl(<LocationStep onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Home/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gym/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Outdoor/i })).toBeTruthy();
  });

  it("calls onSelect with the location value", () => {
    const onSelect = vi.fn();
    renderWithIntl(<LocationStep onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Gym/i }));
    expect(onSelect).toHaveBeenCalledWith("gym");
  });

  it("reflects the pre-selected location", () => {
    renderWithIntl(<LocationStep value="outdoor" onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Outdoor/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
