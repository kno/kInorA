import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// LandingHowItWorks is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

import { createServerTranslator } from "@/test-utils/server-translator";
import { LandingHowItWorks } from "../LandingHowItWorks";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingHowItWorks", () => {
  it("renders the section heading via getTranslations, no messages.* access", async () => {
    const html = renderToStaticMarkup(await LandingHowItWorks());
    expect(html).toContain("How it works");
    expect(html).toContain("From your goal to your routine in three steps");
  });

  it("renders three steps with titles and descriptions", async () => {
    const el = await LandingHowItWorks();
    expect(textOf(el)).toContain("Tell it your goal");
    expect(textOf(el)).toContain("The AI learns your level, availability, and equipment.");
    expect(textOf(el)).toContain("AI builds your plan");
    expect(textOf(el)).toContain("Train and improve every week");
  });

  it("renders the reusable section heading as semantic header markup", async () => {
    const html = renderToStaticMarkup(await LandingHowItWorks());

    expect(html).toContain("<header");
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
