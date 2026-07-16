import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { workoutSessionRoutes } from "../workout-session.js";
import { WorkoutSessionRepository } from "../../db/repositories/workout-session.js";
import { workoutPlans, workoutSessions } from "../../db/schema.js";
import type { Database } from "../../db/client.js";
import type { WorkoutHistoryEntry, WorkoutSessionRecord } from "@kinora/contracts";
import {
  VALID_TOKEN,
  buildActiveMembershipRow,
  buildSessionRow,
  createCyclingAuthMockDb,
} from "../../test-support/auth-mocks.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const PLAN_ID = "cccccccc-0000-0000-0000-000000000001";
const SESSION_ID = "dddddddd-0000-0000-0000-000000000001";
const SET_ID = "ffffffff-0000-0000-0000-000000000001";

const activeSession: WorkoutSessionRecord = {
  id: SESSION_ID,
  workoutPlanId: PLAN_ID,
  status: "active",
  startedAt: "2026-07-04T08:30:00.000Z",
  exercises: [
    {
      id: "exercise-1",
      workoutSessionId: SESSION_ID,
      exerciseIndex: 0,
      title: "Bench Press",
      restSeconds: 90,
      setRecords: [
        {
          id: SET_ID,
          sessionExerciseId: "exercise-1",
          setIndex: 0,
          targetReps: "8-10",
          completed: false,
        },
      ],
    },
  ],
};

function buildSessionDb(): Database {
  return createCyclingAuthMockDb({
    sessionRows: [buildSessionRow({ tenantId: TENANT_A, userId: USER_A })],
    membershipRows: [buildActiveMembershipRow({ tenantId: TENANT_A, userId: USER_A })],
  });
}

