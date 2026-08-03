import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

const cookieGet = vi.fn();
const redirect = vi.fn();
const fetchBranding = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

vi.mock("../branding-client", () => ({
  fetchBranding: (...args: unknown[]) => fetchBranding(...args),
}));

vi.mock("../BrandingStudio", () => ({
  BrandingStudio: (_props: AnyProps) => null,
}));

import BrandingPage from "../page";
import { BrandingStudio } from "../BrandingStudio";
import { createServerTranslator } from "@/test-utils/server-translator";

afterEach(() => {
  vi.clearAllMocks();
});

function findFirst(node: ReactNode, match: (el: AnyElement) => boolean): AnyElement | undefined {
  if (typeof node === "object" && node !== null && "props" in node) {
    const el = node as AnyElement;
    if (match(el)) return el;
    const found = findFirst(el.props.children, match);
    if (found) return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFirst(child, match);
      if (found) return found;
    }
  }
  return undefined;
}

describe("BrandingPage (server component)", () => {
  it("redirects to /dashboard when there is no session token", async () => {
    cookieGet.mockReturnValue(undefined);
    await BrandingPage();
    expect(redirect).toHaveBeenCalledWith("/dashboard");
    expect(fetchBranding).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard on forbidden (non-gym tenant → 403)", async () => {
    cookieGet.mockReturnValue({ value: "member-token" });
    fetchBranding.mockResolvedValue({ kind: "forbidden" });
    await BrandingPage();
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects to /dashboard on unauthorized (401)", async () => {
    cookieGet.mockReturnValue({ value: "stale-token" });
    fetchBranding.mockResolvedValue({ kind: "unauthorized" });
    await BrandingPage();
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders the studio with the current branding on ok", async () => {
    cookieGet.mockReturnValue({ value: "gym-token" });
    const branding = {
      tenantId: "t1",
      subdomainSlug: "acme-gym",
      logoUrl: "/media/branding/k",
      palette: { accent: "#c4f542", accentFg: null, surface: null, surface2: null, fg: null, muted: null },
    };
    fetchBranding.mockResolvedValue({ kind: "ok", branding });

    const page = (await BrandingPage()) as AnyElement;
    expect(redirect).not.toHaveBeenCalled();
    const studio = findFirst(page, (el) => el.type === BrandingStudio);
    expect(studio).toBeDefined();
    expect(studio?.props.initial).toMatchObject({ subdomainSlug: "acme-gym", logoUrl: "/media/branding/k" });
  });

  it("renders the studio with empty defaults on not_found (gym tenant, no branding row yet)", async () => {
    cookieGet.mockReturnValue({ value: "gym-token" });
    fetchBranding.mockResolvedValue({ kind: "not_found" });

    const page = (await BrandingPage()) as AnyElement;
    expect(redirect).not.toHaveBeenCalled();
    const studio = findFirst(page, (el) => el.type === BrandingStudio);
    expect(studio).toBeDefined();
    expect(studio?.props.initial).toMatchObject({ subdomainSlug: "", logoUrl: null });
  });

  it("passes the session token to fetchBranding", async () => {
    cookieGet.mockReturnValue({ value: "my-session-token" });
    fetchBranding.mockResolvedValue({ kind: "not_found" });
    await BrandingPage();
    expect(fetchBranding).toHaveBeenCalledWith("my-session-token");
  });
});
