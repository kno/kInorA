import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { brandingRoutes } from "../branding.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

/**
 * Regression guard (16a-v3-gym-white-label, Slice 3, task 3.12) — mirrors
 * `trainer/__tests__/route-authz-guard.test.ts`'s pattern, but for the
 * gym-gated branding routes.
 *
 * Intent: no gym-scoped branding route may EVER touch the repository or the
 * storage port without FIRST passing `assertGymEntitled`. This proves,
 * through the REAL registered `brandingRoutes` plugin (not a
 * reimplementation), that a non-gym tenant is denied (403) BEFORE any
 * repository or storage call fires — for every CRUD/upload route in the
 * file, enumerated below.
 */

const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

function entitlementReaderMock(tier: "free" | "pro" | "trainer" | "gym") {
  return {
    loadContext: vi.fn().mockResolvedValue({
      membershipStatus: "active",
      billing: { tier, status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      activeOverrideTier: null,
    }),
  };
}

function fakeStorage() {
  return {
    put: vi.fn(async (key: string) => ({ url: `/media/branding/${key}` })),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
  };
}

function fakeRepo() {
  return {
    findByTenantId: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn(),
  };
}

interface GymScopedRoute {
  method: "GET" | "POST" | "PUT";
  path: string;
  request: { method: "GET" | "POST" | "PUT"; url: string; headers?: Record<string, string>; payload?: unknown };
}

const GYM_SCOPED_ROUTES: ReadonlyArray<GymScopedRoute> = [
  { method: "GET", path: "/branding", request: { method: "GET", url: "/branding" } },
  {
    method: "PUT",
    path: "/branding",
    request: {
      method: "PUT",
      url: "/branding",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        subdomainSlug: "gym-a",
        palette: {
          accent: "#112233",
          accentFg: "#ffffff",
          surface: "#000000",
          surface2: "#111111",
          fg: "#eeeeee",
          muted: "#999999",
        },
      }),
    },
  },
  // POST /branding/logo requires a multipart body to reach the multipart
  // parser at all — but the gate runs BEFORE `request.file()` is ever
  // called, so an empty payload still proves the 403-before-any-write
  // invariant without needing a real multipart body here.
  { method: "POST", path: "/branding/logo", request: { method: "POST", url: "/branding/logo" } },
];

function buildSessionDb(): ReturnType<typeof createAuthMockDb>["db"] {
  return createAuthMockDb({
    sessionRows: [buildSessionRow({ tenantId: TENANT_ID, userId: USER_ID })],
    membershipRows: [buildActiveMembershipRow({ tenantId: TENANT_ID, userId: USER_ID, role: "owner" })],
  }).db;
}

async function buildProbeApp(
  storage: ReturnType<typeof fakeStorage>,
  repo: ReturnType<typeof fakeRepo>,
  entitlementReader: ReturnType<typeof entitlementReaderMock>,
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(authPlugin, { db: buildSessionDb() });
  await app.register(brandingRoutes, { repo, storage, entitlementReader });
  return app;
}

describe("regression guard: gym-scoped branding routes must deny before any repo/storage call", () => {
  it("enumerates the current set of gym-scoped branding routes (Slice 3, task 3.12)", () => {
    expect(GYM_SCOPED_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /branding",
      "PUT /branding",
      "POST /branding/logo",
    ]);
  });

  it.each(GYM_SCOPED_ROUTES)(
    "$method $path denies a non-gym tenant (403) before any repository or storage call",
    async (route) => {
      const storage = fakeStorage();
      const repo = fakeRepo();
      const entitlementReader = entitlementReaderMock("pro");
      const app = await buildProbeApp(storage, repo, entitlementReader);

      const res = await app.inject({
        method: route.request.method,
        url: route.request.url,
        headers: { authorization: `Bearer ${VALID_TOKEN}`, ...(route.request.headers ?? {}) },
        payload: route.request.payload,
      });

      expect(res.statusCode).toBe(403);
      expect(repo.findByTenantId).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it.each(GYM_SCOPED_ROUTES)(
    "$method $path denies an unauthenticated caller (401) before any repository or storage call",
    async (route) => {
      const storage = fakeStorage();
      const repo = fakeRepo();
      const entitlementReader = entitlementReaderMock("gym");
      const app = Fastify();
      await app.register(authPlugin, {
        db: {
          select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
        } as never,
      });
      await app.register(brandingRoutes, { repo, storage, entitlementReader });

      const res = await app.inject({
        method: route.request.method,
        url: route.request.url,
        headers: route.request.headers,
        payload: route.request.payload,
      });

      expect(res.statusCode).toBe(401);
      expect(repo.findByTenantId).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
      await app.close();
    },
  );
});
