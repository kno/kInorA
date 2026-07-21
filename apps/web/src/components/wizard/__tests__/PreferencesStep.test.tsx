// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { PreferencesStep } from "../PreferencesStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PreferencesStep", () => {
  it("renders the preference sections with pre-filled values", () => {
    renderWithIntl(
      <PreferencesStep
        value={{
          defaultLocation: "gym",
          defaultDuration: 45,
          defaultEquipment: ["barbell"],
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/default location/i)).toBeTruthy();
    expect(screen.getByText(/default session duration/i)).toBeTruthy();
    expect(screen.getByText(/default equipment/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /gym/i }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /45 min/i }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /barbell/i }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("reports updated defaults when the user changes location, duration, and equipment", () => {
    const onChange = vi.fn();
    renderWithIntl(
      <PreferencesStep
        value={{
          defaultLocation: "home",
          defaultDuration: null,
          defaultEquipment: null,
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /home/i }));
    expect(onChange).toHaveBeenLastCalledWith({
      defaultLocation: "home",
      defaultDuration: null,
      defaultEquipment: null,
    });

    fireEvent.click(screen.getByRole("button", { name: /30 min/i }));
    expect(onChange).toHaveBeenLastCalledWith({
      defaultLocation: "home",
      defaultDuration: 30,
      defaultEquipment: null,
    });

    fireEvent.click(screen.getByRole("button", { name: /dumbbells/i }));
    expect(onChange).toHaveBeenLastCalledWith({
      defaultLocation: "home",
      defaultDuration: null,
      defaultEquipment: ["dumbbells"],
    });
  });
});
