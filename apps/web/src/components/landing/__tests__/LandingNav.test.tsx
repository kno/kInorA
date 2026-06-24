import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { LandingNav } from "../LandingNav";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingNav", () => {
  const defaultMessages = {
    title: "kInorA",
    nav_products: "Product",
    nav_how_it_works: "How it works",
    nav_pricing: "Pricing",
    nav_login: "Log in",
    nav_signup: "Start free",
  };

  it("renders the brand name", () => {
    const el = LandingNav({ messages: defaultMessages });
    expect(textOf(el)).toContain("kInorA");
  });

  it("renders all navigation links", () => {
    const el = LandingNav({ messages: defaultMessages });
    expect(textOf(el)).toContain("Product");
    expect(textOf(el)).toContain("How it works");
    expect(textOf(el)).toContain("Pricing");
  });

  it("renders login and sign-up CTA buttons", () => {
    const el = LandingNav({ messages: defaultMessages });
    // Two action buttons: Log in (ghost) and Start free (primary)
    expect(textOf(el)).toContain("Log in");
    expect(textOf(el)).toContain("Start free");
  });

  it("includes a mobile menu toggle button", () => {
    const el = LandingNav({ messages: defaultMessages });
    const hamburger = findFirst(el, (n) =>
      n.type === "button" && textOf(n) === ""
    );
    expect(hamburger).toBeDefined();
  });
});

// --- Tree inspection helpers ---

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
