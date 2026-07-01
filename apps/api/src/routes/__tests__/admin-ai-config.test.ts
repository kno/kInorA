import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { adminAiConfigRoutes } from "../admin-ai-config.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

// --- Fixtures ---

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const SESSION_ROW = buildSessionRow({
  tokenHash: "hash-of-token",
  tenantId: TENANT_ID,
  userId: USER_ID,
});

const ADMIN_USER_ROW = { id: USER_ID, email: "admin@test.com", isAdmin: true };
const NONADMIN_USER_ROW = { id: USER_ID, email: "user@test.com", isAdmin: false };

const CONFIG_ROW = {
  provider: "openrouter",
  model: "openai/gpt-4o-mini",
  updatedAt: new Date("2026-06-30T00:00:00Z"),
};

// --- Mock DB builder ---
//
// The auth plugin's onRequest hook calls, in order:
//   1. db.select().from(sessions).where(...)            → session row
//   2. db.select().from(memberships).where(and(tenantId, userId)) → membership row
//      (fail-secure, TENANT-SCOPED re-check that the user is still `active`)
//
// requireAdmin then calls via UserRepository:
//   3. db.select().from(users).where(eq(users.id, ...)) → user row
//
// The shared createAuthMockDb models selects 1+2; the user row is passed as an
// additional (3rd) ordered select.

const ACTIVE_MEMBERSHIP_ROW = buildActiveMembershipRow({
  tenantId: TENANT_ID,
  userId: USER_ID,
});

function buildMockDb(
  sessionRow: typeof SESSION_ROW | null,
  userRow: typeof ADMIN_USER_ROW | typeof NONADMIN_USER_ROW | null
) {
  return createAuthMockDb({
    sessionRows: sessionRow ? [sessionRow] : [],
    membershipRows: [ACTIVE_MEMBERSHIP_ROW],
    additionalRows: [userRow ? [userRow] : []],
  }).db;
}

// --- Config repo mock ---

function buildConfigRepo(activeRow: typeof CONFIG_ROW | null = CONFIG_ROW) {
  return {
    getActive: vi.fn().mockResolvedValue(activeRow),
    upsert: vi.fn().mockImplementation(async (provider: string, model: string) => ({
      ...CONFIG_ROW,
      provider,
      model,
      updatedAt: new Date(),
    })),
  };
}

// --- App builder ---

async function buildTestApp(
  userRow: typeof ADMIN_USER_ROW | typeof NONADMIN_USER_ROW | null,
  sessionExists = true,
  configRepo = buildConfigRepo()
): Promise<FastifyInstance> {
  const db = buildMockDb(sessionExists ? SESSION_ROW : null, userRow) as never;

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
  await app.register(adminAiConfigRoutes, { db, configRepo });

  return app;
}

// --- Tests ---

describe("GET /admin/ai-config", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  // SC-01: unauthenticated → 401
  it("returns 401 when no Bearer token is provided (SC-01)", async () => {
    app = await buildTestApp(ADMIN_USER_ROW);

    const res = await app.inject({ method: "GET", url: "/admin/ai-config" });

    expect(res.statusCode).toBe(401);
  });

  // SC-02: authenticated, not admin → 403
  it("returns 403 when authenticated user is not admin (SC-02)", async () => {
    app = await buildTestApp(NONADMIN_USER_ROW);

    const res = await app.inject({
      method: "GET",
      url: "/admin/ai-config",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
  });

  // SC-03: admin user → 200 with config
  it("returns 200 with provider, model, updatedAt for admin user (SC-03)", async () => {
    app = await buildTestApp(ADMIN_USER_ROW);

    const res = await app.inject({
      method: "GET",
      url: "/admin/ai-config",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { provider: string; model: string; updatedAt: string };
    expect(body.provider).toBe("openrouter");
    expect(body.model).toBe("openai/gpt-4o-mini");
    expect(typeof body.updatedAt).toBe("string");
  });

  it("returns null when no config row exists", async () => {
    app = await buildTestApp(ADMIN_USER_ROW, true, buildConfigRepo(null));

    const res = await app.inject({
      method: "GET",
      url: "/admin/ai-config",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });
});

describe("PUT /admin/ai-config", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  // SC-06: not admin → 403
  it("returns 403 when authenticated user is not admin (SC-06)", async () => {
    app = await buildTestApp(NONADMIN_USER_ROW);

    const res = await app.inject({
      method: "PUT",
      url: "/admin/ai-config",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { provider: "openai", model: "gpt-4o" },
    });

    expect(res.statusCode).toBe(403);
  });

  // SC-04: unknown provider → 422
  it("returns 422 for an unknown provider value (SC-04)", async () => {
    app = await buildTestApp(ADMIN_USER_ROW);

    const res = await app.inject({
      method: "PUT",
      url: "/admin/ai-config",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { provider: "fakeprovider", model: "some-model" },
    });

    expect(res.statusCode).toBe(422);
  });

  // SC-05: valid payload → 200, config updated
  it("returns 200 with updated config for a valid payload (SC-05)", async () => {
    const configRepo = buildConfigRepo();
    app = await buildTestApp(ADMIN_USER_ROW, true, configRepo);

    const res = await app.inject({
      method: "PUT",
      url: "/admin/ai-config",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { provider: "openai", model: "gpt-4o" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { provider: string; model: string };
    expect(body.provider).toBe("openai");
    expect(body.model).toBe("gpt-4o");
    expect(configRepo.upsert).toHaveBeenCalledWith("openai", "gpt-4o");
  });

  it("returns 422 when model is an empty string", async () => {
    app = await buildTestApp(ADMIN_USER_ROW);

    const res = await app.inject({
      method: "PUT",
      url: "/admin/ai-config",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { provider: "openai", model: "" },
    });

    expect(res.statusCode).toBe(422);
  });
});
