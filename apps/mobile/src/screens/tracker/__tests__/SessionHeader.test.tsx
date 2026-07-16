/**
 * SessionHeader — renders the eyebrow, title and formatted elapsed timer in
 * both locales, toggles the pause/resume a11y label, and wires the toggle.
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
  Rect: "Rect",
  Polygon: "Polygon",
}));

const { SessionHeader } = await import("../SessionHeader.js");

describe("SessionHeader", () => {
  it("renders the eyebrow, title and formatted elapsed (mm:ss), EN + ES", () => {
    const en = renderWithIntl(
      <SessionHeader title="Sentadilla" elapsed={83} paused={false} onTogglePause={vi.fn()} />,
      "en",
    );
    const enText = renderedText(en);
    expect(enText).toContain("Active session");
    expect(enText).toContain("Sentadilla");
    expect(enText).toContain("01:23");

    const es = renderWithIntl(
      <SessionHeader title="Sentadilla" elapsed={83} paused={false} onTogglePause={vi.fn()} />,
      "es",
    );
    expect(renderedText(es)).toContain("Sesión activa");
  });

  it("uses the pause label when running and the resume label when paused", () => {
    const running = renderWithIntl(
      <SessionHeader title="X" elapsed={0} paused={false} onTogglePause={vi.fn()} />,
    );
    const runBtn = findAllByType(running, "button")[0];
    expect(runBtn.props.accessibilityLabel).toBe("Pause session");

    const paused = renderWithIntl(
      <SessionHeader title="X" elapsed={0} paused onTogglePause={vi.fn()} />,
    );
    expect(findAllByType(paused, "button")[0].props.accessibilityLabel).toBe("Resume session");
  });

  it("fires onTogglePause when the button is pressed", () => {
    const onTogglePause = vi.fn();
    const r = renderWithIntl(
      <SessionHeader title="X" elapsed={0} paused={false} onTogglePause={onTogglePause} />,
    );
    findAllByType(r, "button")[0].props.onPress();
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });
});
