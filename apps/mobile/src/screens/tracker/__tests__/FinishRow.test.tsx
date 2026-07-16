/**
 * FinishRow — renders the finish CTA, wires onFinish, reflects submitting into
 * the button's disabled a11y state, and shows the complete error only on ask.
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
}));

const { FinishRow } = await import("../FinishRow.js");

function finishButton(r: ReturnType<typeof renderWithIntl>) {
  return findAllByType(r, "button").find(
    (n) => n.props.accessibilityLabel === "Finish workout session",
  );
}

describe("FinishRow", () => {
  it("renders the finish CTA", () => {
    const r = renderWithIntl(
      <FinishRow onFinish={vi.fn()} submitting={false} showCompleteError={false} />,
    );
    expect(renderedText(r)).toContain("Finish session");
  });

  it("fires onFinish when pressed", () => {
    const onFinish = vi.fn();
    const r = renderWithIntl(
      <FinishRow onFinish={onFinish} submitting={false} showCompleteError={false} />,
    );
    finishButton(r)!.props.onPress();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("reflects submitting into the disabled a11y state", () => {
    const r = renderWithIntl(
      <FinishRow onFinish={vi.fn()} submitting showCompleteError={false} />,
    );
    expect(finishButton(r)!.props.accessibilityState.disabled).toBe(true);
  });

  it("shows the complete error only when showCompleteError is true", () => {
    const without = renderWithIntl(
      <FinishRow onFinish={vi.fn()} submitting={false} showCompleteError={false} />,
    );
    expect(renderedText(without)).not.toContain("We couldn't finish the session");

    const withErr = renderWithIntl(
      <FinishRow onFinish={vi.fn()} submitting={false} showCompleteError />,
    );
    expect(renderedText(withErr)).toContain("We couldn't finish the session. Please try again.");
  });
});
