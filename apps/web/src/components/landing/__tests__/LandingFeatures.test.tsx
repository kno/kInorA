import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// LandingFeatures is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

import { createServerTranslator } from "@/test-utils/server-translator";
import { LandingFeatures } from "../LandingFeatures";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingFeatures", () => {
  it("renders the section heading via getTranslations, no messages.* access", async () => {
    const html = renderToStaticMarkup(await LandingFeatures());
    expect(html).toContain("Product");
    expect(html).toContain("Everything you need, in one app");
  });

  it("renders all four feature cards", async () => {
    const el = await LandingFeatures();
    expect(textOf(el)).toContain("Adaptive plan");
    expect(textOf(el)).toContain("Voice assistant");
    expect(textOf(el)).toContain("Live tracking");
    expect(textOf(el)).toContain("Statistics");
  });

  it("renders descriptions for each feature", async () => {
    const el = await LandingFeatures();
    expect(textOf(el)).toContain("Routines that readjust each week");
    expect(textOf(el)).toContain("Mark sets, request an exercise change");
  });

  it("renders the reusable section heading as semantic header markup", async () => {
    const html = renderToStaticMarkup(await LandingFeatures());

    expect(html).toContain("<header");
  });

  it("renders the strength-split section with eyebrow, heading, and description", async () => {
    const html = renderToStaticMarkup(await LandingFeatures());
    expect(html).toContain("Real progression");
    expect(html).toContain("Every kilo lifted, recorded");
    expect(html).toContain("kInorA keeps track of your loads");
  });

  it("renders the strength image with alt text", async () => {
    const html = renderToStaticMarkup(await LandingFeatures());
    expect(html).toContain('src="/landing/strength-1120.webp"');
    expect(html).toContain("Chalked hands gripping a barbell");
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
