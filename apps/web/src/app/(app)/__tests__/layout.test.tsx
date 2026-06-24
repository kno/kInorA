import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { usePathname } from "next/navigation";
import AppLayout from "../layout";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard"),
}));

vi.mocked(usePathname);

describe("AppLayout (app route group)", () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue("/dashboard");
  });

  it("renders dashboard children inside the AppShell", () => {
    const html = renderToString(
      <AppLayout>
        <div data-testid="dashboard-content">
          <h1>Dashboard</h1>
          <p>You are authenticated.</p>
        </div>
      </AppLayout>
    );

    expect(html).toContain("Dashboard");
    expect(html).toContain("You are authenticated");
  });

  it("renders the AppShell with navigation around any child content", () => {
    const html = renderToString(
      <AppLayout>
        <p>Page content here</p>
      </AppLayout>
    );

    // AppShell renders either sidebar or mobile nav
    const hasSidebar = html.includes('aria-label="Main navigation"');
    const hasMobileNav = html.includes('aria-label="Mobile navigation"');

    // At SSR, MobileNav renders (isDesktop defaults to false)
    expect(hasMobileNav).toBe(true);
    expect(html).toContain("Page content here");
  });
});
