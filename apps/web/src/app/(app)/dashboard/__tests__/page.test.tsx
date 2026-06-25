import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import DashboardPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("DashboardPage", () => {
  it("renders the dashboard heading", async () => {
    const page = await DashboardPage();
    expect(textOf(page)).toContain("Dashboard");
  });

  it("confirms the user is authenticated", async () => {
    const page = await DashboardPage();
    expect(textOf(page)).toContain("You are authenticated");
  });

  it("renders a logout button inside a form", async () => {
    const page = await DashboardPage();

    const submit = findFirst(page, (el) => el.props.type === "submit");
    expect(submit).toBeDefined();
    expect(textOf(submit)).toMatch(/log\s*out/i);

    // The submit button must be inside a <form> (logout uses a server action)
    const form = findFirst(page, (el) => el.type === "form");
    expect(form).toBeDefined();
  });
});

// --- React tree inspection helpers (mirror login/sign-up page tests) ---

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
