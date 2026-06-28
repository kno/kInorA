import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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

  it("does not render a non-functional hamburger menu button", () => {
    // The mobile menu is out of scope for this slice; a dead button with no
    // handler / aria-expanded was removed to avoid an a11y-breaking control.
    const el = LandingNav({ messages: defaultMessages });
    const anyButton = findFirst(el, (n) => n.type === "button");
    expect(anyButton).toBeUndefined();
  });

  it("renders the Orbit logo SVG in the brand link, not a bare dot span", () => {
    // The nav brand link must show the Orbit logo icon (an SVG) rather than
    // the empty coloured dot span that was used as a placeholder.
    const html = renderToStaticMarkup(LandingNav({ messages: defaultMessages }));

    // Must contain an SVG (the OrbitLogoIcon)
    expect(html).toContain("<svg");

    // Must NOT contain an empty span used as the old CSS dot placeholder
    expect(html).not.toContain('<span class="kin-landing-nav__dot"');
  });

  it("keeps the brand link accessible with the correct href and aria-label", () => {
    const html = renderToStaticMarkup(LandingNav({ messages: defaultMessages }));
    expect(html).toContain('href="#top"');
    expect(html).toContain('aria-label="kInorA home"');
  });

  it("uses shared decorative icon defaults (focusable=false) for the Orbit logo", () => {
    const html = renderToStaticMarkup(LandingNav({ messages: defaultMessages }));
    // OrbitLogoIcon is decorative — the brand link text provides the accessible name
    expect(html).toContain('focusable="false"');
    expect(html).toContain('aria-hidden="true"');
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
