import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes, type PlanRouteRepo } from "../plan.js";
import type { Database } from "../../db/client.js";
import {
  VALID_TOKEN,
  SESSION_HASH,
  createCyclingAuthMockDb,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const PLAN_ID = "cccccccc-0000-0000-0000-000000000001";

// Cycling (not one-shot) so a test can inject more than one request against
// the same app — several tests below assert idempotency across two calls.
function buildSessionDb(): Database {
  const sessionRows = [
    {
      tokenHash: SESSION_HASH,
      userId: USER_A,
      tenantId: TENANT_A,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  ];
  return createCyclingAuthMockDb({
    sessionRows,
    membershipRows: [buildActiveMembershipRow({ tenantId: TENANT_A, userId: USER_A })],
  });
}

function buildUnauthDb(): Database {
  return createCyclingAuthMockDb({ sessionRows: [] });
}

type PlanRepoMock = { [K in keyof PlanRouteRepo]?: ReturnType<typeof vi.fn> };

function buildPlanRepo(overrides: PlanRepoMock = {}): PlanRepoMock {
  return {
    findPlanById: vi.fn().mockResolvedValue(undefined),
    findLatestPlanBySpec: vi.fn().mockResolvedValue(undefined),
    findAllPlansByUser: vi.fn().mockResolvedValue([]),
    archivePlan: vi.fn().mockResolvedValue({ id: PLAN_ID, archivedAt: new Date("2026-08-09T10:00:00.000Z") }),
    unarchivePlan: vi.fn().mockResolvedValue({ id: PLAN_ID, archivedAt: null }),
    ...overrides,
  };
}

const noopGenerationService = {
  startGeneration: () => Promise.reject(new Error("unexpected call in archive tests")),
};

async function buildTestApp(
  db: Database,
  repo: PlanRepoMock = buildPlanRepo()
): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error.name === "AuthError") {
      return reply.code(401).send({ error: error.message });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  await app.register(authPlugin, { db });
  await app.register(planRoutes, {
    repo: repo as unknown as PlanRouteRepo,
    generationService: noopGenerationService,
  });

  return app;
}

describe("Archive/unarchive plan routes (17d PR B)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("POST /workout-plans/:id/archive returns 200 { id, archivedAt }", async () => {
    const repo = buildPlanRepo();
    app = await buildTestApp(buildSessionDb(), repo);

    const response = await app.inject({
      method: "POST",
      url: `/workout-plans/${PLAN_ID}/archive`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: PLAN_ID, archivedAt: "2026-08-09T10:00:00.000Z" });
    expect(repo.archivePlan).toHaveBeenCalledWith(TENANT_A, USER_A, PLAN_ID);
  });

  it("a repeat archive call returns the SAME unchanged archivedAt (idempotent)", async () => {
    const repo = buildPlanRepo({
      archivePlan: vi.fn().mockResolvedValue({ id: PLAN_ID, archivedAt: new Date("2026-08-01T00:00:00.000Z") }),
    });
    app = await buildTestApp(buildSessionDb(), repo);

    const first = await app.inject({
      method: "POST",
      url: `/workout-plans/${PLAN_ID}/archive`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    const second = await app.inject({
      method: "POST",
      url: `/workout-plans/${PLAN_ID}/archive`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(first.json().archivedAt).toBe(second.json().archivedAt);
  });

  it("POST /workout-plans/:id/archive returns 404 for another user's/tenant's plan", async () => {
    const repo = buildPlanRepo({ archivePlan: vi.fn().mockResolvedValue(undefined) });
    app = await buildTestApp(buildSessionDb(), repo);

    const response = await app.inject({
      method: "POST",
      url: `/workout-plans/${PLAN_ID}/archive`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
  });

  it("POST /workout-plans/:id/archive returns 401 unauthenticated", async () => {
    app = await buildTestApp(buildUnauthDb());

    const response = await app.inject({
      method: "POST",
      url: `/workout-plans/${PLAN_ID}/archive`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("POST /workout-plans/:id/unarchive returns 200 { id, archivedAt: null }", async () => {
    const repo = buildPlanRepo();
    app = await buildTestApp(buildSessionDb(), repo);

    const response = await app.inject({
      method: "POST",
      url: `/workout-plans/${PLAN_ID}/unarchive`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: PLAN_ID, archivedAt: null });
    expect(repo.unarchivePlan).toHaveBeenCalledWith(TENANT_A, USER_A, PLAN_ID);
  });

  it("a repeat unarchive call stays idempotent (still null)", async () => {
    const repo = buildPlanRepo();
    app = await buildTestApp(buildSessionDb(), repo);

    const first = await app.inject({
      method: "POST",
      url: `/workout-plans/${PLAN_ID}/unarchive`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    const second = await app.inject({
      method: "POST",
      url: `/workout-plans/${PLAN_ID}/unarchive`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(first.json().archivedAt).toBeNull();
    expect(second.json().archivedAt).toBeNull();
  });

  it("POST /workout-plans/:id/unarchive returns 404 for another user's/tenant's plan", async () => {
    const repo = buildPlanRepo({ unarchivePlan: vi.fn().mockResolvedValue(undefined) });
    app = await buildTestApp(buildSessionDb(), repo);

    const response = await app.inject({
      method: "POST",
      url: `/workout-plans/${PLAN_ID}/unarchive`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
  });

  it("POST /workout-plans/:id/unarchive returns 401 unauthenticated", async () => {
    app = await buildTestApp(buildUnauthDb());

    const response = await app.inject({
      method: "POST",
      url: `/workout-plans/${PLAN_ID}/unarchive`,
    });

    expect(response.statusCode).toBe(401);
  });
});
