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

function buildRepos(
  overrides: Partial<{
    assignmentRepo: Record<string, unknown>;
    membershipRepo: Record<string, unknown>;
    userRepo: Record<string, unknown>;
    entitlementReader: Record<string, unknown>;
    dashboardRepo: Record<string, unknown>;
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
