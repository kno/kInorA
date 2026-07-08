// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Stepper } from "../Stepper";

vi.mock("../../TrackerPanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

describe("Stepper", () => {
  function setup(disabled = false) {
    const onDecrement = vi.fn();
    const onIncrement = vi.fn();
    render(
      <Stepper
        label="Load"
        labelId="load-label"
        value="42.5"
        unit="kg"
        decrementLabel="Decrease load 2.5 kg"
        incrementLabel="Increase load 2.5 kg"
        onDecrement={onDecrement}
        onIncrement={onIncrement}
        disabled={disabled}
      />,
    );
    return { onDecrement, onIncrement };
  }

  it("renders its label, value and unit", () => {
    setup();
    expect(screen.getByText("Load")).toBeTruthy();
    expect(screen.getByText("42.5")).toBeTruthy();
    expect(screen.getByText("kg")).toBeTruthy();
  });

  it("calls the +/- handlers on click", () => {
    const { onDecrement, onIncrement } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Increase load 2.5 kg" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease load 2.5 kg" }));
    expect(onIncrement).toHaveBeenCalledTimes(1);
    expect(onDecrement).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons when disabled", () => {
    setup(true);
    expect((screen.getByRole("button", { name: /increase/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /decrease/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
