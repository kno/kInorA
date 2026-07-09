import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// HomePage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
// `getTranslations` is a `vi.fn` (not a plain async arrow) so the ES-locale
// test below can override it for a single call via `mockResolvedValueOnce`.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

// The 7 landing children are themselves async server components migrated in
// this same slice (each has its own dedicated test — see
// `components/landing/__tests__/*`). Plain `react-dom/server` (used by this
// test) cannot render nested async Server Components synchronously — that
// support is RSC-runtime-only (Next.js's real flight renderer) — so, same
// pattern as `plan/__tests__/page.test.tsx`, they are stubbed here to assert
// PAGE-level wiring: no `messages` prop threaded to any child, and the
// page's OWN translations (trustItems, cinema alt) resolve correctly.
vi.mock("@/components/landing/LandingNav", () => ({
  LandingNav: (props: AnyProps) => null,
}));
vi.mock("@/components/landing/LandingHero", () => ({
  LandingHero: (props: AnyProps) => null,
}));
vi.mock("@/components/landing/LandingHowItWorks", () => ({
  LandingHowItWorks: (props: AnyProps) => null,
}));
vi.mock("@/components/landing/LandingFeatures", () => ({
  LandingFeatures: (props: AnyProps) => null,
}));
vi.mock("@/components/landing/LandingPricing", () => ({
  LandingPricing: (props: AnyProps) => null,
}));
vi.mock("@/components/landing/LandingCTA", () => ({
  LandingCTA: (props: AnyProps) => null,
}));
vi.mock("@/components/landing/LandingFooter", () => ({
  LandingFooter: (props: AnyProps) => null,
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingHowItWorks } from "@/components/landing/LandingHowItWorks";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingPricing } from "@/components/landing/LandingPricing";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";
import HomePage from "../page";

const migratedChildren = [
  LandingNav,
  LandingHero,
  LandingHowItWorks,
  LandingFeatures,
  LandingPricing,
  LandingCTA,
  LandingFooter,
];

describe("HomePage", () => {
  it("renders via getTranslations and does not thread a messages prop to any migrated landing child", async () => {
    const page = await HomePage();

    for (const Child of migratedChildren) {
      const el = findFirst(page, (n) => n.type === Child);
      expect(el).toBeDefined();
      expect(el?.props).not.toHaveProperty("messages");
    }
  });

  it("builds trustItems from getTranslations output (LandingTrust — unmigrated, receives resolved array)", async () => {
    const page = await HomePage();
    const trust = findFirst(page, (n) => (n.props as AnyProps).items !== undefined);
    expect(trust).toBeDefined();
    const items = trust?.props.items as { title: string; desc: string }[];
    expect(items?.map((i) => i.title)).toContain("Adapts to your schedule");
    expect(items?.map((i) => i.desc)).toContain(
      "Set the days you can train and the AI reorganizes your week.",
    );
  });

  it("resolves the cinema band alt text via getTranslations (LandingCinemaBand — unmigrated, receives resolved string)", async () => {
    const page = await HomePage();
    const cinema = findFirst(page, (n) => typeof (n.props as AnyProps).alt === "string");
    expect(cinema?.props.alt).toBe(
      "Athlete taking an active break between sets, sitting on the gym floor with hands resting on knees",
    );
  });

  it("builds trustItems and cinema alt from the real ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await HomePage();

    const trust = findFirst(page, (n) => (n.props as AnyProps).items !== undefined);
    const items = trust?.props.items as { title: string; desc: string }[];
    expect(items?.map((i) => i.title)).toContain("Se adapta a tu horario");
    expect(items?.map((i) => i.desc)).toContain(
      "Indica los días que puedes entrenar y la IA reorganiza tu semana.",
    );

    const cinema = findFirst(page, (n) => typeof (n.props as AnyProps).alt === "string");
    expect(cinema?.props.alt).toBe(
      "Atleta tomando un descanso activo entre series, sentado en el suelo del gimnasio con las manos apoyadas en las rodillas",
    );
  });
});

// --- Tree inspection helpers ---

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean,
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

function isReactElement(node: ReactNode): node is AnyElement {
  return typeof node === "object" && node !== null && "props" in node;
}
