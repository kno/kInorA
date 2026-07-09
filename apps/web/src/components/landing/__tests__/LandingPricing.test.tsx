import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// LandingPricing is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
// `getTranslations` is a `vi.fn` (not a plain async arrow) so the ES-locale
// test below can override it for a single call via `mockResolvedValueOnce`.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";
import { LandingPricing } from "../LandingPricing";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingPricing", () => {
  it("renders the section heading via getTranslations, no messages.* access", async () => {
    const html = renderToStaticMarkup(await LandingPricing());
    expect(html).toContain("Pricing");
    expect(html).toContain("Start free, grow when you&#x27;re ready");
  });

  it("renders all three pricing tiers", async () => {
    const el = await LandingPricing();
    expect(textOf(el)).toContain("Free");
    expect(textOf(el)).toContain("Pro");
    expect(textOf(el)).toContain("Teams");
  });

  it("shows the Pro tier as featured (most popular)", async () => {
    const el = await LandingPricing();
    expect(textOf(el)).toContain("Most popular");
  });

  it("renders CTA buttons for each tier", async () => {
    const el = await LandingPricing();
    expect(textOf(el)).toContain("Create account");
    expect(textOf(el)).toContain("Start with Pro");
    expect(textOf(el)).toContain("Talk to sales");
  });

  it("Teams CTA links to # regardless of locale (href driven by data, not copy)", async () => {
    // Bug guard: previously keyed off `tier.cta === "Talk to sales"` which breaks
    // in non-English locales where the copy is "Hablar con ventas".
    const html = renderToStaticMarkup(await LandingPricing());
    // Locate the Teams section and assert its CTA href is "#"
    const teamsIdx = html.indexOf("Teams");
    const ctaAfterTeams = html.slice(teamsIdx).match(/href="([^"]+)"/);
    expect(ctaAfterTeams?.[1]).toBe("#");
  });

  it("Teams CTA also links to # with real Spanish copy from the ES catalog (es locale guard)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const html = renderToStaticMarkup(await LandingPricing());
    // "Equipos" / "Hablar con ventas" are the real ES catalog values for the
    // Teams tier — confirms no EN leakage AND the href-driven-by-data guard
    // still holds when the CTA copy itself is Spanish.
    expect(html).toContain("Equipos");
    expect(html).toContain("Hablar con ventas");
    const teamsIdx = html.indexOf("Equipos");
    const ctaAfterTeams = html.slice(teamsIdx).match(/href="([^"]+)"/);
    expect(ctaAfterTeams?.[1]).toBe("#");
  });

  it("Pro tier badge uses the defined kin-landing-pill classes (not undefined pill/pill-active)", async () => {
    const html = renderToStaticMarkup(await LandingPricing());
    expect(html).toContain("kin-landing-pill kin-landing-pill--active");
    expect(html).not.toContain('"pill pill-active"');
  });

  it("renders the Pro and Team prices", async () => {
    const el = await LandingPricing();
    const text = textOf(el);
    // Free amount from the catalog, plus the module-level Pro/Team prices.
    expect(text).toContain("0");
    expect(text).toContain("9");
    expect(text).toContain("29");
  });

  it("renders the reusable section heading as semantic header markup", async () => {
    const html = renderToStaticMarkup(await LandingPricing());

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
