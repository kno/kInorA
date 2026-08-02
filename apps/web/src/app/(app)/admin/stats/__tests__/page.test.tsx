import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

/**
 * /admin/stats page (GH #309): a server component that gates on the
 * authenticated profile's `isAdmin` flag (the SAME guard the /admin landing,
 * /admin/tenants and /admin/logs pages use — profile fetch → redirect("/")
 * unless admin) and, for admins, fetches the aggregates and renders StatsView.
 */

const cookieGet = vi.fn();
// Real Next.js `redirect()` throws to halt rendering — model that so the
// non-admin path provably never reaches the stats fetch below.
const redirect = vi.fn((..._args: unknown[]) => {
  throw new Error("NEXT_REDIRECT");
});
const fetchProfile = vi.fn();
const fetchStats = vi.fn();

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

vi.mock("../stats-client", () => ({
  fetchStats: (...args: unknown[]) => fetchStats(...args),
}));

vi.mock("../StatsView", () => ({
  StatsView: (_props: AnyProps) => null,
}));

import AdminStatsPage from "../page";
import { StatsView } from "../StatsView";
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

const SAMPLE_STATS = {
  tenants: { total: 1, signups7d: 0, signups30d: 1 },
  users: { total: 1, signups7d: 0, signups30d: 1 },
  memberships: { activeByRole: { owner: 1, member: 0, trainer: 0 } },
  billing: {
    effectiveTier: { free: 1, pro: 0, trainer: 0, gym: 0 },
    activeStripeSubscriptions: 0,
    trials: 0,
    activeOverridesByTier: { free: 0, pro: 0, trainer: 0, gym: 0 },
  },
  usage: {
    thisPeriod: "2026-08",
    byFeature: { plan_generation: 0, plan_regeneration: 0, memory_write: 0, memory_retrieval: 0 },
  },
  observability: { errors24h: 0, events24h: 0 },
};

describe("AdminStatsPage (server component)", () => {
  it("redirects to / when there is no session token (unauthenticated)", async () => {
    cookieGet.mockReturnValue(undefined);
    fetchProfile.mockResolvedValue(null);

    await expect(AdminStatsPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
    expect(fetchStats).not.toHaveBeenCalled();
  });

  it("redirects to / when the profile is not an admin (403-equivalent)", async () => {
    cookieGet.mockReturnValue({ value: "member-token" });
    fetchProfile.mockResolvedValue({
      email: "user@example.com",
      initials: "U",
      tenantName: "workspace",
      isAdmin: false,
    });

    await expect(AdminStatsPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
    expect(fetchStats).not.toHaveBeenCalled();
  });

  it("fetches the stats and renders StatsView for an admin user", async () => {
    cookieGet.mockReturnValue({ value: "admin-token" });
    fetchProfile.mockResolvedValue({
      email: "root@example.com",
      initials: "R",
      tenantName: "workspace",
      isAdmin: true,
    });
    fetchStats.mockResolvedValue({ kind: "ok", stats: SAMPLE_STATS });

    const page = (await AdminStatsPage()) as AnyElement;

    expect(redirect).not.toHaveBeenCalled();
    expect(fetchStats).toHaveBeenCalledWith("admin-token");
    const view = findFirst(page, (el) => el.type === StatsView);
    expect(view).toBeDefined();
    expect(view?.props.stats).toEqual(SAMPLE_STATS);
  });

  it("renders an error message (not StatsView) when the stats fetch fails", async () => {
    cookieGet.mockReturnValue({ value: "admin-token" });
    fetchProfile.mockResolvedValue({
      email: "root@example.com",
      initials: "R",
      tenantName: "workspace",
      isAdmin: true,
    });
    fetchStats.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = (await AdminStatsPage()) as AnyElement;

    const view = findFirst(page, (el) => el.type === StatsView);
    expect(view).toBeUndefined();
    const error = findFirst(page, (el) => el.props?.["data-testid"] === "stats-error");
    expect(error).toBeDefined();
  });
});
