import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// LandingCTA is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

import { createServerTranslator } from "@/test-utils/server-translator";
import { LandingCTA } from "../LandingCTA";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingCTA", () => {
  it("renders the heading and subtitle via getTranslations, no messages.* access", async () => {
    const html = renderToStaticMarkup(await LandingCTA());
    expect(html).toContain("Your next routine is waiting");
    expect(html).toContain("Create your plan in under a minute. Free, no credit card.");
  });

  it("renders both CTA buttons", async () => {
    const html = renderToStaticMarkup(await LandingCTA());
    expect(html).toContain("Start free");
    expect(html).toContain("View plans");
  });

  it("wraps the CTA content in a section", async () => {
    const html = renderToStaticMarkup(await LandingCTA());
    expect((html.match(/<section\b/g) || []).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a photo background element", async () => {
    const html = renderToStaticMarkup(await LandingCTA());
    expect(html).toContain("kin-landing-ctaband-photo");
  });

  it("CTA background image has empty alt (decorative — content conveyed by heading)", async () => {
    const html = renderToStaticMarkup(await LandingCTA());
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