function buildRepoMock(overrides: Partial<Record<keyof ReturnType<typeof buildRepoMock>, unknown>> = {}) {
  return {
    startSession: vi.fn().mockResolvedValue({ kind: "started", session: activeSession }),
    findById: vi.fn().mockResolvedValue(activeSession),
    recordSet: vi.fn().mockResolvedValue(activeSession),
    completeSession: vi.fn().mockResolvedValue({ ...activeSession, status: "completed", completedAt: "2026-07-04T09:20:00.000Z" }),
    listCompletedSessions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

async function buildTestApp(repo = buildRepoMock(), db = buildSessionDb()): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      return reply.code(422).send({ error: "Validation Error" });
    }
    if (error.name === "AuthError") {
      return reply.code(401).send({ error: error.message });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  await app.register(authPlugin, { db });
  await app.register(workoutSessionRoutes, { repo: repo as never });
  return app;
}

describe("Workout session routes", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 401 when start is requested without authentication", async () => {
    app = await buildTestApp(buildRepoMock(), createCyclingAuthMockDb({ sessionRows: [], membershipRows: [] }));

    const response = await app.inject({
      method: "POST",
      url: "/workout-sessions",
      payload: { workoutPlanId: PLAN_ID, day: 1 },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when the authenticated user requests another user's session", async () => {
    const repo = buildRepoMock({ findById: vi.fn().mockResolvedValue(undefined) });
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "GET",
      url: `/workout-sessions/${SESSION_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");
  });

  it("returns 422 when the set body is structurally invalid", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "PATCH",
      url: `/workout-sessions/${SESSION_ID}/sets/${SET_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { actualReps: 10 },
    });

    expect(response.statusCode).toBe(422);
  });

  it("returns 422 when RPE is outside the allowed 0-10 range", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "PATCH",
      url: `/workout-sessions/${SESSION_ID}/sets/${SET_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { actualReps: 10, weightKg: 80, rpe: 11, completed: true, notes: "Too hard" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain("RPE");
  });

  it("accepts inclusive RPE boundary values and records the set", async () => {
    for (const rpe of [0, 10]) {
      const repo = buildRepoMock({ recordSet: vi.fn().mockResolvedValue(activeSession) });
      app = await buildTestApp(repo);

      const response = await app.inject({
        method: "PATCH",
        url: `/workout-sessions/${SESSION_ID}/sets/${SET_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { actualReps: 8, weightKg: 80, rpe, completed: true },
      });

      expect(response.statusCode).toBe(200);
      expect(repo.recordSet).toHaveBeenCalledWith(TENANT_A, USER_A, SESSION_ID, SET_ID, {
        actualReps: 8,
        weightKg: 80,
        rpe,
        completed: true,
      });

      await app.close();
    }
  });

  it("returns 404 when recording a set for another user's session in the same tenant", async () => {
    const repo = buildRepoMock({ recordSet: vi.fn().mockResolvedValue(undefined) });
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "PATCH",
      url: `/workout-sessions/${SESSION_ID}/sets/${SET_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { actualReps: 8, weightKg: 80, rpe: 8, completed: true },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");
  });

  it("returns 404 when start is called for a plan that is not ready", async () => {
    const repo = buildRepoMock({ startSession: vi.fn().mockResolvedValue(undefined) });
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "POST",
      url: "/workout-sessions",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { workoutPlanId: PLAN_ID, day: 1 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");
    expect(repo.startSession).toHaveBeenCalledWith(TENANT_A, USER_A, PLAN_ID, 1);
  });

  it("returns 422 when day exceeds the weekly maximum (risk-WARNING — day has an upper bound)", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/workout-sessions",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { workoutPlanId: PLAN_ID, day: 8 },
    });

    expect(response.statusCode).toBe(422);
  });

  it("accepts the inclusive weekly maximum day (7)", async () => {
    const repo = buildRepoMock({
      startSession: vi.fn().mockResolvedValue({ kind: "started", session: activeSession }),
    });
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "POST",
      url: "/workout-sessions",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { workoutPlanId: PLAN_ID, day: 7 },
    });

    expect(response.statusCode).toBe(200);
    expect(repo.startSession).toHaveBeenCalledWith(TENANT_A, USER_A, PLAN_ID, 7);
  });

  it("returns the existing active session (200) when start resumes the same day", async () => {
    const repo = buildRepoMock({
      startSession: vi.fn().mockResolvedValue({ kind: "resumed", session: activeSession }),
    });
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "POST",
      url: "/workout-sessions",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { workoutPlanId: PLAN_ID, day: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(activeSession);
    expect(repo.startSession).toHaveBeenCalledWith(TENANT_A, USER_A, PLAN_ID, 1);
  });

  it("returns 409 with the honestly-populated active scope via the REAL repo conflict path (F2)", async () => {
    // F2/risk-CRITICAL: rather than hard-coding activePlanName, wire the REAL
    // WorkoutSessionRepository so the route surfaces the name the repo actually
    // resolves from its (tenant+user scoped) plan lookup — proving the field is
    // honestly populated end-to-end, not a route-side literal.
    const activeSessionRow = {
      id: SESSION_ID,
      tenantId: TENANT_A,
      userId: USER_A,
      workoutPlanId: PLAN_ID,
      status: "active" as const,
      day: 3, // active on day 3; the caller requests day 1 → conflict.
      startedAt: new Date("2026-07-04T08:30:00Z"),
      completedAt: null,
    };
    // Scoped plan-name lookup returns the active plan's name + createdAt.
    const planNameRow = { name: "Summer Cut", createdAt: new Date("2026-07-04T08:00:00Z") };

    // Minimal queued select: workoutSessions → active row; workoutPlans → name.
    const queues = new Map<object, unknown[][]>([
      [workoutSessions, [[activeSessionRow]]],
      [workoutPlans, [[planNameRow]]],
    ]);
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table: object) => ({
        where: vi.fn().mockImplementation(() => {
          const q = queues.get(table) ?? [[]];
          const rows = q.shift() ?? [];
          queues.set(table, q);
          return {
            orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
            then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(resolve(rows)),
          };
        }),
      })),
    });
    const realRepo = new WorkoutSessionRepository({ select, transaction: vi.fn() } as never);

    app = await buildTestApp(realRepo as never);

    const response = await app.inject({
      method: "POST",
      url: "/workout-sessions",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { workoutPlanId: PLAN_ID, day: 1 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "active_session_conflict",
      activePlanName: "Summer Cut",
      activeDay: 3,
    });
  });

  it("records set progress for the authenticated user", async () => {
    const repo = buildRepoMock({ recordSet: vi.fn().mockResolvedValue(activeSession) });
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "PATCH",
      url: `/workout-sessions/${SESSION_ID}/sets/${SET_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { actualReps: 10, weightKg: 80, rpe: 8, completed: true, notes: "Strong set" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(activeSession);
    expect(repo.recordSet).toHaveBeenCalledWith(TENANT_A, USER_A, SESSION_ID, SET_ID, {
      actualReps: 10,
      weightKg: 80,
      rpe: 8,
      completed: true,
      notes: "Strong set",
    });
  });

  it("completes the authenticated user's active session", async () => {
    const completedSession = {
      ...activeSession,
      status: "completed" as const,
      completedAt: "2026-07-04T09:20:00.000Z",
    };
    const repo = buildRepoMock({ completeSession: vi.fn().mockResolvedValue(completedSession) });
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "POST",
      url: `/workout-sessions/${SESSION_ID}/complete`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(completedSession);
    expect(repo.completeSession).toHaveBeenCalledWith(TENANT_A, USER_A, SESSION_ID);
  });

  it("returns 200 (no-op) when retrying complete after a prior successful completion", async () => {
    // The repo's idempotent recovery path returns the already-completed
    // session rather than undefined; the route must surface that as 200,
    // never a 404, on a retried complete call.
    const completedSession = {
      ...activeSession,
      status: "completed" as const,
      completedAt: "2026-07-04T09:20:00.000Z",
    };
    const repo = buildRepoMock({ completeSession: vi.fn().mockResolvedValue(completedSession) });
    app = await buildTestApp(repo);

    const response = await app.inject({
      method: "POST",
      url: `/workout-sessions/${SESSION_ID}/complete`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(completedSession);
    expect(repo.completeSession).toHaveBeenCalledWith(TENANT_A, USER_A, SESSION_ID);
  });

  describe("GET /workout-sessions/history", () => {
    it("returns 401 when history is requested without authentication", async () => {
      app = await buildTestApp(buildRepoMock(), createCyclingAuthMockDb({ sessionRows: [], membershipRows: [] }));

      const response = await app.inject({ method: "GET", url: "/workout-sessions/history" });

      expect(response.statusCode).toBe(401);
    });

    it("returns the paginated history entries with default pagination and per-entry trend", async () => {
      const historyEntry: WorkoutHistoryEntry = {
        session: { ...activeSession, status: "completed", completedAt: "2026-07-04T09:20:00.000Z" },
        totalVolume: 100,
        averageRpe: 8,
        trend: { volumeDelta: 20, direction: "up" },
      };
      const repo = buildRepoMock({ listCompletedSessions: vi.fn().mockResolvedValue([historyEntry]) });
      app = await buildTestApp(repo);

      const response = await app.inject({
        method: "GET",
        url: "/workout-sessions/history",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([historyEntry]);
      expect(repo.listCompletedSessions).toHaveBeenCalledWith(TENANT_A, USER_A, { limit: 20, offset: 0 });
    });

    it("forwards caller-supplied limit and offset to the repo", async () => {
      const repo = buildRepoMock();
      app = await buildTestApp(repo);

      const response = await app.inject({
        method: "GET",
        url: "/workout-sessions/history?limit=5&offset=10",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      expect(repo.listCompletedSessions).toHaveBeenCalledWith(TENANT_A, USER_A, { limit: 5, offset: 10 });
    });

    it("returns 422 when limit or offset is not a valid non-negative integer", async () => {
      app = await buildTestApp();

      const response = await app.inject({
        method: "GET",
        url: "/workout-sessions/history?limit=-1",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(422);
    });
  });
});
