import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { UserProfile } from "@kinora/contracts";
import { authPlugin } from "../../auth/plugin.js";
import { userProfileRoutes } from "../user-profile.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

// --- Fixtures ---

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const USER_EMAIL = "alice@example.com";

const SESSION_ROW = buildSessionRow({
  tokenHash: "hash-of-token",
  tenantId: TENANT_ID,
  userId: USER_ID,
});
const ACTIVE_MEMBERSHIP_ROW = buildActiveMembershipRow({
  tenantId: TENANT_ID,
  userId: USER_ID,
});

const EXISTING_PROFILE = {
  userId: USER_ID,
  name: "Alice",
  goal: "strength" as const,
  experienceLevel: "intermediate" as const,
};

// --- Mock DB (auth plugin only: session + membership selects) ---

function buildMockDb() {
  return createAuthMockDb({
    sessionRows: [SESSION_ROW],
    membershipRows: [ACTIVE_MEMBERSHIP_ROW],
  }).db;
}

// --- Route port mock ---

function buildRepo(overrides: Partial<{
  findUserEmailById: unknown;
  findProfileByUserId: unknown;
  upsertProfile: unknown;
}> = {}) {
  return {
    findUserEmailById: vi.fn().mockResolvedValue(USER_EMAIL),
    findProfileByUserId: vi.fn().mockResolvedValue(EXISTING_PROFILE),
    upsertProfile: vi
      .fn()
      .mockImplementation(
        async (
          _userId: string,
          input: { name: string; goal: null; experienceLevel: null }
        ) => ({
          userId: USER_ID,
          name: input.name,
          goal: input.goal,
          experienceLevel: input.experienceLevel,
        })
      ),
    ...overrides,
  };
}

async function buildTestApp(
  repo = buildRepo()
): Promise<FastifyInstance> {
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
  await app.register(userProfileRoutes, { repo: repo as never });
  return app;
}

// --- Tests ---

describe("GET /user-profile", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 401 without authentication", async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/user-profile" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the existing profile scoped to the authenticated user", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "GET",
      url: "/user-profile",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as UserProfile;
    expect(body).toEqual({
      userId: USER_ID,
      name: "Alice",
      goal: "strength",
      experienceLevel: "intermediate",
    });
    expect(repo.findProfileByUserId).toHaveBeenCalledWith(USER_ID);
    expect(repo.upsertProfile).not.toHaveBeenCalled();
  });

  it("lazy-provisions a default row with name = email prefix when none exists", async () => {
    const repo = buildRepo({
      findProfileByUserId: vi.fn().mockResolvedValue(null),
    });
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "GET",
      url: "/user-profile",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as UserProfile;
    expect(body.name).toBe("alice");
    expect(body.goal).toBeNull();
    expect(body.experienceLevel).toBeNull();
    expect(repo.findProfileByUserId).toHaveBeenCalledWith(USER_ID);
    expect(repo.findUserEmailById).toHaveBeenCalledWith(USER_ID);
    expect(repo.upsertProfile).toHaveBeenCalledWith(USER_ID, {
      name: "alice",
      goal: null,
      experienceLevel: null,
    });
  });

  it("user isolation: findProfileByUserId is called only with the session userId, never client input", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    await app.inject({
      method: "GET",
      url: "/user-profile",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(repo.findProfileByUserId).toHaveBeenCalledTimes(1);
    expect(repo.findProfileByUserId).toHaveBeenCalledWith(USER_ID);
  });
});

describe("PUT /user-profile", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 401 without authentication", async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/user-profile",
      payload: { name: "Alice" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 422 when name is blank", async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/user-profile",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { name: "   " },
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 when goal is not a valid enum value", async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/user-profile",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { name: "Alice", goal: "powerlifting" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 when experienceLevel is not a valid enum value", async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/user-profile",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { name: "Alice", experienceLevel: "expert" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("upserts the full state and returns 200 with the updated profile", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "PUT",
      url: "/user-profile",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { name: "Alice Smith", goal: "hypertrophy" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as UserProfile;
    expect(body.name).toBe("Alice Smith");
    expect(body.goal).toBe("hypertrophy");
    expect(repo.upsertProfile).toHaveBeenCalledWith(USER_ID, {
      name: "Alice Smith",
      goal: "hypertrophy",
      experienceLevel: "intermediate", // preserved from existing row
    });
  });

  it("partial merge: omitted goal/experienceLevel preserve the stored values", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "PUT",
      url: "/user-profile",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { name: "Alice Renamed" },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.upsertProfile).toHaveBeenCalledWith(USER_ID, {
      name: "Alice Renamed",
      goal: "strength", // preserved
      experienceLevel: "intermediate", // preserved
    });
  });

  it("partial merge: when no existing row, omitted goal/experienceLevel default to null", async () => {
    const repo = buildRepo({
      findProfileByUserId: vi.fn().mockResolvedValue(null),
    });
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "PUT",
      url: "/user-profile",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { name: "New User" },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.upsertProfile).toHaveBeenCalledWith(USER_ID, {
      name: "New User",
      goal: null,
      experienceLevel: null,
    });
  });

  it("explicit goal: null is accepted and written", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "PUT",
      url: "/user-profile",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { name: "Alice", goal: null, experienceLevel: null },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.upsertProfile).toHaveBeenCalledWith(USER_ID, {
      name: "Alice",
      goal: null,
      experienceLevel: null,
    });
  });
});