/**
 * SessionProgress — renders the "Exercise n of m" label + percent, exposes the
 * progressbar a11y value/label, and paints one segment per exercise state.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { renderWithIntl, renderedText, findAllByType } from "./render-helpers.js";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  StyleSheet: { create: (styles: unknown) => styles },
}));

const { SessionProgress } = await import("../SessionProgress.js");
import type { SegmentState } from "../tracker-logic.js";

const segments: SegmentState[] = ["done", "active", "pending"];

describe("SessionProgress", () => {
  it("renders the label and percent, EN + ES", () => {
    const en = renderWithIntl(
      <SessionProgress currentExerciseNumber={2} exerciseCount={3} percent={45} segments={segments} />,
      "en",
    );
    const enText = renderedText(en);
    expect(enText).toContain("Exercise 2 of 3");
    expect(enText).toContain("45%");

    const es = renderWithIntl(
      <SessionProgress currentExerciseNumber={2} exerciseCount={3} percent={45} segments={segments} />,
      "es",
    );
    expect(renderedText(es)).toContain("45%");
  });

  it("exposes progressbar role with an a11y value text", () => {
    const r = renderWithIntl(
      <SessionProgress currentExerciseNumber={2} exerciseCount={3} percent={45} segments={segments} />,
    );
    const bar = findAllByType(r, "View").find((n) => n.props.accessibilityRole === "progressbar");
    expect(bar).toBeTruthy();
    expect(bar.props.accessibilityValue.text).toContain("45");
    expect(typeof bar.props.accessibilityLabel).toBe("string");
  });

  it("renders one segment per state", () => {
    const r = renderWithIntl(
      <SessionProgress currentExerciseNumber={1} exerciseCount={3} percent={0} segments={segments} />,
    );
    const bar = findAllByType(r, "View").find((n) => n.props.accessibilityRole === "progressbar");
    expect(Array.isArray(bar.children) ? bar.children.length : 0).toBe(3);
  });
});
