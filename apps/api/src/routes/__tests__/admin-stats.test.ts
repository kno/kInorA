import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import {
  adminStatsRoutes,
  type AdminStatsRouteRepo,
  type PlatformStats,
} from "../admin-stats.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const SESSION_ROW = buildSessionRow({
  tokenHash: "hash-of-token",
  tenantId: TENANT_ID,
  userId: USER_ID,
});
const ADMIN_USER_ROW = { id: USER_ID, email: "admin@test.com", isAdmin: true };
const NONADMIN_USER_ROW = { id: USER_ID, email: "user@test.com", isAdmin: false };
const ACTIVE_MEMBERSHIP_ROW = buildActiveMembershipRow({ tenantId: TENANT_ID, userId: USER_ID });

const SAMPLE_STATS: PlatformStats = {
  tenants: { total: 12, signups7d: 2, signups30d: 5 },
  users: { total: 40, signups7d: 6, signups30d: 15 },
  memberships: { activeByRole: { owner: 10, member: 25, trainer: 3 } },
  billing: {
    effectiveTier: { free: 6, pro: 4, trainer: 1, gym: 1 },
    activeStripeSubscriptions: 4,
    trials: 2,
    activeOverridesByTier: { free: 0, pro: 0, trainer: 1, gym: 1 },
  },
  usage: {
    thisPeriod: "2026-08",
    byFeature: {
      plan_generation: 30,
      plan_regeneration: 5,
      memory_write: 12,
      memory_retrieval: 8,
    },
  },
  observability: { errors24h: 1, events24h: 20 },
};

function buildRepo(
  userRow: typeof ADMIN_USER_ROW | typeof NONADMIN_USER_ROW | null,
  overrides: Partial<AdminStatsRouteRepo> = {},
): AdminStatsRouteRepo {
  return {
    findUserById: vi.fn().mockResolvedValue(userRow),
    getPlatformStats: vi.fn().mockResolvedValue(SAMPLE_STATS),
    ...overrides,
  };
}

async function buildTestApp(repo: AdminStatsRouteRepo): Promise<FastifyInstance> {
  const db = createAuthMockDb({
    sessionRows: [SESSION_ROW],
    membershipRows: [ACTIVE_MEMBERSHIP_ROW],
  }).db as never;

  const app = Fastify();
  await app.register(authPlugin, { db });
  await app.register(adminStatsRoutes, { repo });
  return app;
}

describe("GET /admin/stats", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("returns 401 when unauthenticated", async () => {
    app = await buildTestApp(buildRepo(ADMIN_USER_ROW));
    const res = await app.inject({ method: "GET", url: "/admin/stats" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin", async () => {
    app = await buildTestApp(buildRepo(NONADMIN_USER_ROW));
    const res = await app.inject({
      method: "GET",
      url: "/admin/stats",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 with the nested aggregate stats object for an admin", async () => {
    const repo = buildRepo(ADMIN_USER_ROW);
    app = await buildTestApp(repo);
    const res = await app.inject({
      method: "GET",
      url: "/admin/stats",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(repo.getPlatformStats).toHaveBeenCalledTimes(1);
    const body = res.json() as PlatformStats;
    expect(body).toEqual(SAMPLE_STATS);
  });
});
