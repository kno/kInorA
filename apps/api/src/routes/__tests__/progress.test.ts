import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { DashboardSummaryDTO, ExerciseDetailDTO, StatsSummaryDTO, WeeklyOverviewDTO } from "@kinora/contracts";
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

const emptyWeeklyOverview: WeeklyOverviewDTO = {
  weekStart: "2026-07-13",
  weekLabel: "13–19 Jul",
  days: [
    { date: "2026-07-13", status: "rest" },
    { date: "2026-07-14", status: "rest" },
    { date: "2026-07-15", status: "rest" },
    { date: "2026-07-16", status: "active" },
    { date: "2026-07-17", status: "rest" },
    { date: "2026-07-18", status: "rest" },
    { date: "2026-07-19", status: "rest" },
  ],
  previousWeekStart: "2026-07-06",
  nextWeekStart: "2026-07-20",
};

const emptyExerciseDetail: ExerciseDetailDTO = { exerciseTitle: "Bench Press", recentSets: [] };

function buildRepoMock(
  overrides: Partial<{
    getDashboardSummary: unknown;
    getStatsRange: unknown;
    getWeeklyOverview: unknown;
    getExerciseDetail: unknown;
  }> = {}
) {
  return {
    getDashboardSummary: vi.fn().mockResolvedValue(emptySummary),
    getStatsRange: vi.fn().mockResolvedValue(emptyStatsSummary),
    getWeeklyOverview: vi.fn().mockResolvedValue(emptyWeeklyOverview),
    getExerciseDetail: vi.fn().mockResolvedValue(emptyExerciseDetail),
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

describe("GET /progress/weekly-overview", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 401 without authentication", async () => {
    app = await buildTestApp(buildRepoMock(), createCyclingAuthMockDb({ sessionRows: [], membershipRows: [] }));

    const response = await app.inject({ method: "GET", url: "/progress/weekly-overview" });

    expect(response.statusCode).toBe(401);
  });

  it("returns the weekly overview scoped to the authenticated tenant/user, defaulting to the current week", async () => {
    const repo = buildRepoMock();
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "GET",
      url: "/progress/weekly-overview",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(emptyWeeklyOverview);
    expect(repo.getWeeklyOverview).toHaveBeenCalledWith(TENANT_A, USER_A, expect.any(Date));
  });

  it("passes through a valid ?weekStart= query param", async () => {
    const repo = buildRepoMock();
    app = await buildTestApp(repo);

    await app.inject({
      method: "GET",
      url: "/progress/weekly-overview?weekStart=2026-07-06",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    const calledWith = (repo.getWeeklyOverview as ReturnType<typeof vi.fn>).mock.calls[0]![2] as Date;
    expect(calledWith.toISOString().slice(0, 10)).toBe("2026-07-06");
  });

  it("falls back to now for an invalid ?weekStart= value", async () => {
    const repo = buildRepoMock();
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "GET",
      url: "/progress/weekly-overview?weekStart=not-a-date",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(repo.getWeeklyOverview).toHaveBeenCalledWith(TENANT_A, USER_A, expect.any(Date));
  });
});

describe("GET /progress/exercise-detail", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 401 without authentication", async () => {
    app = await buildTestApp(buildRepoMock(), createCyclingAuthMockDb({ sessionRows: [], membershipRows: [] }));

    const response = await app.inject({ method: "GET", url: "/progress/exercise-detail?title=Bench+Press" });

    expect(response.statusCode).toBe(401);
  });

  it("returns 400 when ?title= is missing", async () => {
    const repo = buildRepoMock();
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "GET",
      url: "/progress/exercise-detail",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(400);
    expect(repo.getExerciseDetail).not.toHaveBeenCalled();
  });

  it("returns the exercise detail scoped to the authenticated tenant/user", async () => {
    const repo = buildRepoMock();
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "GET",
      url: "/progress/exercise-detail?title=Bench+Press",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(emptyExerciseDetail);
    expect(repo.getExerciseDetail).toHaveBeenCalledWith(TENANT_A, USER_A, "Bench Press");
  });
});
