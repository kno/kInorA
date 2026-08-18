import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { trainerRoutes } from "../trainer.js";
import { TrainerAssignmentConflictError } from "../../db/repositories/trainer-assignment.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

// --- Fixtures ---

const TRAINER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const MEMBER_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const CLIENT_ID = "aaaaaaaa-0000-0000-0000-000000000003";
const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";

function entitlementReader(tier: "free" | "pro" | "trainer" = "trainer") {
  return {
    loadContext: vi.fn().mockResolvedValue({
      membershipStatus: "active",
      billing: { tier, status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      activeOverrideTier: null,
    }),
  };
}

function activeAssignment() {
  return {
    id: "assignment-1",
    tenantId: TENANT_ID,
    trainerUserId: TRAINER_ID,
    clientUserId: CLIENT_ID,
    status: "active" as const,
  };
}

const emptyDashboard = {
  rpeTrend: [],
  completionRate: { periodDays: 28, planned: 0, completed: 0, percent: 0 },
  recentSessions: [],
};

function activeClientAssignment() {
  return {
    id: "client-assignment-1",
    tenantId: TENANT_ID,
    trainerUserId: TRAINER_ID,
    clientUserId: CLIENT_ID,
    status: "active" as const,
  };
}

const emptyStatsSummary = {
  range: "month" as const,
  totalVolumeKg: { value: 0, deltaVsPreviousPeriod: null },
  sessionCount: { value: 0, deltaVsPreviousPeriod: null },
  totalDurationMin: { value: 0, deltaVsPreviousPeriod: null },
  prCount: { value: 0, deltaVsPreviousPeriod: null },
  volumeTrend: { current: [], previous: [] },
  muscleGroupDistribution: [],
  personalRecords: [],
};

const emptyWeeklyOverview = {
  weekStart: "2026-07-13",
  weekLabel: "13–19 Jul",
  days: [
    { date: "2026-07-13", status: "rest" as const },
    { date: "2026-07-14", status: "rest" as const },
    { date: "2026-07-15", status: "rest" as const },
    { date: "2026-07-16", status: "rest" as const },
    { date: "2026-07-17", status: "rest" as const },
    { date: "2026-07-18", status: "rest" as const },
    { date: "2026-07-19", status: "rest" as const },
  ],
  previousWeekStart: "2026-07-06",
  nextWeekStart: "2026-07-20",
};

const emptyExerciseDetail = { exerciseTitle: "Bench Press", recentSets: [] };

function buildRepos(
  overrides: Partial<{
    assignmentRepo: Record<string, unknown>;
    membershipRepo: Record<string, unknown>;
    userRepo: Record<string, unknown>;
    entitlementReader: Record<string, unknown>;
    dashboardRepo: Record<string, unknown>;
    planRepo: Record<string, unknown>;
    specRepo: Record<string, unknown>;
    progressRepo: Record<string, unknown>;
    seatSync: Record<string, unknown>;
  }> = {},
) {
  return {
    assignmentRepo: {
      create: vi.fn().mockResolvedValue({
        id: "assignment-1",
        tenantId: TENANT_ID,
        trainerUserId: TRAINER_ID,
        clientUserId: CLIENT_ID,
        status: "invited",
      }),
      findByClientUserId: vi.fn().mockResolvedValue(undefined),
      updateStatus: vi.fn().mockResolvedValue(1),
      listByTrainer: vi.fn().mockResolvedValue([]),
      findActiveAssignment: vi.fn().mockResolvedValue(activeAssignment()),
      ...overrides.assignmentRepo,
    },
    membershipRepo: {
      upsertInvited: vi.fn().mockResolvedValue({
        id: "membership-1",
        tenantId: TENANT_ID,
        userId: CLIENT_ID,
        role: "member",
        status: "invited",
      }),
      updateStatusByTenantAndUser: vi.fn().mockResolvedValue(1),
      ...overrides.membershipRepo,
    },
    userRepo: {
      findByEmail: vi.fn().mockResolvedValue({ id: CLIENT_ID, email: "client@example.com" }),
      findById: vi.fn().mockResolvedValue({ id: CLIENT_ID, email: "client@example.com" }),
      ...overrides.userRepo,
    },
    entitlementReader: overrides.entitlementReader ?? entitlementReader("trainer"),
    dashboardRepo: {
      getClientDashboard: vi.fn().mockResolvedValue(emptyDashboard),
      ...overrides.dashboardRepo,
    },
    planRepo: {
      findLatestReadyByOwner: vi.fn().mockResolvedValue(undefined),
      ...overrides.planRepo,
    },
    specRepo: {
      findConfirmedById: vi.fn().mockResolvedValue(undefined),
      ...overrides.specRepo,
    },
    progressRepo: {
      getStatsRange: vi.fn().mockResolvedValue(emptyStatsSummary),
      getWeeklyOverview: vi.fn().mockResolvedValue(emptyWeeklyOverview),
      getExerciseDetail: vi.fn().mockResolvedValue(emptyExerciseDetail),
      ...overrides.progressRepo,
    },
    seatSync: {
      syncSeats: vi.fn().mockResolvedValue(undefined),
      ...overrides.seatSync,
    },
  };
}

async function buildTestApp(
  repos: ReturnType<typeof buildRepos>,
  sessionRole: "owner" | "member" | "trainer" = "trainer",
  userId = TRAINER_ID,
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

  const db = createAuthMockDb({
    sessionRows: [buildSessionRow({ tenantId: TENANT_ID, userId })],
    membershipRows: [buildActiveMembershipRow({ tenantId: TENANT_ID, userId, role: sessionRole })],
  }).db;

  await app.register(authPlugin, { db });
  await app.register(trainerRoutes, repos as never);
  return app;
}

// --- Tests ---

describe("POST /trainer/clients/invite", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("denies a non-trainer role with 403 (task 3.1)", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "member", MEMBER_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/invite",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { email: "client@example.com" },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.assignmentRepo.create).not.toHaveBeenCalled();
  });

  it("denies a trainer-role actor without the trainer entitlement with 403 (task 3.1)", async () => {
    const repos = buildRepos({ entitlementReader: entitlementReader("pro") });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/invite",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { email: "client@example.com" },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.assignmentRepo.create).not.toHaveBeenCalled();
  });

  it("creates a membership (invited) + assignment (invited) row for a valid entitled trainer (task 3.2)", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/invite",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { email: "client@example.com" },
    });

    expect(res.statusCode).toBe(201);
    expect(repos.membershipRepo.upsertInvited).toHaveBeenCalledWith(
      TENANT_ID,
      CLIENT_ID,
      "member",
    );
    expect(repos.assignmentRepo.create).toHaveBeenCalledWith(
      TENANT_ID,
      TRAINER_ID,
      CLIENT_ID,
      "invited",
    );
  });

  it("returns 404 when the invited email has no user account", async () => {
    const repos = buildRepos({ userRepo: { findByEmail: vi.fn().mockResolvedValue(null) } });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/invite",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { email: "nobody@example.com" },
    });

    expect(res.statusCode).toBe(404);
    expect(repos.assignmentRepo.create).not.toHaveBeenCalled();
  });

  it("returns 409 when the client already has a non-revoked assignment with another trainer (task 3.4)", async () => {
    const repos = buildRepos({
      assignmentRepo: {
        findByClientUserId: vi.fn().mockResolvedValue({
          id: "existing-assignment",
          tenantId: "other-tenant",
          trainerUserId: "other-trainer",
          clientUserId: CLIENT_ID,
          status: "active",
        }),
        create: vi.fn(),
      },
    });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/invite",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { email: "client@example.com" },
    });

    expect(res.statusCode).toBe(409);
    expect(repos.assignmentRepo.create).not.toHaveBeenCalled();
  });

  it("surfaces a race-condition unique violation from the repo as 409 (task 3.4, defence-in-depth)", async () => {
    const repos = buildRepos({
      assignmentRepo: {
        findByClientUserId: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockRejectedValue(new TrainerAssignmentConflictError()),
      },
    });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/invite",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { email: "client@example.com" },
    });

    expect(res.statusCode).toBe(409);
  });
});

