// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LandingNavClient } from "../LandingNavClient";

/**
 * `LandingNav.test.tsx` covers this component's static markup through
 * `renderToStaticMarkup`, which never runs effects. These tests run it in
 * jsdom instead, so the scroll subscription and the mobile-menu state
 * transitions are exercised as real behaviour.
 */

const props = {
  brandLabel: "kInorA",
  links: [
    { href: "#features", label: "Features" },
    { href: "#pricing", label: "Pricing" },
  ],
  loginLabel: "Log in",
  signupLabel: "Sign up",
  menuAriaLabel: "Open menu",
  navAriaLabel: "Primary",
};

/** Sets `window.scrollY` (a read-only accessor in jsdom) and fires a scroll. */
function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

describe("LandingNavClient scroll frosting", () => {
  it("is unfrosted at the top of the page", () => {
    render(<LandingNavClient {...props} />);
    expect(
      screen.getByRole("banner").classList.contains("kin-landing-nav--scrolled"),
    ).toBe(false);
  });

  it("frosts the header once the page scrolls past the 16px threshold", () => {
    render(<LandingNavClient {...props} />);
    scrollTo(40);
    expect(
      screen.getByRole("banner").classList.contains("kin-landing-nav--scrolled"),
    ).toBe(true);
  });

  it("stays unfrosted at exactly the threshold, and unfrosts again on scrolling back up", () => {
    render(<LandingNavClient {...props} />);

    // shouldFrost is strictly greater-than, so 16 itself must not frost.
    scrollTo(16);
    expect(
      screen.getByRole("banner").classList.contains("kin-landing-nav--scrolled"),
    ).toBe(false);

    scrollTo(17);
    expect(
      screen.getByRole("banner").classList.contains("kin-landing-nav--scrolled"),
    ).toBe(true);

    scrollTo(0);
    expect(
      screen.getByRole("banner").classList.contains("kin-landing-nav--scrolled"),
    ).toBe(false);
  });

  it("frosts on mount when the page is restored mid-scroll", () => {
    // Browsers restore scroll position before hydration, so the effect must
    // read the CURRENT scrollY on mount rather than waiting for an event.
    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    render(<LandingNavClient {...props} />);
    expect(
      screen.getByRole("banner").classList.contains("kin-landing-nav--scrolled"),
    ).toBe(true);
  });

  it("removes the scroll listener on unmount", () => {
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<LandingNavClient {...props} />);

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});

describe("LandingNavClient mobile menu", () => {
  it("is collapsed initially and expands when the toggle is pressed", () => {
    render(<LandingNavClient {...props} />);
    const toggle = screen.getByRole("button", { name: "Open menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen
        .getByRole("navigation", { name: "Primary" })
        .classList.contains("kin-landing-nav__links--open"),
    ).toBe(true);
  });

  it("collapses again on a second toggle press", () => {
    render(<LandingNavClient {...props} />);
    const toggle = screen.getByRole("button", { name: "Open menu" });

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses when a nav link is followed, so the overlay does not cover the target", () => {
    render(<LandingNavClient {...props} />);
    const toggle = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("link", { name: "Pricing" }));

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("points aria-controls at the nav element it expands", () => {
    render(<LandingNavClient {...props} />);
    const toggle = screen.getByRole("button", { name: "Open menu" });
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(toggle.getAttribute("aria-controls")).toBe(nav.id);
    expect(nav.id).not.toBe("");
  });
});
