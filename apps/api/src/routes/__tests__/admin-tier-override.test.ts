import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { adminTierOverrideRoutes } from "../admin-tier-override.js";
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

function buildMockDb(sessionRow: typeof SESSION_ROW | null) {
  return createAuthMockDb({
    sessionRows: sessionRow ? [sessionRow] : [],
    membershipRows: [ACTIVE_MEMBERSHIP_ROW],
  }).db;
}

function buildRepo(
  userRow: typeof ADMIN_USER_ROW | typeof NONADMIN_USER_ROW | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    findUserById: vi.fn().mockResolvedValue(userRow),
    loadTenant: vi.fn().mockResolvedValue({ id: TENANT_ID }),
    loadActiveOverride: vi.fn().mockResolvedValue(null),
    grantTierOverride: vi.fn().mockResolvedValue({
      id: "override-1",
      startsAt: new Date("2026-08-02T12:00:00Z"),
      endsAt: new Date("9999-12-31T00:00:00Z"),
    }),
    revokeTierOverride: vi.fn().mockResolvedValue({
      id: "override-1",
      endsAt: new Date("2026-08-02T13:00:00Z"),
    }),
    ...overrides,
  };
}

async function buildTestApp(
  userRow: typeof ADMIN_USER_ROW | typeof NONADMIN_USER_ROW | null,
  repo = buildRepo(userRow),
): Promise<FastifyInstance> {
  const db = buildMockDb(SESSION_ROW) as never;

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
  await app.register(adminTierOverrideRoutes, { repo });

  return app;
}

describe("POST /admin/tenants/:tenantId/tier-override", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 403 for non-admin", async () => {
    app = await buildTestApp(NONADMIN_USER_ROW);

    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT_ID}/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { tier: "trainer", reason: "pilot" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 201 for a valid admin grant", async () => {
    const repo = buildRepo(ADMIN_USER_ROW);
    app = await buildTestApp(ADMIN_USER_ROW, repo);

    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT_ID}/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { tier: "trainer", reason: "pilot program" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; tenantId: string; tier: string; reason: string };
    expect(body.id).toBe("override-1");
    expect(body.tier).toBe("trainer");
    expect(repo.grantTierOverride).toHaveBeenCalled();
  });

  it("returns 404 for an unknown tenant", async () => {
    const repo = buildRepo(ADMIN_USER_ROW, { loadTenant: vi.fn().mockResolvedValue(null) });
    app = await buildTestApp(ADMIN_USER_ROW, repo);

    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT_ID}/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { tier: "trainer", reason: "pilot" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when an active override already exists (overlap)", async () => {
    const repo = buildRepo(ADMIN_USER_ROW, {
      loadActiveOverride: vi.fn().mockResolvedValue({ id: "existing-override" }),
    });
    app = await buildTestApp(ADMIN_USER_ROW, repo);

    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT_ID}/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { tier: "gym", reason: "pilot" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("returns 422 for an invalid tier", async () => {
    app = await buildTestApp(ADMIN_USER_ROW);

    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT_ID}/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { tier: "pro", reason: "pilot" },
    });

    expect(res.statusCode).toBe(422);
  });

  it("returns 422 for an empty reason", async () => {
    app = await buildTestApp(ADMIN_USER_ROW);

    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT_ID}/tier-override`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { tier: "trainer", reason: "" },
    });

    expect(res.statusCode).toBe(422);
  });
});

describe("POST /admin/tenants/:tenantId/tier-override/revoke", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 403 for non-admin", async () => {
    app = await buildTestApp(NONADMIN_USER_ROW);

    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT_ID}/tier-override/revoke`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 200 for a successful revoke", async () => {
    const repo = buildRepo(ADMIN_USER_ROW, {
      loadActiveOverride: vi.fn().mockResolvedValue({ id: "override-1" }),
    });
    app = await buildTestApp(ADMIN_USER_ROW, repo);

    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT_ID}/tier-override/revoke`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; tenantId: string; endsAt: string };
    expect(body.id).toBe("override-1");
    expect(repo.revokeTierOverride).toHaveBeenCalled();
  });

  it("returns 409 when there is no active override", async () => {
    const repo = buildRepo(ADMIN_USER_ROW, { loadActiveOverride: vi.fn().mockResolvedValue(null) });
    app = await buildTestApp(ADMIN_USER_ROW, repo);

    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT_ID}/tier-override/revoke`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(409);
  });
});
