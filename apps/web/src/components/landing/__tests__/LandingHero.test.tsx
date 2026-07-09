import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// LandingHero is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

import { createServerTranslator } from "@/test-utils/server-translator";
import { LandingHero } from "../LandingHero";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingHero", () => {
  it("renders the eyebrow label via getTranslations, no messages.* access", async () => {
    const el = await LandingHero();
    expect(textOf(el)).toContain("AI Coach");
  });

  it("renders the heading with a real <em> accent segment (no raw HTML injection)", async () => {
    const el = await LandingHero();
    const heading = findFirst(el, (n) => n.type === "h1");
    expect(heading).toBeDefined();
    // No dangerouslySetInnerHTML — the accent is a real React <em> element.
    expect((heading as AnyElement).props.dangerouslySetInnerHTML).toBeUndefined();
    expect(textOf(heading)).toContain("Your personal trainer,");
    expect(textOf(heading)).toContain("powered by AI");
    const em = findFirst(heading, (n) => n.type === "em");
    expect(em).toBeDefined();
    expect(textOf(em)).toBe("powered by AI");
  });

  it("renders the subtitle", async () => {
    const el = await LandingHero();
    expect(textOf(el)).toContain("kInorA listens to you");
  });

  it("renders two CTA buttons", async () => {
    const el = await LandingHero();
    expect(textOf(el)).toContain("Start free");
    expect(textOf(el)).toContain("See how it works");
  });

  it("renders meta info badges", async () => {
    const el = await LandingHero();
    expect(textOf(el)).toContain("No credit card required");
    expect(textOf(el)).toContain("Home or gym");
    expect(textOf(el)).toContain("iOS & Android");
  });

  it("renders a phone mockup in the visual area", async () => {
    const el = await LandingHero();
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
