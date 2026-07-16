/**
 * Smoke test for the tracker SVG icons — pure static glyphs, so we only prove
 * each renders to an `Svg` root without throwing (the mocked `react-native-svg`
 * turns primitives into host-string tags).
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { create, act } from "react-test-renderer";

vi.mock("react-native-svg", () => ({
  default: "Svg",
  Svg: "Svg",
  Circle: "Circle",
  G: "G",
  Line: "Line",
  Path: "Path",
  Polygon: "Polygon",
  Polyline: "Polyline",
  Rect: "Rect",
}));

const icons = await import("../icons.js");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("tracker icons", () => {
  const names = [
    "PauseIcon",
    "PlayIcon",
    "MinusIcon",
    "PlusIcon",
    "CheckIcon",
    "PersonIcon",
    "ChevronIcon",
    "StopIcon",
  ] as const;

  it.each(names)("%s renders an Svg root", (name) => {
    const Icon = (icons as any)[name];
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Icon />);
    });
    const tree = renderer.toJSON() as any;
    expect(tree).not.toBeNull();
    expect(tree.type).toBe("Svg");
  });
});
