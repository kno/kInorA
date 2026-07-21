import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { usePathname } from "next/navigation";
import { MobileNav } from "../MobileNav";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

vi.mock("@/app/(app)/dashboard/actions", () => ({
  logoutAction: vi.fn(),
}));

const mockedUsePathname = vi.mocked(usePathname);

describe("MobileNav", () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue("/dashboard");
  });

  it("renders all 5 tab items", () => {
    const html = renderToString(MobileNav());
    const tabLabels = ["Dashboard", "Plan", "Statistics", "History", "Exercises"];
    for (const label of tabLabels) {
      expect(html).toContain(label);
    }
  });

  it("renders a centered FAB linking to /create-plan", () => {
    const html = renderToString(MobileNav());

    // The FAB link should point to create-plan
    expect(html).toContain('href="/create-plan"');
  });

  it("renders exactly 5 nav items as links with correct hrefs", () => {
    const html = renderToString(MobileNav());
    const hrefs = ["/dashboard", "/plan", "/stats", "/history", "/exercises"];
    for (const href of hrefs) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("uses shared icon accessibility defaults for tabs and the create action", () => {
    const html = renderToString(MobileNav());

    const iconCount = (html.match(/focusable="false"/g) || []).length;
    expect(iconCount).toBe(7);
  });

  it("renders a logout button with aria-label=\"Log out\"", () => {
    const html = renderToString(MobileNav());
    expect(html).toContain('aria-label="Log out"');
    expect(html).toContain('<svg viewBox="0 0 24 24"');
  });

  it("marks the active tab with aria-current=\"page\"", () => {
    const html = renderToString(MobileNav());

    // Dashboard should be the active item
    const activeCount = (html.match(/aria-current="page"/g) || []).length;
    expect(activeCount).toBe(1);
  });

  it("highlights a different tab when pathname changes", () => {
    mockedUsePathname.mockReturnValueOnce("/stats");

    const html = renderToString(MobileNav());

    // Only one active item
    const activeCount = (html.match(/aria-current="page"/g) || []).length;
    expect(activeCount).toBe(1);

    // Stats should be active
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/stats"');

    // Dashboard tab should exist but not be active
    const dashboardHtml = html.match(/<a[^>]*href="\/dashboard"[^>]*>/g);
    expect(dashboardHtml).toBeTruthy();
    if (dashboardHtml) {
      for (const link of dashboardHtml) {
        expect(link).not.toContain('aria-current="page"');
      }
    }
  });

  it("renders the FAB as a separate element from the tab bar", () => {
    const html = renderToString(MobileNav());

    // There should be two link elements with /create-plan
    // One for the FAB and potentially one in tabs if Create Plan were there
    const createLinks = html.match(/href="\/create-plan"/g) || [];
    expect(createLinks.length).toBe(1);
  });
});
