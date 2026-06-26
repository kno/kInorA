import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingFeatures } from "../LandingFeatures";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingFeatures", () => {
  const messages = {
    features_eyebrow: "Product",
    features_title: "Everything you need, in one app",
    features_subtitle: "The tools a personal trainer would give you.",
    features_adaptive_title: "Adaptive plan",
    features_adaptive_desc: "Routines that readjust each week.",
    features_voice_title: "Voice assistant",
    features_voice_desc: "Mark sets without touching the screen.",
    features_tracking_title: "Live tracking",
    features_tracking_desc: "Rest timer and set logging.",
    features_stats_title: "Statistics",
    features_stats_desc: "Visualize your volume and strength.",
  };

  it("renders the section heading", () => {
    const html = renderToStaticMarkup(LandingFeatures({ messages }));
    expect(html).toContain("Product");
    expect(html).toContain("Everything you need, in one app");
  });

  it("renders all four feature cards", () => {
    const el = LandingFeatures({ messages });
    expect(textOf(el)).toContain("Adaptive plan");
    expect(textOf(el)).toContain("Voice assistant");
    expect(textOf(el)).toContain("Live tracking");
    expect(textOf(el)).toContain("Statistics");
  });

  it("renders descriptions for each feature", () => {
    const el = LandingFeatures({ messages });
    expect(textOf(el)).toContain("Routines that readjust each week.");
    expect(textOf(el)).toContain("Mark sets without touching the screen.");
  });

  it("renders the reusable section heading as semantic header markup", () => {
    const html = renderToStaticMarkup(LandingFeatures({ messages }));

    expect(html).toContain("<header");
  });
});

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean
): AnyElement | undefined {
  if (isReactElement(node)) {
    if (match(node)) return node;
    const inChildren = findFirst(node.props.children, match);
    if (inChildren) return inChildren;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFirst(child, match);
      if (found) return found;
    }
  }
  return undefined;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isReactElement(node)) return textOf(node.props.children);
  return "";
}

function isReactElement(node: ReactNode): node is AnyElement {
  return typeof node === "object" && node !== null && "props" in node;
}
