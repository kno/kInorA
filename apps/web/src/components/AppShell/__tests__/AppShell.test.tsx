// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render, screen, cleanup } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { AppShell } from "../AppShell";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard"),
}));

vi.mocked(usePathname);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("renders children inside the shell", () => {
    const html = renderToString(
      <AppShell>
        <p>Hello from child</p>
      </AppShell>
    );
    expect(html).toContain("Hello from child");
  });

  it("renders the mobile navigation by default (server render)", () => {
    const html = renderToString(
      <AppShell>
        <p>test content</p>
      </AppShell>
    );

    // At server-render time, isDesktop defaults to false, so MobileNav renders
    expect(html).toContain('aria-label="Mobile navigation"');
  });

  it("renders a main content area wrapping children", () => {
    const html = renderToString(
      <AppShell>
        <h1>Content area</h1>
      </AppShell>
    );

    expect(html).toContain("Content area");
  });

  it("renders the desktop sidebar (and not the mobile nav) at >=768px", () => {
    // Mock matchMedia to report a desktop viewport so the post-hydration
    // effect switches AppShell to the SidebarNav branch.
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    render(
      <AppShell>
        <p>desktop child</p>
      </AppShell>,
    );

    // Desktop sidebar present. SidebarNav renders an <aside
    // aria-label="Main navigation"> (role=complementary).
    const mainNavigation = screen.getByRole("complementary", {
      name: "Main navigation",
    });
    expect(mainNavigation.tagName).toBe("ASIDE");
    // Mobile bottom nav (<nav aria-label="Mobile navigation">) must NOT render.
    expect(screen.queryByRole("navigation", { name: "Mobile navigation" })).toBeNull();
    expect(screen.getByText("desktop child").textContent).toBe("desktop child");
  });
});
