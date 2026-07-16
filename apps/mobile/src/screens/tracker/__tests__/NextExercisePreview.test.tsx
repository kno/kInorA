/**
 * NextExercisePreview — renders the eyebrow, title and pre-resolved detail,
 * and mirrors the eyebrow onto the row's a11y label.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl, renderedText, findAllByType } from "./render-helpers.js";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-svg", () => ({
  default: "Svg",
  Svg: "Svg",
  Circle: "Circle",
  Path: "Path",
  Polyline: "Polyline",
}));

const { NextExercisePreview } = await import("../NextExercisePreview.js");

describe("NextExercisePreview", () => {
  it("renders the eyebrow, title and detail", () => {
    const r = renderWithIntl(
      <NextExercisePreview title="Press banca" detail="3 sets · 30 kg × 10 reps" />,
    );
    const text = renderedText(r);
    expect(text).toContain("Up next");
    expect(text).toContain("Press banca");
    expect(text).toContain("3 sets · 30 kg × 10 reps");
  });

  it("mirrors the eyebrow onto the row a11y label", () => {
    const r = renderWithIntl(<NextExercisePreview title="Press banca" detail="x" />);
    const row = findAllByType(r, "View").find((n) => n.props.accessibilityLabel === "Up next");
    expect(row).toBeTruthy();
  });
});
