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
// `headersGet` mirrors `jarGet`: a controllable `vi.fn` backing the mocked
// `headers()` request accessor so the host-based theming tests can simulate
// the request `Host` header (apex vs. gym subdomain) per test.
const headersGet = vi.fn((_name: string) => undefined as string | undefined);
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (...args: [string]) => jarGet(...args),
  })),
  headers: vi.fn(async () => ({
    get: (...args: [string]) => headersGet(...args),
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
// mock above for the pre-existing describe block). GH #322: the result is
// now a discriminated union, not a fail-safe-to-null value — default to
// "forbidden" (non-gym tenant) so pre-existing tests keep their prior
// no-branding, non-gym behavior.
const fetchOwnBranding = vi.fn(async (_token: string) => ({ kind: "forbidden" }) as unknown);
vi.mock("../auth/gym-branding-client", () => ({
  fetchOwnBranding: (...args: [string]) => fetchOwnBranding(...args),
}));

// GH white-label bleed fix — app-shell theming is now HOST-based, mirroring
// the public pages (`page.tsx`, `(auth)/login/page.tsx`): the request `Host`
// header is resolved to a gym slug (`@/lib/gym-slug`) and, when present, the
// PUBLIC read-by-slug endpoint (`@/lib/gym-branding-client`) drives the
// `<style>` injection. `fetchOwnBranding` still runs but ONLY to derive the
// gym-tier `isGym` nav gate — never the theme. Both helpers are mocked so the
// host/slug and public-branding outcomes are controllable per test.
const extractGymSlugFromHost = vi.fn((_host: string | null | undefined) => null as string | null);
vi.mock("@/lib/gym-slug", () => ({
  extractGymSlugFromHost: (...args: [string | null | undefined]) =>
    extractGymSlugFromHost(...args),
}));

const fetchPublicBranding = vi.fn(async (_slug: string) => null as unknown);
vi.mock("@/lib/gym-branding-client", () => ({
  fetchPublicBranding: (...args: [string]) => fetchPublicBranding(...args),
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

// White-label bleed fix — whole-app root-layout theming is HOST-based, not
// tenant-based. The gym palette is resolved from the request `Host` header via
// the PUBLIC read-by-slug endpoint (mirroring the public `page.tsx` and login
// page), so on the apex a logged-in gym owner sees the DEFAULT kInorA theme,
// while on a gym subdomain EVERYONE (owner and clients) gets the gym palette.
// Reuses S4's `buildGymStyleBlock` (in `@/lib/gym-style`) so the public pages
// and this layout share ONE implementation.
const GYM_PALETTE = {
  accent: "#112233",
  accentFg: "#ffffff",
  surface: "#000000",
  surface2: "#111111",
  fg: "#eeeeee",
  muted: "#999999",
};

describe("AppLayout — gym branding (host-based theming)", () => {
  afterEach(() => {
    jarGet.mockReset().mockReturnValue(undefined);
    headersGet.mockReset().mockReturnValue(undefined);
    fetchOwnBranding.mockReset().mockResolvedValue({ kind: "forbidden" });
    extractGymSlugFromHost.mockReset().mockReturnValue(null);
    fetchPublicBranding.mockReset().mockResolvedValue(null);
  });

  it("injects an inline <style> with the host gym's --gym-* palette on a gym subdomain", async () => {
    jarGet.mockReturnValue({ value: "session-token-123" });
    headersGet.mockReturnValue("gymx.kinora.aitsai.com");
    extractGymSlugFromHost.mockReturnValue("gymx");
    fetchPublicBranding.mockResolvedValue({
      logoUrl: "/media/branding/abc",
      palette: GYM_PALETTE,
    });

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    expect(extractGymSlugFromHost).toHaveBeenCalledWith("gymx.kinora.aitsai.com");
    expect(fetchPublicBranding).toHaveBeenCalledWith("gymx");
    expect(html).toContain("--gym-accent:#112233");
    expect(html).toContain("--gym-surface:#000000");
  });

  // Regression guard for the reported bleed: a gym OWNER (own-tenant branding
  // resolves "ok") browsing the APEX (no slug) must NOT get their gym theme —
  // the apex renders the default kInorA theme for everyone.
  it("renders no gym <style> on the apex even for a gym-owner session (regression guard)", async () => {
    jarGet.mockReturnValue({ value: "session-token-123" });
    headersGet.mockReturnValue("kinora.aitsai.com");
    extractGymSlugFromHost.mockReturnValue(null);
    fetchOwnBranding.mockResolvedValue({ kind: "ok", data: { logoUrl: null, palette: GYM_PALETTE } });

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    // No slug ⇒ the public branding fetch is skipped and no theme is injected,
    // regardless of the owner's own-tenant branding.
    expect(fetchPublicBranding).not.toHaveBeenCalled();
    expect(html).not.toContain("--gym-accent");
  });

  it("renders no gym <style> when the host slug has no public branding row", async () => {
    jarGet.mockReturnValue({ value: "session-token-123" });
    headersGet.mockReturnValue("gymx.kinora.aitsai.com");
    extractGymSlugFromHost.mockReturnValue("gymx");
    fetchPublicBranding.mockResolvedValue(null);

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    expect(fetchPublicBranding).toHaveBeenCalledWith("gymx");
    expect(html).not.toContain("--gym-accent");
  });

  it("skips both branding fetches entirely when there is no session token", async () => {
    jarGet.mockReturnValue(undefined);

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    expect(fetchOwnBranding).not.toHaveBeenCalled();
    expect(fetchPublicBranding).not.toHaveBeenCalled();
    expect(html).not.toContain("--gym-accent");
  });
});

// GH #322 — the gym Branding Studio nav entry is gated on `isGym`, derived
// from the SAME branding fetch the layout already makes for theming (no new
// endpoint, no new fetch). A "forbidden" (403, non-gym tenant) result means
// NOT gym; both "ok" (branding row present) and "not_found" (gym tenant, no
// branding row yet) mean the tenant IS gym-tier.
describe("AppLayout — isGym derivation for the Branding nav entry (GH #322)", () => {
  afterEach(() => {
    jarGet.mockReset().mockReturnValue(undefined);
    headersGet.mockReset().mockReturnValue(undefined);
    fetchOwnBranding.mockReset().mockResolvedValue({ kind: "forbidden" });
    extractGymSlugFromHost.mockReset().mockReturnValue(null);
    fetchPublicBranding.mockReset().mockResolvedValue(null);
  });

  it("wires isGym=true through to the AppShell when the branding fetch resolves ok", async () => {
    jarGet.mockReturnValue({ value: "session-token-123" });
    fetchOwnBranding.mockResolvedValue({
      kind: "ok",
      data: {
        logoUrl: null,
        palette: {
          accent: "#112233",
          accentFg: "#ffffff",
          surface: "#000000",
          surface2: "#111111",
          fg: "#eeeeee",
          muted: "#999999",
        },
      },
    });

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    expect(html).toContain('href="/branding"');
  });

  it("wires isGym=true through to the AppShell when the branding fetch resolves not_found (gym tenant, no branding row yet)", async () => {
    jarGet.mockReturnValue({ value: "session-token-123" });
    fetchOwnBranding.mockResolvedValue({ kind: "not_found" });

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    expect(html).toContain('href="/branding"');
  });

  it("wires isGym=false through to the AppShell when the branding fetch resolves forbidden (non-gym tenant)", async () => {
    jarGet.mockReturnValue({ value: "session-token-123" });
    fetchOwnBranding.mockResolvedValue({ kind: "forbidden" });

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    expect(html).not.toContain('href="/branding"');
  });

  it("wires isGym=false through to the AppShell when there is no session token", async () => {
    jarGet.mockReturnValue(undefined);

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    expect(html).not.toContain('href="/branding"');
  });

  // isGym gating is driven by `fetchOwnBranding` (the tenant's gym-tier
  // entitlement), NOT by the request host. A gym owner on the APEX (no slug,
  // default theme) must still see the "Marca"/branding nav entry.
  it("keeps isGym=true on the apex (no slug, default theme) for a gym-owner session", async () => {
    jarGet.mockReturnValue({ value: "session-token-123" });
    headersGet.mockReturnValue("kinora.aitsai.com");
    extractGymSlugFromHost.mockReturnValue(null);
    fetchOwnBranding.mockResolvedValue({ kind: "not_found" });

    const html = renderToStringWithIntl(
      await AppLayout({ children: <p>Page content here</p> })
    );

    // Nav entry present (gym-tier) even though NO gym theme is injected.
    expect(html).toContain('href="/branding"');
    expect(html).not.toContain("--gym-accent");
  });
});
