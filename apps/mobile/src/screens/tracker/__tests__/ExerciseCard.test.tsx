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
    onStepWeight: vi.fn(),
    onStepReps: vi.fn(),
    onCompleteSet: vi.fn(),
    isResting: false,
    submitting: false,
    showRecordError: false,
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

  it("shows the inline record error only when showRecordError is true", () => {
    const without = renderWithIntl(<ExerciseCard {...(makeProps() as any)} />);
    expect(renderedText(without)).not.toContain("We couldn't save the set");

    const withErr = renderWithIntl(<ExerciseCard {...(makeProps({ showRecordError: true }) as any)} />);
    expect(renderedText(withErr)).toContain("We couldn't save the set. Please try again.");
  });
});
