import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { adminTenantsRoutes, type AdminTenantsRouteRepo } from "../admin-tenants.js";
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

function buildRepo(
  userRow: typeof ADMIN_USER_ROW | typeof NONADMIN_USER_ROW | null,
  overrides: Partial<AdminTenantsRouteRepo> = {},
): AdminTenantsRouteRepo {
  return {
    findUserById: vi.fn().mockResolvedValue(userRow),
    searchTenants: vi.fn().mockResolvedValue([{ id: TENANT_ID, name: "Acme Gym" }]),
    loadProvisioningState: vi.fn().mockResolvedValue({
      tenant: { id: TENANT_ID, name: "Acme Gym" },
      billing: {
        tier: "free",
        status: "active",
        source: "backfill",
        trialStartedAt: null,
        trialEndsAt: null,
      },
      activeOverride: null,
    }),
    ...overrides,
  };
}

async function buildTestApp(repo: AdminTenantsRouteRepo): Promise<FastifyInstance> {
  const db = createAuthMockDb({
    sessionRows: [SESSION_ROW],
    membershipRows: [ACTIVE_MEMBERSHIP_ROW],
  }).db as never;

  const app = Fastify();
  app.setErrorHandler((error: unknown, _req, reply) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Boolean((error as { validation: unknown }).validation)
    ) {
      return reply.code(422).send({ error: "Validation Error" });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  await app.register(authPlugin, { db });
  await app.register(adminTenantsRoutes, { repo });
  return app;
}

describe("GET /admin/tenants (search)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("returns 403 for non-admin", async () => {
    app = await buildTestApp(buildRepo(NONADMIN_USER_ROW));
    const res = await app.inject({
      method: "GET",
      url: `/admin/tenants?query=acme`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 with an id+name-only tenant list for an admin", async () => {
    const repo = buildRepo(ADMIN_USER_ROW);
    app = await buildTestApp(repo);
    const res = await app.inject({
      method: "GET",
      url: `/admin/tenants?query=acme&limit=10`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tenants: { id: string; name: string }[] };
    expect(body.tenants).toEqual([{ id: TENANT_ID, name: "Acme Gym" }]);
    expect(repo.searchTenants).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: null, limit: 10 }),
    );
  });

  it("returns 422 for an empty query", async () => {
    app = await buildTestApp(buildRepo(ADMIN_USER_ROW));
    const res = await app.inject({
      method: "GET",
      url: `/admin/tenants?query=%20%20`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("GET /admin/tenants/:tenantId/tier-override (status)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("returns 403 for non-admin", async () => {
    app = await buildTestApp(buildRepo(NONADMIN_USER_ROW));
    const res = await app.inject({
      method: "GET",
      url: `/admin/tenants/${TENANT_ID}/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for an unknown tenant", async () => {
    const repo = buildRepo(ADMIN_USER_ROW, {
      loadProvisioningState: vi
        .fn()
        .mockResolvedValue({ tenant: null, billing: null, activeOverride: null }),
    });
    app = await buildTestApp(repo);
    const res = await app.inject({
      method: "GET",
      url: `/admin/tenants/${TENANT_ID}/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 with the resolved billing tier when no override is active", async () => {
    const repo = buildRepo(ADMIN_USER_ROW, {
      loadProvisioningState: vi.fn().mockResolvedValue({
        tenant: { id: TENANT_ID, name: "Acme Gym" },
        billing: {
          tier: "pro",
          status: "active",
          source: "stripe",
          trialStartedAt: null,
          trialEndsAt: null,
        },
        activeOverride: null,
      }),
    });
    app = await buildTestApp(repo);
    const res = await app.inject({
      method: "GET",
      url: `/admin/tenants/${TENANT_ID}/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tenant: { id: string; name: string };
      effectiveTier: string;
      billingStatus: string | null;
      activeOverride: unknown;
    };
    expect(body.tenant).toEqual({ id: TENANT_ID, name: "Acme Gym" });
    expect(body.effectiveTier).toBe("pro");
    expect(body.billingStatus).toBe("active");
    expect(body.activeOverride).toBeNull();
  });

  it("returns 200 with the override tier winning when an override is active", async () => {
    const starts = new Date("2026-08-01T00:00:00Z");
    const ends = new Date("9999-12-31T00:00:00Z");
    const repo = buildRepo(ADMIN_USER_ROW, {
      loadProvisioningState: vi.fn().mockResolvedValue({
        tenant: { id: TENANT_ID, name: "Acme Gym" },
        billing: {
          tier: "free",
          status: "active",
          source: "backfill",
          trialStartedAt: null,
          trialEndsAt: null,
        },
        activeOverride: { id: "override-1", tier: "gym", startsAt: starts, endsAt: ends },
      }),
    });
    app = await buildTestApp(repo);
    const res = await app.inject({
      method: "GET",
      url: `/admin/tenants/${TENANT_ID}/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      effectiveTier: string;
      activeOverride: { id: string; tier: string; startsAt: string; endsAt: string } | null;
    };
    expect(body.effectiveTier).toBe("gym");
    expect(body.activeOverride).toEqual({
      id: "override-1",
      tier: "gym",
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
    });
  });

  it("returns 422 (not 500) for a malformed tenantId path param", async () => {
    app = await buildTestApp(buildRepo(ADMIN_USER_ROW));
    const res = await app.inject({
      method: "GET",
      url: `/admin/tenants/not-a-uuid/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(422);
  });
});
