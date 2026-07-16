/**
 * Stepper — renders label/value/unit and wires the +/- handlers, with a11y
 * labels and disabled state propagated to both buttons.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl, renderedText, findAllByType } from "./render-helpers.js";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: ({ children, ...rest }: any) => (
    <button type="button" {...rest}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-svg", () => ({
  default: "Svg",
  Svg: "Svg",
  Line: "Line",
}));

const { Stepper } = await import("../Stepper.js");

function button(renderer: ReturnType<typeof renderWithIntl>, label: string) {
  return findAllByType(renderer, "button").find((n) => n.props.accessibilityLabel === label);
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    label: "Load",
    value: "42.5",
    unit: "kg",
    decrementLabel: "Decrease load",
    incrementLabel: "Increase load",
    onDecrement: vi.fn(),
    onIncrement: vi.fn(),
    ...overrides,
  };
}

describe("Stepper", () => {
  it("renders its label, value and unit", () => {
    const r = renderWithIntl(<Stepper {...(makeProps() as any)} />);
    const text = renderedText(r);
    expect(text).toContain("Load");
    expect(text).toContain("42.5");
    expect(text).toContain("kg");
  });

  it("invokes the +/- handlers via their a11y-labelled buttons", () => {
    const props = makeProps();
    const r = renderWithIntl(<Stepper {...(props as any)} />);
    button(r, "Increase load")!.props.onPress();
    button(r, "Decrease load")!.props.onPress();
    expect(props.onIncrement).toHaveBeenCalledTimes(1);
    expect(props.onDecrement).toHaveBeenCalledTimes(1);
  });

  it("marks both buttons disabled when disabled", () => {
    const r = renderWithIntl(<Stepper {...(makeProps({ disabled: true }) as any)} />);
    expect(button(r, "Increase load")!.props.accessibilityState.disabled).toBe(true);
    expect(button(r, "Decrease load")!.props.accessibilityState.disabled).toBe(true);
  });
});
