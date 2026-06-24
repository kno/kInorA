import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { usePathname } from "next/navigation";
import { AppShell } from "../AppShell";
import type { ReactElement, ReactNode } from "react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard"),
}));

vi.mocked(usePathname);

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
});
