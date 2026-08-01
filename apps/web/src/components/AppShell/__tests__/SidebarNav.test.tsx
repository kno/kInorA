import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { catalogs } from "@kinora/i18n";
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

function renderToStringWithIntl(ui: Parameters<typeof renderToString>[0]) {
  return renderToString(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SidebarNav", () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue("/dashboard");
  });

  it("renders the brand wordmark", () => {
    const html = renderToStringWithIntl(<SidebarNav />);
    expect(html).toContain("kInorA");
  });

  it("renders all 6 navigation items with correct labels", () => {
    const html = renderToStringWithIntl(<SidebarNav />);
    const labels = ["Dashboard", "Plan", "Statistics", "History", "Create Plan", "Exercises"];
    for (const label of labels) {
      expect(html).toContain(label);
    }
  });

  it("marks the current route as active with aria-current=\"page\"", () => {
    const html = renderToStringWithIntl(<SidebarNav />);

    // Exactly one item should have aria-current="page"
    const activeCount = (html.match(/aria-current="page"/g) || []).length;
    expect(activeCount).toBe(1);

    // The active item should be the one matching the current path
    expect(html).toContain('href="/dashboard"');
  });

  it("renders all nav links with correct href values", () => {
    const html = renderToStringWithIntl(<SidebarNav />);
    const expectedHrefs = ["/dashboard", "/plan", "/stats", "/history", "/create-plan", "/exercises"];
    for (const href of expectedHrefs) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("uses shared icon accessibility defaults for every navigation item", () => {
    const html = renderToStringWithIntl(<SidebarNav />);

    const iconCount = (html.match(/focusable="false"/g) || []).length;
    expect(iconCount).toBe(7);
  });

  it("renders a user area with placeholder initials when no user prop is given", () => {
    const html = renderToStringWithIntl(<SidebarNav />);
    expect(html).toContain("?");
    expect(html).toContain("Guest");
  });

  it("renders the provided user identity when the user prop is supplied", () => {
    const html = renderToStringWithIntl(
      <SidebarNav user={{ initials: "AR", name: "Ada Rivera", plan: "Pro" }} />,
    );
    expect(html).toContain("AR");
    expect(html).toContain("Ada Rivera");
    expect(html).toContain("Pro");
    // Fallback must NOT leak through when a user is provided.
    expect(html).not.toContain(">?<");
    expect(html).not.toContain("Guest");
  });

  it("renders a logout button in the user area", () => {
    const html = renderToStringWithIntl(<SidebarNav />);
    expect(html).toContain("Log out");
    // The logout icon SVG should be present.
    expect(html).toContain('<svg viewBox="0 0 24 24"');
  });

  it("wraps the user identity (avatar + name) in a link to /profile", () => {
    const html = renderToStringWithIntl(
      <SidebarNav user={{ initials: "AR", name: "Ada Rivera", plan: "Pro" }} />,
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
    const html = renderToStringWithIntl(<SidebarNav />);
    expect(html).toMatch(/<a[^>]*href="\/profile"[^>]*>/);
    // The fallback initials still render inside the link.
    expect(html).toContain("?");
    expect(html).toContain("Guest");
  });

  it("renders a billing nav item with the translated label and /billing link when billingNavLabel is provided", () => {
    const html = renderToStringWithIntl(<SidebarNav billingNavLabel="Billing" />);

    expect(html).toContain('href="/billing"');
    // The link content is the supplied i18n label, not a hardcoded string.
    const billingLink = html.match(/<a[^>]*href="\/billing"[^>]*>[\s\S]*?<\/a>/);
    expect(billingLink).toBeTruthy();
    expect(billingLink![0]).toContain("Billing");
  });

  it("omits the billing nav item when billingNavLabel is not provided", () => {
    const html = renderToStringWithIntl(<SidebarNav />);
    expect(html).not.toContain('href="/billing"');
  });

  it("marks the billing nav item active on the /billing route", () => {
    mockedUsePathname.mockReturnValueOnce("/billing");

    const html = renderToStringWithIntl(<SidebarNav billingNavLabel="Billing" />);

    const billingLink = html.match(/<a[^>]*href="\/billing"[^>]*>/);
    expect(billingLink).toBeTruthy();
    expect(billingLink![0]).toContain('aria-current="page"');
  });

  it("highlights a different nav item when pathname changes", () => {
    mockedUsePathname.mockReturnValueOnce("/stats");

    const html = renderToStringWithIntl(<SidebarNav />);

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
