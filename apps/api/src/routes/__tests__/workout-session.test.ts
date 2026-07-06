import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { workoutSessionRoutes } from "../workout-session.js";
import type { Database } from "../../db/client.js";
import type { WorkoutSessionRecord } from "@kinora/contracts";
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
    startSession: vi.fn().mockResolvedValue(activeSession),
    findById: vi.fn().mockResolvedValue(activeSession),
    recordSet: vi.fn().mockResolvedValue(activeSession),
    completeSession: vi.fn().mockResolvedValue({ ...activeSession, status: "completed", completedAt: "2026-07-04T09:20:00.000Z" }),
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

  it("returns the existing active session when start is called again", async () => {
    const repo = buildRepoMock({ startSession: vi.fn().mockResolvedValue(activeSession) });
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
});
