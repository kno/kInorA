import React from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// LandingNav is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

import { createServerTranslator } from "@/test-utils/server-translator";
import { LandingNav } from "../LandingNav";
import { LandingNavClient, shouldFrost } from "../LandingNavClient";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

const clientProps = {
  brandLabel: "kInorA",
  links: [
    { href: "#producto", label: "Product" },
    { href: "#como", label: "How it works" },
    { href: "#precios", label: "Pricing" },
  ],
  loginLabel: "Log in",
  signupLabel: "Start free",
  menuAriaLabel: "Open menu",
  navAriaLabel: "Principal",
};

// Helper: render the hook-bearing client component safely via React.createElement
function renderClient(props = clientProps): string {
  return renderToStaticMarkup(React.createElement(LandingNavClient, props));
}

describe("shouldFrost (pure helper)", () => {
  it("returns false when scrollY is 0", () => {
    expect(shouldFrost(0)).toBe(false);
  });

  it("returns false when scrollY is exactly 16", () => {
    expect(shouldFrost(16)).toBe(false);
  });

  it("returns true when scrollY is 17", () => {
    expect(shouldFrost(17)).toBe(true);
  });

  it("returns true for large scrollY values", () => {
    expect(shouldFrost(1000)).toBe(true);
  });
});

describe("LandingNavClient", () => {
  it("renders the brand name", () => {
    expect(renderClient()).toContain("kInorA");
  });

  it("renders the Orbit logo SVG mark in the brand (not a CSS dot span)", () => {
    // The nav brand must use OrbitLogoIcon (SVG) — kin-landing-nav__logo class,
    // not the kin-landing-nav__dot span which applies background/border-radius to SVG.
    const html = renderClient();
    expect(html).toContain("kin-landing-nav__logo");
    expect(html).not.toContain("kin-landing-nav__dot");
  });

  it("renders all navigation links", () => {
    const html = renderClient();
    expect(html).toContain("Product");
    expect(html).toContain("How it works");
    expect(html).toContain("Pricing");
  });

  it("renders the login and sign-up actions", () => {
    const html = renderClient();
    expect(html).toContain("Log in");
    expect(html).toContain("Start free");
  });

  it("renders the hamburger toggle button with accessible attributes", () => {
    const html = renderClient();
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain("kin-landing-nav__toggle");
    // aria-expanded is false when menu is closed (SSR initial state)
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="kin-nav-mobile-menu"');
  });

  it("renders the mobile menu nav with a stable id", () => {
    expect(renderClient()).toContain('id="kin-nav-mobile-menu"');
  });

  it("uses navAriaLabel prop as the <nav> landmark aria-label (not hardcoded)", () => {
    // The <nav> element must use the navAriaLabel prop — previously hardcoded "Principal"
    // breaking i18n. This asserts the attribute is driven by the prop.
    const html = renderClient({ ...clientProps, navAriaLabel: "Navegación principal" });
    expect(html).toContain('aria-label="Navegación principal"');
  });

  it("nav landmark aria-label is distinct from the hamburger button aria-label", () => {
    // Confirm each accessible name comes from its own prop.
    const html = renderClient({
      ...clientProps,
      navAriaLabel: "Nav landmark",
      menuAriaLabel: "Toggle menu",
    });
    expect(html).toContain('aria-label="Nav landmark"');
    expect(html).toContain('aria-label="Toggle menu"');
  });

  it("renders nav links with Spanish anchor hrefs", () => {
    const html = renderClient();
    expect(html).toContain('href="#producto"');
    expect(html).toContain('href="#como"');
    expect(html).toContain('href="#precios"');
  });

  it("renders login link to /login and signup link to /sign-up", () => {
    const html = renderClient();
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/sign-up"');
  });

  it("renders as a <header> role=banner landmark", () => {
    const html = renderClient();
    expect(html).toContain("<header");
    expect(html).toContain('role="banner"');
  });

  it("does not apply scrolled class in SSR initial state", () => {
    // frosted defaults false in useState — scrolled modifier absent on first render
    expect(renderClient()).not.toContain("kin-landing-nav--scrolled");
  });
});

describe("LandingNav (server wrapper)", () => {
  it("renders the brand name via getTranslations, no messages.* access", async () => {
    const html = renderToStaticMarkup(await LandingNav());
    expect(html).toContain("kInorA");
  });

  it("renders navigation labels from the real EN catalog", async () => {
    const html = renderToStaticMarkup(await LandingNav());
    expect(html).toContain("Product");
    expect(html).toContain("How it works");
    expect(html).toContain("Pricing");
  });

  it("renders login and sign-up labels from the real EN catalog", async () => {
    const html = renderToStaticMarkup(await LandingNav());
    expect(html).toContain("Log in");
    expect(html).toContain("Start free");
  });

  it("passes the menu aria label from the catalog to the client component", async () => {
    const html = renderToStaticMarkup(await LandingNav());
    expect(html).toContain("Open menu");
  });

  it("renders the hamburger button", async () => {
    const html = renderToStaticMarkup(await LandingNav());
    expect(html).toContain("<button");
    expect(html).toContain("kin-landing-nav__toggle");
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
