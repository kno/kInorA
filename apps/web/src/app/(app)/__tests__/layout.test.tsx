import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { usePathname } from "next/navigation";
import AppLayout from "../layout";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard"),
}));

// AppLayout is now async and reads the session cookie. Provide a mock
// so the module resolves without a running Next.js request context.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined), // no session token → no profile fetch
  })),
}));

// Profile client is called only when a token exists (mocked as undefined above).
vi.mock("../auth/profile-client", () => ({
  fetchProfile: vi.fn(async () => null),
}));

vi.mocked(usePathname);

describe("AppLayout (app route group)", () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue("/dashboard");
  });

  it("renders dashboard children inside the AppShell", async () => {
    const html = renderToString(
      await AppLayout({
        children: (
          <div data-testid="dashboard-content">
            <h1>Dashboard</h1>
            <p>You are authenticated.</p>
          </div>
        ),
      })
    );

    expect(html).toContain("Dashboard");
    expect(html).toContain("You are authenticated");
  });

  it("renders the AppShell with navigation around any child content", async () => {
    const html = renderToString(
      await AppLayout({
        children: <p>Page content here</p>,
      })
    );

    // AppShell renders either sidebar or mobile nav
    const hasSidebar = html.includes('aria-label="Main navigation"');
    const hasMobileNav = html.includes('aria-label="Mobile navigation"');

    // At SSR, MobileNav renders (isDesktop defaults to false)
    expect(hasMobileNav).toBe(true);
    expect(html).toContain("Page content here");
  });
});
