import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingTrust } from "../LandingTrust";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingTrust", () => {
  const items = [
    { icon: "clock", title: "Adapts to your schedule", desc: "Set the days you can train." },
    { icon: "chart", title: "Plan for your level", desc: "From beginner to advanced." },
    { icon: "check", title: "No equipment required", desc: "Train at home." },
    { icon: "mic", title: "Hands-free", desc: "Control by voice." },
  ];

  it("renders all four trust items", () => {
    const el = LandingTrust({ items });
    expect(textOf(el)).toContain("Adapts to your schedule");
    expect(textOf(el)).toContain("Plan for your level");
    expect(textOf(el)).toContain("No equipment required");
    expect(textOf(el)).toContain("Hands-free");
  });

  it("renders all descriptions", () => {
    const el = LandingTrust({ items });
    expect(textOf(el)).toContain("Set the days you can train.");
    expect(textOf(el)).toContain("From beginner to advanced.");
    expect(textOf(el)).toContain("Train at home.");
    expect(textOf(el)).toContain("Control by voice.");
  });

  it("renders the grid as a 4-column strip", () => {
    const el = LandingTrust({ items });
    const strip = findFirst(el, (n) =>
      n.type === "div" &&
      n.props.className === "kin-landing-strip"
    );
    expect(strip).toBeDefined();
  });

  it("promotes each trust item into a semantic proof card", () => {
    const html = renderToStaticMarkup(LandingTrust({ items }));

    expect((html.match(/<article\b/g) || []).length).toBe(4);
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
