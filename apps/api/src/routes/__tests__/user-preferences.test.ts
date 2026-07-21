import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { UserPreferences } from "@kinora/contracts";
import { authPlugin } from "../../auth/plugin.js";
import { userPreferencesRoutes } from "../user-preferences.js";
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
const ACTIVE_MEMBERSHIP_ROW = buildActiveMembershipRow({
  tenantId: TENANT_ID,
  userId: USER_ID,
});

const EXISTING_PREFS = {
  userId: USER_ID,
  defaultLocation: "gym",
  defaultDuration: 60,
  defaultEquipment: ["barbell", "dumbbell"],
};

function buildMockDb() {
  return createAuthMockDb({
    sessionRows: [SESSION_ROW],
    membershipRows: [ACTIVE_MEMBERSHIP_ROW],
  }).db;
}

function buildRepo(overrides: Partial<{
  findPreferencesByUserId: unknown;
  upsertPreferences: unknown;
}> = {}) {
  return {
    findPreferencesByUserId: vi.fn().mockResolvedValue(EXISTING_PREFS),
    upsertPreferences: vi
      .fn()
      .mockImplementation(async (_userId: string, input: Record<string, unknown>) => ({
        userId: USER_ID,
        defaultLocation: input.defaultLocation ?? EXISTING_PREFS.defaultLocation,
        defaultDuration: input.defaultDuration ?? EXISTING_PREFS.defaultDuration,
        defaultEquipment: input.defaultEquipment ?? EXISTING_PREFS.defaultEquipment,
      })),
    ...overrides,
  };
}

async function buildTestApp(repo = buildRepo()): Promise<FastifyInstance> {
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

  await app.register(authPlugin, { db: buildMockDb() });
  await app.register(userPreferencesRoutes, { repo: repo as never });
  return app;
}

// --- Tests ---

describe("GET /user-preferences", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 401 without authentication", async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/user-preferences" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the existing preferences scoped to the authenticated user", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "GET",
      url: "/user-preferences",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as UserPreferences;
    expect(body).toEqual({
      userId: USER_ID,
      defaultLocation: "gym",
      defaultDuration: 60,
      defaultEquipment: ["barbell", "dumbbell"],
    });
    expect(repo.findPreferencesByUserId).toHaveBeenCalledWith(USER_ID);
  });

  it("returns null fields when no preferences row exists", async () => {
    const repo = buildRepo({
      findPreferencesByUserId: vi.fn().mockResolvedValue(null),
    });
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "GET",
      url: "/user-preferences",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as UserPreferences;
    expect(body).toEqual({
      userId: USER_ID,
      defaultLocation: null,
      defaultDuration: null,
      defaultEquipment: null,
    });
  });

  it("user isolation: findPreferencesByUserId is called only with the session userId", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    await app.inject({
      method: "GET",
      url: "/user-preferences",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(repo.findPreferencesByUserId).toHaveBeenCalledTimes(1);
    expect(repo.findPreferencesByUserId).toHaveBeenCalledWith(USER_ID);
  });
});

describe("PUT /user-preferences", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 401 without authentication", async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/user-preferences",
      payload: { defaultLocation: "home" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 422 when defaultDuration is zero", async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/user-preferences",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { defaultDuration: 0 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 when defaultDuration is negative", async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/user-preferences",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { defaultDuration: -10 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("partial merge: forwards only sent fields and returns 200", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "PUT",
      url: "/user-preferences",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { defaultLocation: "home" },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.upsertPreferences).toHaveBeenCalledWith(USER_ID, {
      defaultLocation: "home",
    });
  });

  it("accepts an empty defaultEquipment array", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "PUT",
      url: "/user-preferences",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { defaultEquipment: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.upsertPreferences).toHaveBeenCalledWith(USER_ID, {
      defaultEquipment: [],
    });
  });

  it("forwards multiple fields together", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "PUT",
      url: "/user-preferences",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        defaultLocation: "outdoor",
        defaultDuration: 45,
        defaultEquipment: ["kettlebell"],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.upsertPreferences).toHaveBeenCalledWith(USER_ID, {
      defaultLocation: "outdoor",
      defaultDuration: 45,
      defaultEquipment: ["kettlebell"],
    });
  });

  it("empty body is a no-op partial merge (upsert called with empty object)", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "PUT",
      url: "/user-preferences",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(repo.upsertPreferences).toHaveBeenCalledWith(USER_ID, {});
  });
});