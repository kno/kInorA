import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { usePathname } from "next/navigation";
import { SidebarNav } from "../SidebarNav";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

const mockedUsePathname = vi.mocked(usePathname);

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("SidebarNav", () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue("/dashboard");
  });

  it("renders the brand wordmark", () => {
    const el = SidebarNav();
    expect(textOf(el)).toContain("kInorA");
  });

  it("renders all 5 navigation items with correct labels", () => {
    const el = SidebarNav();
    const labels = ["Dashboard", "Plan", "Statistics", "Create Plan", "Exercises"];
    for (const label of labels) {
      expect(textOf(el)).toContain(label);
    }
  });

  it("marks the current route as active with aria-current=\"page\"", () => {
    const html = renderToString(SidebarNav());

    // Exactly one item should have aria-current="page"
    const activeCount = (html.match(/aria-current="page"/g) || []).length;
    expect(activeCount).toBe(1);

    // The active item should be the one matching the current path
    expect(html).toContain('href="/dashboard"');
  });

  it("renders all nav links with correct href values", () => {
    const html = renderToString(SidebarNav());
    const expectedHrefs = ["/dashboard", "/plan", "/stats", "/create-plan", "/exercises"];
    for (const href of expectedHrefs) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("renders a user area with initials placeholder when no user prop is given", () => {
    const el = SidebarNav();
    expect(textOf(el)).toContain("JD");
    expect(textOf(el)).toContain("User");
    expect(textOf(el)).toContain("Free");
  });

  it("renders the provided user identity when the user prop is supplied", () => {
    const el = SidebarNav({ user: { initials: "AR", name: "Ada Rivera", plan: "Pro" } });
    const text = textOf(el);
    expect(text).toContain("AR");
    expect(text).toContain("Ada Rivera");
    expect(text).toContain("Pro");
    // Fallback placeholders must NOT leak through when a user is provided.
    expect(text).not.toContain("JD");
  });

  it("highlights a different nav item when pathname changes", () => {
    mockedUsePathname.mockReturnValueOnce("/stats");

    const html = renderToString(SidebarNav());

    // Only one item should have aria-current="page"
    const activeCount = (html.match(/aria-current="page"/g) || []).length;
    expect(activeCount).toBe(1);

    // The active stats link should be in the HTML
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/stats"');

    // Dashboard should NOT be the active link
    const dashboardHtml = html.match(/<a[^>]*href="\/dashboard"[^>]*>/g);
    expect(dashboardHtml).toBeTruthy();
    if (dashboardHtml) {
      for (const link of dashboardHtml) {
        expect(link).not.toContain('aria-current="page"');
      }
    }
  });
});

// --- Tree inspection helpers ---

function findFirst(
  node: ReactNode,
  match: (el: ReactNode) => boolean
): ReactNode | undefined {
  if (match(node)) return node;
  if (isReactElement(node)) {
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
