import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingHowItWorks } from "../LandingHowItWorks";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LandingHowItWorks", () => {
  const messages = {
    hiw_eyebrow: "How it works",
    hiw_title: "From your goal to your routine in three steps",
    hiw_subtitle: "No generic templates.",
    hiw_step1_title: "Tell it your goal",
    hiw_step1_desc: "Speak or type: gain strength, lose fat, run farther.",
    hiw_step2_title: "AI builds your plan",
    hiw_step2_desc: "In seconds you get a weekly routine.",
    hiw_step3_title: "Train and improve every week",
    hiw_step3_desc: "Log your sessions and the AI adjusts loads.",
  };

  it("renders the section heading", () => {
    const html = renderToStaticMarkup(LandingHowItWorks({ messages }));
    expect(html).toContain("How it works");
    expect(html).toContain("From your goal to your routine in three steps");
  });

  it("renders three steps with titles and descriptions", () => {
    const el = LandingHowItWorks({ messages });
    expect(textOf(el)).toContain("Tell it your goal");
    expect(textOf(el)).toContain("Speak or type: gain strength, lose fat, run farther.");
    expect(textOf(el)).toContain("AI builds your plan");
    expect(textOf(el)).toContain("Train and improve every week");
  });

  it("renders the reusable section heading as semantic header markup", () => {
    const html = renderToStaticMarkup(LandingHowItWorks({ messages }));

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
