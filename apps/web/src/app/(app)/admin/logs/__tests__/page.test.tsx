import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

/**
 * /admin/logs page (GH #310, Slice 2): a server component that gates on the
 * authenticated profile's `isAdmin` flag (the SAME guard the /admin landing
 * and /admin/tenants pages use — profile fetch → redirect("/") unless admin)
 * and, for admins, renders the client LogsView.
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

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

vi.mock("../../../auth/profile-client", () => ({
  fetchProfile: (...args: unknown[]) => fetchProfile(...args),
}));

vi.mock("../LogsView", () => ({
  LogsView: (_props: AnyProps) => null,
}));

import LogsPage from "../page";
import { LogsView } from "../LogsView";
import { createServerTranslator } from "@/test-utils/server-translator";

afterEach(() => {
  vi.clearAllMocks();
});

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

describe("LogsPage (server component)", () => {
  it("redirects to / when there is no session token (unauthenticated)", async () => {
    cookieGet.mockReturnValue(undefined);
    fetchProfile.mockResolvedValue(null);

    await LogsPage();

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

    await LogsPage();

    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("renders the LogsView for an admin user", async () => {
    cookieGet.mockReturnValue({ value: "admin-token" });
    fetchProfile.mockResolvedValue({
      email: "root@example.com",
      initials: "R",
      tenantName: "workspace",
      isAdmin: true,
    });

    const page = (await LogsPage()) as AnyElement;

    expect(redirect).not.toHaveBeenCalled();
    const view = findFirst(page, (el) => el.type === LogsView);
    expect(view).toBeDefined();
  });

  it("passes the session token to fetchProfile", async () => {
    cookieGet.mockReturnValue({ value: "my-session-token" });
    fetchProfile.mockResolvedValue({
      email: "root@example.com",
      initials: "R",
      tenantName: "workspace",
      isAdmin: true,
    });

    await LogsPage();

    expect(fetchProfile).toHaveBeenCalledWith("my-session-token");
  });
});
