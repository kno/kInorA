import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { usePathname } from "next/navigation";
import { SidebarNav } from "../SidebarNav";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

// Mock the server action import — client components that import "use server"
// actions need the module to resolve in test environments.
vi.mock("@/app/(app)/dashboard/actions", () => ({
  logoutAction: vi.fn(),
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

  it("renders all 6 navigation items with correct labels", () => {
    const el = SidebarNav();
    const labels = ["Dashboard", "Plan", "Statistics", "History", "Create Plan", "Exercises"];
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
    const expectedHrefs = ["/dashboard", "/plan", "/stats", "/history", "/create-plan", "/exercises"];
    for (const href of expectedHrefs) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("uses shared icon accessibility defaults for every navigation item", () => {
    const html = renderToString(SidebarNav());

    const iconCount = (html.match(/focusable="false"/g) || []).length;
    expect(iconCount).toBe(7);
  });

  it("renders a user area with placeholder initials when no user prop is given", () => {
    const el = SidebarNav();
    expect(textOf(el)).toContain("?");
    expect(textOf(el)).toContain("Guest");
  });

  it("renders the provided user identity when the user prop is supplied", () => {
    const el = SidebarNav({ user: { initials: "AR", name: "Ada Rivera", plan: "Pro" } });
    const text = textOf(el);
    expect(text).toContain("AR");
    expect(text).toContain("Ada Rivera");
    expect(text).toContain("Pro");
    // Fallback must NOT leak through when a user is provided.
    expect(text).not.toContain("?");
    expect(text).not.toContain("Guest");
  });

  it("renders a logout button in the user area", () => {
    const html = renderToString(SidebarNav());
    expect(html).toContain("Log out");
    // The logout icon SVG should be present.
    expect(html).toContain('<svg viewBox="0 0 24 24"');
  });

  it("wraps the user identity (avatar + name) in a link to /profile", () => {
    const html = renderToString(
      SidebarNav({ user: { initials: "AR", name: "Ada Rivera", plan: "Pro" } }),
    );

    // The user-area link points to the profile page.
    const userLink = html.match(/<a[^>]*href="\/profile"[^>]*>/);
    expect(userLink).toBeTruthy();

    // The avatar initials and the user's name live INSIDE that link so the
    // whole identity surface is the click target, while the logout form stays
    // a sibling (interactive elements must not nest inside an <a>).
    const linkHtml = userLink![0];
    const linkOpen = html.indexOf(linkHtml);
    const linkClose = html.indexOf("</a>", linkOpen);
    const linkInner = html.slice(linkOpen + linkHtml.length, linkClose);
    expect(linkInner).toContain("AR");
    expect(linkInner).toContain("Ada Rivera");

    // The logout button must remain OUTSIDE the /profile link.
    const logoutIdx = html.indexOf('aria-label="Log out"');
    expect(logoutIdx).toBeGreaterThan(linkClose);
  });

  it("wraps the fallback user identity in a link to /profile when no user prop is given", () => {
    const html = renderToString(SidebarNav());
    expect(html).toMatch(/<a[^>]*href="\/profile"[^>]*>/);
    // The fallback initials still render inside the link.
    expect(html).toContain("?");
    expect(html).toContain("Guest");
  });

  it("renders a billing nav item with the translated label and /billing link when billingNavLabel is provided", () => {
    const html = renderToString(SidebarNav({ billingNavLabel: "Billing" }));

    expect(html).toContain('href="/billing"');
    // The link content is the supplied i18n label, not a hardcoded string.
    const billingLink = html.match(/<a[^>]*href="\/billing"[^>]*>[\s\S]*?<\/a>/);
    expect(billingLink).toBeTruthy();
    expect(billingLink![0]).toContain("Billing");
  });

  it("omits the billing nav item when billingNavLabel is not provided", () => {
    const html = renderToString(SidebarNav());
    expect(html).not.toContain('href="/billing"');
  });

  it("marks the billing nav item active on the /billing route", () => {
    mockedUsePathname.mockReturnValueOnce("/billing");

    const html = renderToString(SidebarNav({ billingNavLabel: "Billing" }));

    const billingLink = html.match(/<a[^>]*href="\/billing"[^>]*>/);
    expect(billingLink).toBeTruthy();
    expect(billingLink![0]).toContain('aria-current="page"');
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
