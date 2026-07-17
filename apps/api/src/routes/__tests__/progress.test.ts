import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { DashboardSummaryDTO, StatsSummaryDTO } from "@kinora/contracts";
import { authPlugin } from "../../auth/plugin.js";
import { progressRoutes } from "../progress.js";
import {
  VALID_TOKEN,
  buildActiveMembershipRow,
  buildSessionRow,
  createCyclingAuthMockDb,
} from "../../test-support/auth-mocks.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";

const emptySummary: DashboardSummaryDTO = {
  streak: 0,
  recentDailyCompletion: [false, false, false, false, false, false, false],
  weeklyCompleted: 0,
  weeklyPlanned: 0,
  weeklyRollup: [],
};

const zeroKpi = { value: 0, deltaVsPreviousPeriod: null };
const emptyStatsSummary: StatsSummaryDTO = {
  range: "month",
  totalVolumeKg: zeroKpi,
  sessionCount: zeroKpi,
  totalDurationMin: zeroKpi,
  prCount: zeroKpi,
  volumeTrend: { current: [], previous: [] },
  muscleGroupDistribution: [],
  personalRecords: [],
};

function buildSessionDb() {
  return createCyclingAuthMockDb({
    sessionRows: [buildSessionRow({ tenantId: TENANT_A, userId: USER_A })],
    membershipRows: [buildActiveMembershipRow({ tenantId: TENANT_A, userId: USER_A })],
  });
}

function buildRepoMock(
  overrides: Partial<{ getDashboardSummary: unknown; getStatsRange: unknown }> = {}
) {
  return {
    getDashboardSummary: vi.fn().mockResolvedValue(emptySummary),
    getStatsRange: vi.fn().mockResolvedValue(emptyStatsSummary),
    ...overrides,
  };
}

async function buildTestApp(repo = buildRepoMock(), db = buildSessionDb()): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error.name === "AuthError") {
      return reply.code(401).send({ error: error.message });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  await app.register(authPlugin, { db });
  await app.register(progressRoutes, { repo: repo as never });
  return app;
}

describe("GET /progress/dashboard", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 401 without authentication", async () => {
    app = await buildTestApp(buildRepoMock(), createCyclingAuthMockDb({ sessionRows: [], membershipRows: [] }));

    const response = await app.inject({ method: "GET", url: "/progress/dashboard" });

    expect(response.statusCode).toBe(401);
  });

  it("returns the dashboard summary scoped to the authenticated tenant/user", async () => {
    const repo = buildRepoMock();
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "GET",
      url: "/progress/dashboard",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(emptySummary);
    expect(repo.getDashboardSummary).toHaveBeenCalledWith(TENANT_A, USER_A);
  });
});

describe("GET /progress/stats", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 401 without authentication", async () => {
    app = await buildTestApp(buildRepoMock(), createCyclingAuthMockDb({ sessionRows: [], membershipRows: [] }));

    const response = await app.inject({ method: "GET", url: "/progress/stats" });

    expect(response.statusCode).toBe(401);
  });

  it("returns the stats summary scoped to the authenticated tenant/user, defaulting to 'month'", async () => {
    const repo = buildRepoMock();
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "GET",
      url: "/progress/stats",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(emptyStatsSummary);
    expect(repo.getStatsRange).toHaveBeenCalledWith(TENANT_A, USER_A, "month");
  });

  it("passes through a valid ?range= query param", async () => {
    const repo = buildRepoMock();
    app = await buildTestApp(repo);

    await app.inject({
      method: "GET",
      url: "/progress/stats?range=week",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(repo.getStatsRange).toHaveBeenCalledWith(TENANT_A, USER_A, "week");
  });

  it("falls back to 'month' for an invalid ?range= value", async () => {
    const repo = buildRepoMock();
    app = await buildTestApp(repo);

    await app.inject({
      method: "GET",
      url: "/progress/stats?range=bogus",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(repo.getStatsRange).toHaveBeenCalledWith(TENANT_A, USER_A, "month");
  });
});
