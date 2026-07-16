/**
 * RestCard — renders the heading, formatted countdown and action copy, exposes
 * the rest a11y label, and wires the add-time / skip handlers (both skip
 * affordances hit the same handler).
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
  Circle: "Circle",
  G: "G",
}));

const { RestCard } = await import("../RestCard.js");

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    restRemaining: 90,
    restDuration: 90,
    restColor: "#f59e0b",
    onAddTime: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  };
}

function btn(r: ReturnType<typeof renderWithIntl>, label: string) {
  return findAllByType(r, "button").filter((n) => n.props.accessibilityLabel === label);
}

describe("RestCard", () => {
  it("renders heading, formatted countdown and action copy", () => {
    const r = renderWithIntl(<RestCard {...(makeProps() as any)} />);
    const text = renderedText(r);
    expect(text).toContain("Rest active");
    expect(text).toContain("1:30"); // formatCountdown(90)
    expect(text).toContain("+15 s");
    expect(text).toContain("Skip rest");
  });

  it("exposes the rest a11y label", () => {
    const r = renderWithIntl(<RestCard {...(makeProps() as any)} />);
    const card = findAllByType(r, "View").find((n) => n.props.accessibilityLabel === "Rest timer");
    expect(card).toBeTruthy();
  });

  it("fires onAddTime and onSkip (both skip affordances share the handler)", () => {
    const props = makeProps();
    const r = renderWithIntl(<RestCard {...(props as any)} />);
    btn(r, "Add 15 seconds")[0].props.onPress();
    // top shortcut + bottom button both labelled "Skip rest"
    const skips = btn(r, "Skip rest");
    expect(skips.length).toBe(2);
    skips.forEach((s) => s.props.onPress());
    expect(props.onAddTime).toHaveBeenCalledTimes(1);
    expect(props.onSkip).toHaveBeenCalledTimes(2);
  });
});
