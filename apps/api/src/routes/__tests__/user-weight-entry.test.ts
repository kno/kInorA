import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { userWeightEntryRoutes } from "../user-weight-entry.js";
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

function buildMockDb() {
  return createAuthMockDb({
    sessionRows: [SESSION_ROW],
    membershipRows: [ACTIVE_MEMBERSHIP_ROW],
  }).db;
}

const ENTRY_A = { id: "entry-1", weightKg: 72.5, recordedAt: "2026-08-01T00:00:00.000Z" };

// --- Route port mock ---

function buildRepo(
  overrides: Partial<{
    list: unknown;
    insert: unknown;
  }> = {},
) {
  return {
    list: vi.fn().mockResolvedValue([ENTRY_A]),
    insert: vi.fn().mockResolvedValue({ entry: ENTRY_A, wasFirstEntry: true }),
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
  await app.register(userWeightEntryRoutes, { repo: repo as never });
  return app;
}

// --- Tests ---

describe("GET /weight-entries", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 401 without authentication", async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/weight-entries" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the authenticated user's entries newest-first, capped at 100", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "GET",
      url: "/weight-entries",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entries: [ENTRY_A] });
    expect(repo.list).toHaveBeenCalledWith(USER_ID);
  });
});

describe("POST /weight-entries", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 401 without authentication", async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/weight-entries",
      payload: { weightKg: 72.5 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates the first entry and reports wasFirstEntry: true", async () => {
    const repo = buildRepo({
      insert: vi.fn().mockResolvedValue({ entry: ENTRY_A, wasFirstEntry: true }),
    });
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "POST",
      url: "/weight-entries",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { weightKg: 72.5 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ entry: ENTRY_A, wasFirstEntry: true });
    // userId comes ONLY from authContext, never the body.
    expect(repo.insert).toHaveBeenCalledWith(USER_ID, { weightKg: 72.5, recordedAt: undefined });
  });

  it("reports wasFirstEntry: false for a second entry", async () => {
    const repo = buildRepo({
      insert: vi.fn().mockResolvedValue({ entry: ENTRY_A, wasFirstEntry: false }),
    });
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "POST",
      url: "/weight-entries",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { weightKg: 80 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ wasFirstEntry: false });
  });

  it.each([0, -1, -0.01])("rejects weightKg = %s with 422 invalid_weight_kg", async (weightKg) => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "POST",
      url: "/weight-entries",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { weightKg },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_weight_kg" });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("rejects weightKg > 500 with 422 invalid_weight_kg", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "POST",
      url: "/weight-entries",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { weightKg: 501 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_weight_kg" });
  });

  it("rejects a non-numeric weightKg with 422 invalid_weight_kg", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "POST",
      url: "/weight-entries",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { weightKg: "not-a-number" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_weight_kg" });
  });

  it("rejects an unparseable recordedAt with 422 invalid_recorded_at", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);

    const res = await app.inject({
      method: "POST",
      url: "/weight-entries",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { weightKg: 72.5, recordedAt: "not-a-date" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_recorded_at" });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("rejects a recordedAt in the future with 422 invalid_recorded_at", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);
    const future = new Date(Date.now() + 60_000).toISOString();

    const res = await app.inject({
      method: "POST",
      url: "/weight-entries",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { weightKg: 72.5, recordedAt: future },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_recorded_at" });
  });

  it("accepts a valid recordedAt in the past", async () => {
    const repo = buildRepo();
    app = await buildTestApp(repo);
    const past = "2026-01-01T00:00:00.000Z";

    const res = await app.inject({
      method: "POST",
      url: "/weight-entries",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { weightKg: 72.5, recordedAt: past },
    });

    expect(res.statusCode).toBe(201);
    expect(repo.insert).toHaveBeenCalledWith(USER_ID, { weightKg: 72.5, recordedAt: past });
  });
});
