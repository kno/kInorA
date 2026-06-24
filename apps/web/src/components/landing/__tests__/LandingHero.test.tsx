import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { LandingHero } from "../LandingHero";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingHero", () => {
  const defaultMessages = {
    hero_eyebrow: "AI Coach",
    hero_title: "Your personal trainer, <em>powered by AI</em>",
    hero_subtitle: "kInorA listens to you, builds your routine, and adjusts it every week.",
    hero_cta_primary: "Start free",
    hero_cta_secondary: "See how it works",
    hero_meta_nocard: "No credit card required",
    hero_meta_homegym: "Home or gym",
    hero_meta_iosandroid: "iOS & Android",
  };

  it("renders the eyebrow label", () => {
    const el = LandingHero({ messages: defaultMessages });
    expect(textOf(el)).toContain("AI Coach");
  });

  it("renders the heading with dangerouslySetInnerHTML for accent text", () => {
    const el = LandingHero({ messages: defaultMessages });
    const result = findFirst(el, (n) => n.type === "h1");
    expect(result).toBeDefined();
    // The heading uses dangerouslySetInnerHTML to render <em> tags
    const dh = (result as AnyElement).props.dangerouslySetInnerHTML as { __html: string } | undefined;
    expect(dh).toBeDefined();
    expect(dh!.__html).toContain("powered by AI");
  });

  it("renders the subtitle", () => {
    const el = LandingHero({ messages: defaultMessages });
    expect(textOf(el)).toContain("kInorA listens to you");
  });

  it("renders two CTA buttons", () => {
    const el = LandingHero({ messages: defaultMessages });
    expect(textOf(el)).toContain("Start free");
    expect(textOf(el)).toContain("See how it works");
  });

  it("renders meta info badges", () => {
    const el = LandingHero({ messages: defaultMessages });
    expect(textOf(el)).toContain("No credit card required");
    expect(textOf(el)).toContain("Home or gym");
    expect(textOf(el)).toContain("iOS & Android");
  });

  it("renders a phone mockup in the visual area", () => {
    const el = LandingHero({ messages: defaultMessages });
    const phone = findFirst(el, (n) =>
      n.type === "div" &&
      n.props.className === "kin-landing-phone"
    );
    expect(phone).toBeDefined();
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
