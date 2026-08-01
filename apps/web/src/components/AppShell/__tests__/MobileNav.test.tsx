// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { MobileNav } from "../MobileNav";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

vi.mock("@/app/(app)/dashboard/actions", () => ({
  logoutAction: vi.fn(),
}));

const mockedUsePathname = vi.mocked(usePathname);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MobileNav", () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue("/dashboard");
  });

  it("renders the primary bar tabs (Dashboard, Plan, History) + FAB + More", () => {
    render(<MobileNav />);

    expect(screen.getByRole("link", { name: /^Dashboard$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Plan$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^History$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Create Plan/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /More/i })).toBeTruthy();
  });

  it("does NOT render Statistics/Exercises/Profile/Memory/Billing as bar tabs by default", () => {
    render(<MobileNav memoryNavLabel="Memory" billingNavLabel="Billing" />);

    // The overflow menu is closed, so these must not be exposed in the
    // accessibility tree as bar tabs (they live in the hidden panel).
    expect(screen.queryByRole("link", { name: /^Statistics$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Exercises$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Profile$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Memory$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Billing$/i })).toBeNull();
  });

  it("renders a centered FAB linking to /create-plan", () => {
    render(<MobileNav />);
    expect(screen.getByRole("link", { name: /Create Plan/i }).getAttribute("href")).toBe(
      "/create-plan",
    );
  });

  it("clicking More reveals the overflow menu with Statistics, Exercises, Profile and Log out", () => {
    render(<MobileNav />);

    const moreButton = screen.getByRole("button", { name: /More/i });
    expect(moreButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(moreButton);

    expect(moreButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menuitem", { name: /Statistics/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Exercises/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Profile/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Log out/i })).toBeTruthy();
  });

  it("shows Memory and Billing in the overflow menu when their labels are provided", () => {
    render(<MobileNav memoryNavLabel="Memory" billingNavLabel="Billing" />);

    fireEvent.click(screen.getByRole("button", { name: /More/i }));

    expect(screen.getByRole("menuitem", { name: /Memory/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Billing/i })).toBeTruthy();
  });

  it("omits Memory/Billing from the overflow menu when their labels are not provided", () => {
    render(<MobileNav />);

    fireEvent.click(screen.getByRole("button", { name: /More/i }));

    expect(screen.queryByRole("menuitem", { name: /Memory/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Billing/i })).toBeNull();
  });

  it("closes the menu when selecting an overflow item", () => {
    render(<MobileNav />);

    const moreButton = screen.getByRole("button", { name: /More/i });
    fireEvent.click(moreButton);
    expect(moreButton.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("menuitem", { name: /Statistics/i }));

    expect(moreButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menuitem", { name: /Statistics/i })).toBeNull();
  });

  it("closes the menu on Escape", () => {
    render(<MobileNav />);

    const moreButton = screen.getByRole("button", { name: /More/i });
    fireEvent.click(moreButton);
    expect(moreButton.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(moreButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the menu when clicking outside (the backdrop)", () => {
    render(<MobileNav />);

    const moreButton = screen.getByRole("button", { name: /More/i });
    fireEvent.click(moreButton);
    expect(moreButton.getAttribute("aria-expanded")).toBe("true");

    fireEvent.mouseDown(document.body);

    expect(moreButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("the logout form is present in the overflow menu and submittable", () => {
    render(<MobileNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/i }));

    const logoutButton = screen.getByRole("menuitem", { name: /Log out/i });
    const form = logoutButton.closest("form");
    expect(form).toBeTruthy();
    expect(() => fireEvent.submit(form as HTMLFormElement)).not.toThrow();
  });

  it("highlights the corresponding bar tab when pathname is a primary route", () => {
    mockedUsePathname.mockReturnValue("/dashboard");
    render(<MobileNav />);

    expect(screen.getByRole("link", { name: /^Dashboard$/i }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("button", { name: /More/i }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("highlights the More button (not a bar tab) when pathname is a secondary route", () => {
    mockedUsePathname.mockReturnValue("/stats");
    render(<MobileNav />);

    const moreButton = screen.getByRole("button", { name: /More/i });
    // The active style class is applied to the More button.
    expect(moreButton.className).toContain("tabActive");

    // No bar tab (Dashboard/Plan/History) is active.
    for (const name of [/^Dashboard$/i, /^Plan$/i, /^History$/i]) {
      expect(screen.getByRole("link", { name }).getAttribute("aria-current")).toBeNull();
    }
  });

  it("renders exactly one link for /create-plan (FAB only)", () => {
    render(<MobileNav />);
    const createLinks = screen.getAllByRole("link", { name: /Create Plan/i });
    expect(createLinks.length).toBe(1);
  });
});

describe("MobileNav (SSR/server-render smoke tests)", () => {
  it("server-renders without the overflow menu content visually exposed by default (still SSR-safe)", () => {
    mockedUsePathname.mockReturnValue("/dashboard");
    const html = renderToString(<MobileNav />);

    // Primary tabs + FAB present in the markup.
    expect(html).toContain("Dashboard");
    expect(html).toContain("Plan");
    expect(html).toContain("History");
    expect(html).toContain('href="/create-plan"');
    expect(html).toContain("More");
  });

  it("includes memory/billing labels in the server-rendered markup (overflow panel content)", () => {
    mockedUsePathname.mockReturnValue("/dashboard");
    const html = renderToString(
      <MobileNav memoryNavLabel="Memory" billingNavLabel="Billing" />,
    );

    expect(html).toContain("Memory");
    expect(html).toContain("Billing");
  });
});
