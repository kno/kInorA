import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { LandingFooter } from "../LandingFooter";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingFooter", () => {
  const messages = {
    footer_tagline: "The AI coach that builds your plan, adjusts it every week, and trains with you.",
    footer_product: "Product",
    footer_features: "Features",
    footer_how_it_works: "How it works",
    footer_pricing: "Pricing",
    footer_download: "Download app",
    footer_company: "Company",
    footer_about: "About kInorA",
    footer_blog: "Blog",
    footer_careers: "Careers",
    footer_contact: "Contact",
    footer_legal: "Legal",
    footer_privacy: "Privacy",
    footer_terms: "Terms",
    footer_cookies: "Cookies",
    footer_copyright: "© 2026 kInorA. All rights reserved.",
  };

  it("renders the brand tagline", () => {
    const el = LandingFooter({ messages });
    expect(textOf(el)).toContain("The AI coach that builds your plan");
  });

  it("renders the three footer column headings", () => {
    const el = LandingFooter({ messages });
    expect(textOf(el)).toContain("Product");
    expect(textOf(el)).toContain("Company");
    expect(textOf(el)).toContain("Legal");
  });

  it("renders footer links", () => {
    const el = LandingFooter({ messages });
    expect(textOf(el)).toContain("Features");
    expect(textOf(el)).toContain("How it works");
    expect(textOf(el)).toContain("About kInorA");
    expect(textOf(el)).toContain("Privacy");
    expect(textOf(el)).toContain("Terms");
  });

  it("renders the copyright notice", () => {
    const el = LandingFooter({ messages });
    expect(textOf(el)).toContain("© 2026 kInorA. All rights reserved.");
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
