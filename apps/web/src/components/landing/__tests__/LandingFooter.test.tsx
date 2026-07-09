import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// LandingFooter is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

import { createServerTranslator } from "@/test-utils/server-translator";
import { LandingFooter } from "../LandingFooter";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingFooter", () => {
  it("renders the brand tagline via getTranslations, no messages.* access", async () => {
    const el = await LandingFooter();
    expect(textOf(el)).toContain("The AI coach that builds your plan");
  });

  it("renders the three footer column headings", async () => {
    const el = await LandingFooter();
    expect(textOf(el)).toContain("Product");
    expect(textOf(el)).toContain("Company");
    expect(textOf(el)).toContain("Legal");
  });

  it("renders footer links", async () => {
    const el = await LandingFooter();
    expect(textOf(el)).toContain("Features");
    expect(textOf(el)).toContain("How it works");
    expect(textOf(el)).toContain("About kInorA");
    expect(textOf(el)).toContain("Privacy");
    expect(textOf(el)).toContain("Terms");
  });

  it("renders the copyright notice", async () => {
    const el = await LandingFooter();
    expect(textOf(el)).toContain("© 2026 kInorA. All rights reserved.");
  });

  it("uses shared decorative icon defaults for social links", async () => {
    const html = renderToStaticMarkup(await LandingFooter());

    const iconCount = (html.match(/focusable="false"/g) || []).length;
    expect(iconCount).toBe(4);
  });

  it("brand logo uses kin-landing-nav__logo class (not kin-landing-nav__dot which breaks SVG)", async () => {
    // kin-landing-nav__dot applies background/border-radius/width/height which clobbers SVG rendering.
    // The OrbitLogoIcon should use kin-landing-nav__logo (clean SVG class) instead.
    const html = renderToStaticMarkup(await LandingFooter());
    expect(html).toContain("kin-landing-nav__logo");
    // The dot class must not be applied to the SVG brand mark
    expect(html).not.toContain("kin-landing-nav__dot");
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
