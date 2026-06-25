import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { LandingPricing } from "../LandingPricing";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingPricing", () => {
  const messages: Record<string, string> = {
    pricing_eyebrow: "Pricing",
    pricing_title: "Start free, grow when you're ready",
    pricing_subtitle: "No commitment.",
    pricing_free_tier: "Free",
    pricing_free_desc: "To start training with AI.",
    pricing_free_amount: "0",
    pricing_free_per: "forever",
    pricing_free_feat1: "One adaptive plan active",
    pricing_free_feat2: "Session tracking",
    pricing_free_feat3: "Basic statistics",
    pricing_free_feat4: "Voice assistant",
    pricing_free_cta: "Create account",
    pricing_pro_tier: "Pro",
    pricing_pro_desc: "To train seriously every week.",
    pricing_pro_per: "/ month",
    pricing_pro_feat1: "Unlimited plans with weekly adjustments",
    pricing_pro_feat2: "Hands-free voice assistant",
    pricing_pro_feat3: "Advanced statistics & records",
    pricing_pro_feat4: "Full exercise library",
    pricing_pro_cta: "Start with Pro",
    pricing_pro_badge: "Most popular",
    pricing_team_tier: "Teams",
    pricing_team_desc: "For coaches and training centers.",
    pricing_team_per: "/ month",
    pricing_team_feat1: "Everything in Pro for your team",
    pricing_team_feat2: "Dashboard to manage athletes",
    pricing_team_feat3: "Shared plans and templates",
    pricing_team_feat4: "Priority support",
    pricing_team_cta: "Talk to sales",
  };

  it("renders the section heading", () => {
    const el = LandingPricing({ messages });
    expect(textOf(el)).toContain("Pricing");
    expect(textOf(el)).toContain("Start free, grow when you're ready");
  });

  it("renders all three pricing tiers", () => {
    const el = LandingPricing({ messages });
    expect(textOf(el)).toContain("Free");
    expect(textOf(el)).toContain("Pro");
    expect(textOf(el)).toContain("Teams");
  });

  it("shows the Pro tier as featured (most popular)", () => {
    const el = LandingPricing({ messages });
    expect(textOf(el)).toContain("Most popular");
  });

  it("renders CTA buttons for each tier", () => {
    const el = LandingPricing({ messages });
    expect(textOf(el)).toContain("Create account");
    expect(textOf(el)).toContain("Start with Pro");
    expect(textOf(el)).toContain("Talk to sales");
  });

  it("renders the Pro and Team prices", () => {
    const el = LandingPricing({ messages });
    const text = textOf(el);
    // Free amount from messages, plus the module-level Pro/Team prices.
    expect(text).toContain("0");
    expect(text).toContain("9");
    expect(text).toContain("29");
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
