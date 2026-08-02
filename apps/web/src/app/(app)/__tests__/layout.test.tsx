import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { catalogs } from "@kinora/i18n";
import { usePathname } from "next/navigation";
import AppLayout from "../layout";

function renderToStringWithIntl(ui: Parameters<typeof renderToString>[0]) {
  return renderToString(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard"),
}));

// AppLayout is now async and reads the session cookie. Provide a mock
// so the module resolves without a running Next.js request context.
// `jarGet` is a controllable `vi.fn` (not a plain arrow) so the Slice 5 gym
// branding tests below can simulate a present session token for a single
// describe block while the pre-existing tests keep the "no token" default.
const jarGet = vi.fn((_name: string) => undefined as { value: string } | undefined);
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (...args: [string]) => jarGet(...args),
  })),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => ((key: string) => ({
    "memory.navLabel": "Memory",
    "billing.navLabel": "Billing",
  })[key] ?? key),
}));

// Profile client is called only when a token exists (mocked as undefined above).
vi.mock("../auth/profile-client", () => ({
  fetchProfile: vi.fn(async () => null),
}));

// 16a-v3-gym-white-label, Slice 5 — own-tenant branding fetch, called only
// when a session token exists (mocked as undefined by the `next/headers`
// mock above for the pre-existing describe block).
const fetchOwnBranding = vi.fn(async (_token: string) => null as unknown);
vi.mock("../auth/gym-branding-client", () => ({
  fetchOwnBranding: (...args: [string]) => fetchOwnBranding(...args),
}));

vi.mocked(usePathname);

describe("AppLayout (app route group)", () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue("/dashboard");
  });

  it("renders dashboard children inside the AppShell", async () => {
    const html = renderToStringWithIntl(
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
    const html = renderToStringWithIntl(
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

  it("wires the translated memory navigation label through the app shell", async () => {
    const html = renderToStringWithIntl(
      await AppLayout({
        children: <p>Page content here</p>,
      })
    );

    expect(html).toContain("Memory");
  });

  it("wires the translated billing navigation label and /billing link through the app shell", async () => {
    const html = renderToStringWithIntl(
      await AppLayout({
        children: <p>Page content here</p>,
      })
    );

    // The billing nav entry must be reachable: translated label + route.
    expect(html).toContain("Billing");
    expect(html).toContain('href="/billing"');
  });
});

// 16a-v3-gym-white-label, Slice 5 — whole-app root-layout theming for
// logged-in members (tasks 5.1-5.2). Reuses S4's `buildGymStyleBlock` (moved
// to `@/lib/gym-style` in this slice) so both the login page and this layout
// share ONE implementation.
describe("AppLayout — gym branding", () => {
  afterEach(() => {
    jarGet.mockReset().mockReturnValue(undefined);
    fetchOwnBranding.mockReset().mockResolvedValue(null);
  });

  it("injects an inline <style> with the member's own-tenant --gym-* palette when a session token resolves branding", async () => {
    jarGet.mockReturnValue({ value: "session-token-123" });
    fetchOwnBranding.mockResolvedValue({
      logoUrl: "/media/branding/abc",
      palette: {
        accent: "#112233",
        accentFg: "#ffffff",
        surface: "#000000",
        surface2: "#111111",
        fg: "#eeeeee",
        muted: "#999999",
      },
    });

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    expect(fetchOwnBranding).toHaveBeenCalledWith("session-token-123");
    expect(html).toContain("--gym-accent:#112233");
    expect(html).toContain("--gym-surface:#000000");
  });

  it("renders no gym <style> (default kInorA tokens) when the member's tenant has no branding", async () => {
    jarGet.mockReturnValue({ value: "session-token-123" });
    fetchOwnBranding.mockResolvedValue(null);

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    expect(fetchOwnBranding).toHaveBeenCalledWith("session-token-123");
    expect(html).not.toContain("--gym-accent");
  });

  it("skips the branding fetch entirely when there is no session token", async () => {
    jarGet.mockReturnValue(undefined);

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    expect(fetchOwnBranding).not.toHaveBeenCalled();
    expect(html).not.toContain("--gym-accent");
  });
});
