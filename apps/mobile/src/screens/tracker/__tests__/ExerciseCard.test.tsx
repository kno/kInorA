/**
 * ExerciseCard — renders eyebrow/name/set-info + the CTA, formats the load
 * value, wires the step and complete handlers, disables while resting, and
 * shows the inline record error only when asked.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl, renderedText, findAllByType } from "./render-helpers.js";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: (props: any) => <input {...props} />,
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
  Polyline: "Polyline",
}));

const { ExerciseCard } = await import("../ExerciseCard.js");

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    title: "Sentadilla",
    currentSetNumber: 2,
    setsInCurrentExercise: 4,
    objective: "40 kg × 8 reps",
    weight: 42.5,
    reps: 8,
    weightStep: 2.5,
    onSelectWeightStep: vi.fn(),
    onStepWeight: vi.fn(),
    onStepReps: vi.fn(),
    onCompleteSet: vi.fn(),
    isResting: false,
    submitting: false,
    showRecordError: false,
    rpeInput: "",
    onChangeRpe: vi.fn(),
    ...overrides,
  };
}

function btn(r: ReturnType<typeof renderWithIntl>, label: string) {
  return findAllByType(r, "button").find((n) => n.props.accessibilityLabel === label);
}
// CTA a11y label is "Complete set {setNumber}" — setNumber=2 in makeProps().
function completeBtn(r: ReturnType<typeof renderWithIntl>) {
  return btn(r, "Complete set 2");
}

describe("ExerciseCard", () => {
  it("renders name, eyebrow, set-info (with objective) and the CTA", () => {
    const r = renderWithIntl(<ExerciseCard {...(makeProps() as any)} />);
    const text = renderedText(r);
    expect(text).toContain("Current exercise");
    expect(text).toContain("Sentadilla");
    expect(text).toContain("Set 2 of 4");
    expect(text).toContain("40 kg × 8 reps");
    expect(text).toContain("Complete set");
    expect(text).toContain("42.5"); // formatted load value
  });

  it("wires the step handlers with direction", () => {
    const props = makeProps();
    const r = renderWithIntl(<ExerciseCard {...(props as any)} />);
    btn(r, "Increase load 2.5 kg")?.props.onPress();
    btn(r, "Decrease load 2.5 kg")?.props.onPress();
    btn(r, "Increase rep")?.props.onPress();
    btn(r, "Decrease rep")?.props.onPress();
    expect(props.onStepWeight).toHaveBeenCalledWith(1);
    expect(props.onStepWeight).toHaveBeenCalledWith(-1);
    expect(props.onStepReps).toHaveBeenCalledWith(1);
    expect(props.onStepReps).toHaveBeenCalledWith(-1);
  });

  it("disables the complete CTA while resting or submitting", () => {
    const resting = renderWithIntl(<ExerciseCard {...(makeProps({ isResting: true }) as any)} />);
    expect(completeBtn(resting)!.props.accessibilityState.disabled).toBe(true);
  });

  it("fires onCompleteSet from the CTA", () => {
    const props = makeProps();
    const r = renderWithIntl(<ExerciseCard {...(props as any)} />);
    completeBtn(r)!.props.onPress();
    expect(props.onCompleteSet).toHaveBeenCalledTimes(1);
  });

  // The load-step selector a11y label is "Set increment to {step} kg".
  function stepOption(r: ReturnType<typeof renderWithIntl>, step: number) {
    return btn(r, `Set increment to ${step} kg`);
  }

  it("renders all four selectable load-step options", () => {
    const r = renderWithIntl(<ExerciseCard {...(makeProps() as any)} />);
    for (const step of [0.5, 1, 2.5, 5]) {
      expect(stepOption(r, step)).toBeDefined();
    }
  });

  it("marks the option equal to weightStep as selected", () => {
    const r = renderWithIntl(<ExerciseCard {...(makeProps({ weightStep: 5 }) as any)} />);
    expect(stepOption(r, 5)!.props.accessibilityState.selected).toBe(true);
    expect(stepOption(r, 2.5)!.props.accessibilityState.selected).toBe(false);
    expect(stepOption(r, 0.5)!.props.accessibilityState.selected).toBe(false);
    expect(stepOption(r, 1)!.props.accessibilityState.selected).toBe(false);
  });

  it("calls onSelectWeightStep with the numeric value when an option is pressed", () => {
    const props = makeProps();
    const r = renderWithIntl(<ExerciseCard {...(props as any)} />);
    stepOption(r, 0.5)!.props.onPress();
    stepOption(r, 5)!.props.onPress();
    expect(props.onSelectWeightStep).toHaveBeenCalledWith(0.5);
    expect(props.onSelectWeightStep).toHaveBeenCalledWith(5);
  });

  it("disables the load-step options while resting", () => {
    const r = renderWithIntl(<ExerciseCard {...(makeProps({ isResting: true }) as any)} />);
    for (const step of [0.5, 1, 2.5, 5]) {
      expect(stepOption(r, step)!.props.accessibilityState.disabled).toBe(true);
    }
  });

  it("shows the inline record error only when showRecordError is true", () => {
    const without = renderWithIntl(<ExerciseCard {...(makeProps() as any)} />);
    expect(renderedText(without)).not.toContain("We couldn't save the set");

    const withErr = renderWithIntl(<ExerciseCard {...(makeProps({ showRecordError: true }) as any)} />);
    expect(renderedText(withErr)).toContain("We couldn't save the set. Please try again.");
  });

  // 14b-v1.1 Slice B: mobile RPE capture parity with web's ExerciseCard.
  function rpeInputNode(r: ReturnType<typeof renderWithIntl>) {
    return findAllByType(r, "input").find((n) => n.props.accessibilityLabel === "RPE, optional, 0 to 10");
  }

  it("renders an optional 0-10 RPE input with an accessible label", () => {
    const r = renderWithIntl(<ExerciseCard {...(makeProps({ rpeInput: "7" }) as any)} />);
    const node = rpeInputNode(r);
    expect(node).toBeDefined();
    expect(node!.props.value).toBe("7");
    expect(node!.props.keyboardType).toBe("numeric");
  });

  it("calls onChangeRpe with the raw text as the user types", () => {
    const props = makeProps();
    const r = renderWithIntl(<ExerciseCard {...(props as any)} />);
    rpeInputNode(r)!.props.onChangeText("8");
    expect(props.onChangeRpe).toHaveBeenCalledWith("8");
  });

  it("renders with an empty RPE input when none was entered (optional)", () => {
    const r = renderWithIntl(<ExerciseCard {...(makeProps({ rpeInput: "" }) as any)} />);
    expect(rpeInputNode(r)!.props.value).toBe("");
  });
});
