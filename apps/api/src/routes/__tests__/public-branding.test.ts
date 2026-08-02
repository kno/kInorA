import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { publicBrandingRoutes, type PublicBrandingRouteRepo } from "../public-branding.js";

/**
 * `GET /public/branding/by-slug/:slug` route tests (16a-v3-gym-white-label,
 * Slice 3, tasks 3.9-3.10). This is the ONE deliberately UNAUTHENTICATED
 * endpoint in this change — every test here builds the app WITHOUT
 * registering `authPlugin`/any auth preHandler, proving the route is
 * reachable with no session at all.
 */

const TENANT_A = "bbbbbbbb-0000-0000-0000-000000000001";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000002";

const PALETTE_A = {
  accent: "#112233",
  accentFg: "#ffffff",
  surface: "#000000",
  surface2: "#111111",
  fg: "#eeeeee",
  muted: "#999999",
};

const PALETTE_B = {
  accent: "#aa00aa",
  accentFg: "#000000",
  surface: "#ffffff",
  surface2: "#dddddd",
  fg: "#222222",
  muted: "#555555",
};

function fakeRepo(
  overrides: Partial<PublicBrandingRouteRepo> = {},
): PublicBrandingRouteRepo & { findBySubdomainSlug: ReturnType<typeof vi.fn> } {
  return {
    findBySubdomainSlug: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as PublicBrandingRouteRepo & { findBySubdomainSlug: ReturnType<typeof vi.fn> };
}

async function buildTestApp(repo: PublicBrandingRouteRepo): Promise<FastifyInstance> {
  const app = Fastify();
  // No authPlugin registered — proves the route needs no session at all.
  await app.register(publicBrandingRoutes, { repo });
  return app;
}

describe("GET /public/branding/by-slug/:slug (unauthenticated, public)", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("requires NO auth — no authorization header, no session — and still resolves a known slug (task 3.9)", async () => {
    const repo = fakeRepo({
      findBySubdomainSlug: vi.fn(async (slug: string) =>
        slug === "gym-a"
          ? {
              tenantId: TENANT_A,
              subdomainSlug: "gym-a",
              logoUrl: null,
              logoStorageKey: "logo-key-a",
              palette: PALETTE_A,
            }
          : undefined,
      ),
    });
    app = await buildTestApp(repo);

    const res = await app.inject({ method: "GET", url: "/public/branding/by-slug/gym-a" });

    expect(res.statusCode).toBe(200);
  });

  it("returns ONLY logoUrl + palette for the requested slug — no tenantId, no subdomainSlug, no PII (task 3.9)", async () => {
    const repo = fakeRepo({
      findBySubdomainSlug: vi.fn().mockResolvedValue({
        tenantId: TENANT_A,
        subdomainSlug: "gym-a",
        logoUrl: null,
        logoStorageKey: "logo-key-a",
        palette: PALETTE_A,
      }),
    });
    app = await buildTestApp(repo);

    const res = await app.inject({ method: "GET", url: "/public/branding/by-slug/gym-a" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["logoUrl", "palette"]);
    expect(body.logoUrl).toBe("/media/branding/logo-key-a");
    expect(body.palette).toEqual(PALETTE_A);
    expect(body.tenantId).toBeUndefined();
    expect(body.subdomainSlug).toBeUndefined();
  });

  it("never leaks gym B's data when gym A's slug is requested (task 3.9 / cross-tenant isolation)", async () => {
    const repo = fakeRepo({
      findBySubdomainSlug: vi.fn(async (slug: string) => {
        if (slug === "gym-a") {
          return {
            tenantId: TENANT_A,
            subdomainSlug: "gym-a",
            logoUrl: null,
            logoStorageKey: "logo-key-a",
            palette: PALETTE_A,
          };
        }
        if (slug === "gym-b") {
          return {
            tenantId: TENANT_B,
            subdomainSlug: "gym-b",
            logoUrl: null,
            logoStorageKey: "logo-key-b",
            palette: PALETTE_B,
          };
        }
        return undefined;
      }),
    });
    app = await buildTestApp(repo);

    const res = await app.inject({ method: "GET", url: "/public/branding/by-slug/gym-a" });

    const body = res.json() as { palette: typeof PALETTE_A };
    expect(body.palette).toEqual(PALETTE_A);
    expect(body.palette).not.toEqual(PALETTE_B);
    expect(repo.findBySubdomainSlug).toHaveBeenCalledWith("gym-a");
    expect(repo.findBySubdomainSlug).not.toHaveBeenCalledWith("gym-b");
  });

  it("returns 404 (not an error page) for an unknown slug, no server error (task 3.10)", async () => {
    const repo = fakeRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({ method: "GET", url: "/public/branding/by-slug/unknown-slug" });

    expect(res.statusCode).toBe(404);
  });
});
