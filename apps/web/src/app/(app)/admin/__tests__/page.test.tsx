import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

/**
 * /admin landing page (foundation for the admin backoffice access point,
 * GH #306): a server component that gates on the authenticated profile's
 * `isAdmin` flag (mirroring the ai-config page's 401/403 → redirect("/")
 * pattern) and, for admins, lists the admin sections (AI Config live,
 * others "coming soon").
 */

const cookieGet = vi.fn();
const redirect = vi.fn();
const fetchProfile = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}));

// Server component (`getTranslations`) — mocked, matching the pattern used by
// the other (app) page tests (the real next-intl RSC build isn't available
// under Vitest). See `server-translator.ts`.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

vi.mock("../../auth/profile-client", () => ({
  fetchProfile: (...args: unknown[]) => fetchProfile(...args),
}));

import AdminPage from "../page";
import { createServerTranslator } from "@/test-utils/server-translator";

afterEach(() => {
  vi.clearAllMocks();
});

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    return textOf((node as AnyElement).props.children);
  }
  return "";
}

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean,
): AnyElement | undefined {
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

describe("AdminPage (server component)", () => {
  it("redirects to / when there is no session token (unauthenticated)", async () => {
    cookieGet.mockReturnValue(undefined);
    fetchProfile.mockResolvedValue(null);

    await AdminPage();

    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("redirects to / when the profile is not an admin (403-equivalent)", async () => {
    cookieGet.mockReturnValue({ value: "member-token" });
    fetchProfile.mockResolvedValue({
      email: "user@example.com",
      initials: "U",
      tenantName: "workspace",
      isAdmin: false,
    });

    await AdminPage();

    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("renders the admin section list for an admin user, including live links to AI Config and Tenant Provisioning", async () => {
    cookieGet.mockReturnValue({ value: "admin-token" });
    fetchProfile.mockResolvedValue({
      email: "root@example.com",
      initials: "R",
      tenantName: "workspace",
      isAdmin: true,
    });

    const page = (await AdminPage()) as AnyElement;
    const text = textOf(page);

    expect(redirect).not.toHaveBeenCalled();
    expect(text).toContain("AI Config");

    const aiConfigLink = findFirst(page, (el) => el.props?.href === "/admin/ai-config");
    expect(aiConfigLink).toBeDefined();

    // GH #307: Tenant Provisioning is now live, linking to /admin/tenants.
    const tenantsLink = findFirst(page, (el) => el.props?.href === "/admin/tenants");
    expect(tenantsLink).toBeDefined();
  });

  it("lists the remaining coming-soon sections (Platform Statistics, Logs) without live links", async () => {
    cookieGet.mockReturnValue({ value: "admin-token" });
    fetchProfile.mockResolvedValue({
      email: "root@example.com",
      initials: "R",
      tenantName: "workspace",
      isAdmin: true,
    });

    const page = (await AdminPage()) as AnyElement;
    const text = textOf(page);

    expect(text).toContain("Tenant Provisioning");
    expect(text).toContain("Platform Statistics");
    expect(text).toContain("Logs & Observability");
    // Tenant Provisioning went live (GH #307), leaving 2 coming-soon sections.
    expect(text.match(/Coming soon/g)?.length).toBe(2);
  });
});