describe("POST /trainer/clients/accept", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("transitions membership + assignment invited -> active (task 3.3)", async () => {
    const repos = buildRepos({
      assignmentRepo: {
        findByClientUserId: vi.fn().mockResolvedValue({
          id: "assignment-1",
          tenantId: TENANT_ID,
          trainerUserId: TRAINER_ID,
          clientUserId: CLIENT_ID,
          status: "invited",
        }),
        updateStatus: vi.fn().mockResolvedValue(1),
      },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/accept",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(repos.assignmentRepo.updateStatus).toHaveBeenCalledWith(TENANT_ID, "assignment-1", "active");
    expect(repos.membershipRepo.updateStatusByTenantAndUser).toHaveBeenCalledWith(
      TENANT_ID,
      CLIENT_ID,
      "active",
    );
  });

  it("returns 404 when the caller has no pending invite", async () => {
    const repos = buildRepos({
      assignmentRepo: { findByClientUserId: vi.fn().mockResolvedValue(undefined) },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/accept",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /trainer/clients/:clientUserId/dashboard", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("1.8 denies a trainer with no active assignment to the client with 403, no repo call (task 1.8)", async () => {
    const repos = buildRepos({ assignmentRepo: { findActiveAssignment: vi.fn().mockResolvedValue(undefined) } });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/dashboard`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.dashboardRepo.getClientDashboard).not.toHaveBeenCalled();
  });

  it("1.8 denies a trainer-role actor without the trainer entitlement with 403, no repo call (task 1.8)", async () => {
    const repos = buildRepos({ entitlementReader: entitlementReader("pro") });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/dashboard`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.dashboardRepo.getClientDashboard).not.toHaveBeenCalled();
  });

  it("1.9 returns the ClientDashboardDTO for a trainer with an active assignment to the client", async () => {
    const dashboard = {
      rpeTrend: [{ weekStart: "2026-07-13T00:00:00.000Z", meanRpe: 8, sessionsWithRpe: 2 }],
      completionRate: { periodDays: 28, planned: 12, completed: 6, percent: 50 },
      recentSessions: [{ date: "2026-07-15T09:00:00.000Z", volumeKg: 1000, meanRpe: 8.5 }],
    };
    const repos = buildRepos({ dashboardRepo: { getClientDashboard: vi.fn().mockResolvedValue(dashboard) } });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/dashboard`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(dashboard);
    expect(repos.dashboardRepo.getClientDashboard).toHaveBeenCalledWith(TENANT_ID, CLIENT_ID);
  });
});

describe("GET /trainer/clients/:clientUserId/progress/stats (GH #447)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("denies a non-trainer role with 403, no repo call", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "member", MEMBER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/stats`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getStatsRange).not.toHaveBeenCalled();
  });

  it("denies a trainer-role actor without the trainer entitlement with 403, no repo call", async () => {
    const repos = buildRepos({ entitlementReader: entitlementReader("pro") });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/stats`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getStatsRange).not.toHaveBeenCalled();
  });

  it("denies a trainer with no active assignment to the client with 403, no repo call", async () => {
    const repos = buildRepos({ assignmentRepo: { findActiveAssignment: vi.fn().mockResolvedValue(undefined) } });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/stats`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getStatsRange).not.toHaveBeenCalled();
  });

  it("denies with 403 when the assignment is revoked (findActiveAssignment collapses revoked and missing)", async () => {
    // Documents the requirement: a REVOKED row is a real row in
    // `trainer_client_assignments`, but `findActiveAssignment` only ever
    // matches `status = "active"` (see owner-access.ts doc comment), so a
    // revoked assignment resolves to `undefined` here — identical to no
    // assignment at all, and denies identically.
    // A revoked row would look like `{ ...activeAssignment(), status: "revoked" }`
    // in `trainer_client_assignments`, but the repository's query filters
    // `WHERE status = 'active'`, so it resolves to `undefined` here too.
    const repos = buildRepos({ assignmentRepo: { findActiveAssignment: vi.fn().mockResolvedValue(undefined) } });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/stats`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getStatsRange).not.toHaveBeenCalled();
  });

  it("returns the StatsSummaryDTO for the CLIENT's userId, not the actor's", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/stats?range=week`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(emptyStatsSummary);
    expect(repos.progressRepo.getStatsRange).toHaveBeenCalledWith(TENANT_ID, CLIENT_ID, "week");
  });
});

describe("GET /trainer/clients/:clientUserId/progress/exercise-detail (GH #447)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("denies a non-trainer role with 403, no repo call", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "member", MEMBER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/exercise-detail?title=Bench+Press`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getExerciseDetail).not.toHaveBeenCalled();
  });

  it("denies a trainer-role actor without the trainer entitlement with 403, no repo call", async () => {
    const repos = buildRepos({ entitlementReader: entitlementReader("pro") });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/exercise-detail?title=Bench+Press`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getExerciseDetail).not.toHaveBeenCalled();
  });

  it("denies a trainer with no active assignment to the client with 403, no repo call", async () => {
    const repos = buildRepos({ assignmentRepo: { findActiveAssignment: vi.fn().mockResolvedValue(undefined) } });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/exercise-detail?title=Bench+Press`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getExerciseDetail).not.toHaveBeenCalled();
  });

  it("denies with 403 when the assignment is revoked (findActiveAssignment collapses revoked and missing)", async () => {
    // A revoked row would look like `{ ...activeAssignment(), status: "revoked" }`
    // in `trainer_client_assignments`, but the repository's query filters
    // `WHERE status = 'active'`, so it resolves to `undefined` here too.
    const repos = buildRepos({ assignmentRepo: { findActiveAssignment: vi.fn().mockResolvedValue(undefined) } });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/exercise-detail?title=Bench+Press`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getExerciseDetail).not.toHaveBeenCalled();
  });

  it("returns 400 when ?title= is missing, even for an authorized trainer", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/exercise-detail`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(400);
    expect(repos.progressRepo.getExerciseDetail).not.toHaveBeenCalled();
  });

  it("returns the ExerciseDetailDTO for the CLIENT's userId, not the actor's", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/exercise-detail?title=Bench+Press`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(emptyExerciseDetail);
    expect(repos.progressRepo.getExerciseDetail).toHaveBeenCalledWith(TENANT_ID, CLIENT_ID, "Bench Press");
  });
});

describe("GET /trainer/clients/:clientUserId/progress/weekly-overview (GH #447)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("denies a non-trainer role with 403, no repo call", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "member", MEMBER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/weekly-overview`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getWeeklyOverview).not.toHaveBeenCalled();
  });

  it("denies a trainer-role actor without the trainer entitlement with 403, no repo call", async () => {
    const repos = buildRepos({ entitlementReader: entitlementReader("pro") });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/weekly-overview`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getWeeklyOverview).not.toHaveBeenCalled();
  });

  it("denies a trainer with no active assignment to the client with 403, no repo call", async () => {
    const repos = buildRepos({ assignmentRepo: { findActiveAssignment: vi.fn().mockResolvedValue(undefined) } });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/weekly-overview`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getWeeklyOverview).not.toHaveBeenCalled();
  });

  it("denies with 403 when the assignment is revoked (findActiveAssignment collapses revoked and missing)", async () => {
    // A revoked row would look like `{ ...activeAssignment(), status: "revoked" }`
    // in `trainer_client_assignments`, but the repository's query filters
    // `WHERE status = 'active'`, so it resolves to `undefined` here too.
    const repos = buildRepos({ assignmentRepo: { findActiveAssignment: vi.fn().mockResolvedValue(undefined) } });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/weekly-overview`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.progressRepo.getWeeklyOverview).not.toHaveBeenCalled();
  });

  it("returns the WeeklyOverviewDTO for the CLIENT's userId, not the actor's", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${CLIENT_ID}/progress/weekly-overview?weekStart=2026-07-06`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(emptyWeeklyOverview);
    const calledWith = (repos.progressRepo.getWeeklyOverview as ReturnType<typeof vi.fn>).mock.calls[0]![2] as Date;
    expect(calledWith.toISOString().slice(0, 10)).toBe("2026-07-06");
    expect(repos.progressRepo.getWeeklyOverview).toHaveBeenCalledWith(TENANT_ID, CLIENT_ID, expect.any(Date));
  });
});

