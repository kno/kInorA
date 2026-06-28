import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingCTA } from "../LandingCTA";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingCTA", () => {
  const messages = {
    cta_title: "Your next routine is waiting",
    cta_subtitle: "Create your plan in under a minute. Free, no credit card.",
    cta_primary: "Start free",
    cta_secondary: "View plans",
  };

  it("renders the heading and subtitle", () => {
    const html = renderToStaticMarkup(LandingCTA({ messages }));
    expect(html).toContain("Your next routine is waiting");
    expect(html).toContain("Create your plan in under a minute. Free, no credit card.");
  });

  it("renders both CTA buttons", () => {
    const html = renderToStaticMarkup(LandingCTA({ messages }));
    expect(html).toContain("Start free");
    expect(html).toContain("View plans");
  });

  it("wraps the CTA content in a section", () => {
    const html = renderToStaticMarkup(LandingCTA({ messages }));
    expect((html.match(/<section\b/g) || []).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a photo background element", () => {
    const html = renderToStaticMarkup(LandingCTA({ messages }));
    expect(html).toContain("kin-landing-ctaband-photo");
  });

  it("CTA background image has empty alt (decorative — content conveyed by heading)", () => {
    const html = renderToStaticMarkup(LandingCTA({ messages }));
    // The cta-run image is decorative — it must have alt="" to be ignored by AT.
    expect(html).toContain('alt=""');
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