describe("GET /me/trainer-plan (15b-v2 Phase S2 — #283)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  const readyPlan = {
    id: "plan-1",
    tenantId: TENANT_ID,
    userId: CLIENT_ID,
    planSpecId: "spec-1",
    status: "ready" as const,
    name: "Summer Cut",
    programJson: { weeklySessions: [], limitationWarnings: [] },
    errorMessage: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
  };

  it("2.1 revoked assignment denies with a flat 403, no plan repo call", async () => {
    const repos = buildRepos({
      assignmentRepo: {
        findByClientUserId: vi.fn().mockResolvedValue({ ...activeClientAssignment(), status: "revoked" }),
      },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "GET",
      url: "/me/trainer-plan",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.planRepo.findLatestReadyByOwner).not.toHaveBeenCalled();
  });

  it("2.1 no assignment row at all denies with a flat 403, no plan repo call", async () => {
    const repos = buildRepos({
      assignmentRepo: { findByClientUserId: vi.fn().mockResolvedValue(undefined) },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "GET",
      url: "/me/trainer-plan",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.planRepo.findLatestReadyByOwner).not.toHaveBeenCalled();
  });

  it("2.2 the plan read is always filtered by the caller's own userId, never a different client's id", async () => {
    const repos = buildRepos({
      assignmentRepo: { findByClientUserId: vi.fn().mockResolvedValue(activeClientAssignment()) },
      planRepo: { findLatestReadyByOwner: vi.fn().mockResolvedValue(readyPlan) },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "GET",
      url: "/me/trainer-plan",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(repos.planRepo.findLatestReadyByOwner).toHaveBeenCalledWith(TENANT_ID, CLIENT_ID);
  });

  it("2.3 a client assigned only to trainer T can never have their read resolve trainer U's tenant", async () => {
    const OTHER_TENANT = "other-tenant-u";
    const repos = buildRepos({
      assignmentRepo: {
        findByClientUserId: vi.fn().mockResolvedValue({
          ...activeClientAssignment(),
          tenantId: OTHER_TENANT,
        }),
      },
      planRepo: { findLatestReadyByOwner: vi.fn().mockResolvedValue(readyPlan) },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "GET",
      url: "/me/trainer-plan",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(repos.planRepo.findLatestReadyByOwner).toHaveBeenCalledWith(OTHER_TENANT, CLIENT_ID);
    expect(repos.planRepo.findLatestReadyByOwner).not.toHaveBeenCalledWith(TENANT_ID, CLIENT_ID);
  });

  it("2.4 an ordinary member with no trainer/client relationship at all is denied with 403", async () => {
    const repos = buildRepos({
      assignmentRepo: { findByClientUserId: vi.fn().mockResolvedValue(undefined) },
    });
    app = await buildTestApp(repos, "member", MEMBER_ID);

    const res = await app.inject({
      method: "GET",
      url: "/me/trainer-plan",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("2.6 happy path: client reads their own ready plan in the trainer's tenant", async () => {
    const repos = buildRepos({
      assignmentRepo: { findByClientUserId: vi.fn().mockResolvedValue(activeClientAssignment()) },
      planRepo: { findLatestReadyByOwner: vi.fn().mockResolvedValue(readyPlan) },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "GET",
      url: "/me/trainer-plan",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: "plan-1",
      status: "ready",
      program: readyPlan.programJson,
      specId: "spec-1",
      name: "Summer Cut",
    });
  });

  it("returns 404 when the client has an active assignment but no ready plan exists yet", async () => {
    const repos = buildRepos({
      assignmentRepo: { findByClientUserId: vi.fn().mockResolvedValue(activeClientAssignment()) },
      planRepo: { findLatestReadyByOwner: vi.fn().mockResolvedValue(undefined) },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "GET",
      url: "/me/trainer-plan",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(404);
  });

  // 15b-v2 Phase S5: the client-facing branded-plan view consumes this route,
  // so the response DTO must carry `branding` when the trainer set it on the
  // confirmed `PlanSpec` — without ever widening the S2 authorization.
  it("5.1/5.2 includes branding on the response when the confirmed spec carries it", async () => {
    const repos = buildRepos({
      assignmentRepo: { findByClientUserId: vi.fn().mockResolvedValue(activeClientAssignment()) },
      planRepo: { findLatestReadyByOwner: vi.fn().mockResolvedValue(readyPlan) },
      specRepo: {
        findConfirmedById: vi.fn().mockResolvedValue({
          specJson: { branding: { trainerName: "Coach Ana", title: "Ana's Cut", accentColor: "#1E90FF" } },
        }),
      },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "GET",
      url: "/me/trainer-plan",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: "plan-1",
      status: "ready",
      program: readyPlan.programJson,
      specId: "spec-1",
      name: "Summer Cut",
      branding: { trainerName: "Coach Ana", title: "Ana's Cut", accentColor: "#1E90FF" },
    });
    // The spec lookup is scoped by the SAME resolved trainerTenantId + the
    // caller's own userId — never widened beyond the S2 authorization.
    expect(repos.specRepo.findConfirmedById).toHaveBeenCalledWith(TENANT_ID, CLIENT_ID, "spec-1");
  });

  it("5.1/5.2 omits branding when the confirmed spec has none (base plan, unchanged shape)", async () => {
    const repos = buildRepos({
      assignmentRepo: { findByClientUserId: vi.fn().mockResolvedValue(activeClientAssignment()) },
      planRepo: { findLatestReadyByOwner: vi.fn().mockResolvedValue(readyPlan) },
      specRepo: {
        findConfirmedById: vi.fn().mockResolvedValue({ specJson: {} }),
      },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "GET",
      url: "/me/trainer-plan",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.branding).toBeUndefined();
  });
});

describe("GET /trainer/clients", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("denies a non-trainer role with 403", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "member", MEMBER_ID);

    const res = await app.inject({
      method: "GET",
      url: "/trainer/clients",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repos.assignmentRepo.listByTrainer).not.toHaveBeenCalled();
  });

  it("returns only the caller trainer's own clients as ClientSummaryDTO[] (task 3.5)", async () => {
    const repos = buildRepos({
      assignmentRepo: {
        listByTrainer: vi.fn().mockResolvedValue([
          { id: "a1", tenantId: TENANT_ID, trainerUserId: TRAINER_ID, clientUserId: CLIENT_ID, status: "active" },
        ]),
      },
      userRepo: {
        findById: vi.fn().mockResolvedValue({ id: CLIENT_ID, email: "client@example.com" }),
      },
    });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "GET",
      url: "/trainer/clients",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { clientUserId: CLIENT_ID, email: "client@example.com", status: "active" },
    ]);
    expect(repos.assignmentRepo.listByTrainer).toHaveBeenCalledWith(TENANT_ID, TRAINER_ID);
  });
});

// 16c-v3-b2b-seat-billing Slice C: seat-sync fires on the assignment
// transitions that change the ACTIVE set (accept → active, revoke → revoked),
// NEVER on invite/create (which yields `invited`, an uncounted seat — design
// Q3 / Judgment Day fix).
describe("seat-sync trigger (16c Slice C)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("accept fires syncSeats for the trainer's tenant (invited → active)", async () => {
    const repos = buildRepos({
      assignmentRepo: {
        findByClientUserId: vi.fn().mockResolvedValue({
          id: "assignment-1",
          tenantId: TENANT_ID,
          trainerUserId: TRAINER_ID,
          clientUserId: CLIENT_ID,
          status: "invited",
        }),
        updateStatus: vi.fn().mockResolvedValue(1),
      },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/accept",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(repos.seatSync.syncSeats).toHaveBeenCalledWith(TENANT_ID);
  });

  it("invite/create does NOT fire syncSeats (the new assignment is `invited`, uncounted)", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/invite",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { email: "client@example.com" },
    });

    expect(res.statusCode).toBe(201);
    expect(repos.seatSync.syncSeats).not.toHaveBeenCalled();
  });

  it("revoke fires syncSeats for the trainer's tenant (active → revoked)", async () => {
    const repos = buildRepos();
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "POST",
      url: `/trainer/clients/${CLIENT_ID}/revoke`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(repos.assignmentRepo.updateStatus).toHaveBeenCalledWith(TENANT_ID, "assignment-1", "revoked");
    expect(repos.seatSync.syncSeats).toHaveBeenCalledWith(TENANT_ID);
  });

  it("revoke returns 404 when the trainer has no active assignment to the client (no sync)", async () => {
    const repos = buildRepos({
      assignmentRepo: { findActiveAssignment: vi.fn().mockResolvedValue(undefined) },
    });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "POST",
      url: `/trainer/clients/${CLIENT_ID}/revoke`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(404);
    expect(repos.seatSync.syncSeats).not.toHaveBeenCalled();
  });

  it("a seat-sync failure is non-fatal — accept still succeeds", async () => {
    const repos = buildRepos({
      assignmentRepo: {
        findByClientUserId: vi.fn().mockResolvedValue({
          id: "assignment-1",
          tenantId: TENANT_ID,
          trainerUserId: TRAINER_ID,
          clientUserId: CLIENT_ID,
          status: "invited",
        }),
      },
      seatSync: { syncSeats: vi.fn().mockRejectedValue(new Error("lock timeout")) },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/accept",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(repos.seatSync.syncSeats).toHaveBeenCalledWith(TENANT_ID);
  });

  it("accept replies WITHOUT awaiting seat-sync — a never-resolving syncSeats does not block the response (Judgment Day fix)", async () => {
    let seatSyncResolved = false;
    const syncSeats = vi.fn(
      () =>
        new Promise<void>(() => {
          // Deliberately never resolves — proves the route does not await it.
        }).then(() => {
          seatSyncResolved = true;
        }),
    );
    const repos = buildRepos({
      assignmentRepo: {
        findByClientUserId: vi.fn().mockResolvedValue({
          id: "assignment-1",
          tenantId: TENANT_ID,
          trainerUserId: TRAINER_ID,
          clientUserId: CLIENT_ID,
          status: "invited",
        }),
      },
      seatSync: { syncSeats },
    });
    app = await buildTestApp(repos, "member", CLIENT_ID);

    const res = await app.inject({
      method: "POST",
      url: "/trainer/clients/accept",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    // If the route awaited `syncSeats`, this `inject` call would hang forever
    // (the promise never resolves) and the test would time out. It doesn't:
    // the response returns immediately, before the sync promise ever settles.
    expect(res.statusCode).toBe(200);
    expect(syncSeats).toHaveBeenCalledWith(TENANT_ID);
    expect(seatSyncResolved).toBe(false);
  });

  it("revoke replies WITHOUT awaiting seat-sync — a rejecting syncSeats does not fail the request or crash", async () => {
    const syncSeats = vi.fn().mockRejectedValue(new Error("stripe timeout"));
    const repos = buildRepos({ seatSync: { syncSeats } });
    app = await buildTestApp(repos, "trainer", TRAINER_ID);

    const res = await app.inject({
      method: "POST",
      url: `/trainer/clients/${CLIENT_ID}/revoke`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(syncSeats).toHaveBeenCalledWith(TENANT_ID);
    // Let the rejected floating promise's microtask settle within this test
    // so a missing `.catch` would surface here (as an unhandled rejection)
    // rather than leaking into a later test.
    await new Promise((r) => setTimeout(r, 0));
  });
});
