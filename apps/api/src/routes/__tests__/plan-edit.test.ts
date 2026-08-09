/**
 * `PUT /workout-plans/:id/program` — the hand-edit write path (17d PR D).
 *
 * The two invariants this suite exists for, both structural rather than
 * obvious from reading the handler:
 *
 * 1. A client-submitted `catalogId` NEVER reaches persistence. The mechanism is
 *    Zod's strip-by-default on `WorkoutProgramSchema` (which has no `catalogId`
 *    member), so the assertion is made on the argument the repository actually
 *    received — not merely on the response. Introducing a global
 *    `.passthrough()` would fail here, which is the whole point.
 * 2. Zero rows updated is ambiguous between three causes, and the route re-reads
 *    the scoped row to say which one it was instead of returning a generic
 *    failure. `edit_conflict` carries the plan's CURRENT `version` (#421).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes, type PlanRouteRepo } from "../plan.js";
import type { Database } from "../../db/client.js";
import type { WorkoutProgram } from "@kinora/contracts";
import {
  VALID_TOKEN,
  SESSION_HASH,
  createCyclingAuthMockDb,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const SPEC_A = "aaaaaaaa-0000-0000-0000-000000000003";
const PLAN_ID = "cccccccc-0000-0000-0000-000000000001";

const LOADED_UPDATED_AT = new Date("2026-08-09T10:00:00.000Z");
const SAVED_UPDATED_AT = new Date("2026-08-09T10:05:00.000Z");

// #421: the optimistic-concurrency token is a monotonic integer, not a
// timestamp. LOADED_* is what the editor read, SAVED_* is what the write
// produced. The timestamps and the versions are deliberately independent
// here: updated_at moving is an audit fact, and only version moving is the
// concurrency guarantee.
const LOADED_VERSION = 3;
const SAVED_VERSION = LOADED_VERSION + 1;

/** A name the exercise catalog resolves, so `catalogId` is server-authored. */
const RESOLVABLE_EXERCISE = "Push-up";

function buildSessionDb(): Database {
  return createCyclingAuthMockDb({
    sessionRows: [
      {
        tokenHash: SESSION_HASH,
        userId: USER_A,
        tenantId: TENANT_A,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    ],
    membershipRows: [buildActiveMembershipRow({ tenantId: TENANT_A, userId: USER_A })],
  });
}

function editedProgram(overrides: Partial<WorkoutProgram> = {}): WorkoutProgram {
  return {
    weeklySessions: [
      {
        day: 1,
        title: "Push Day",
        exercises: [
          { name: RESOLVABLE_EXERCISE, sets: 4, reps: "8-10", restSeconds: 90 },
        ],
      },
    ],
    limitationWarnings: [],
    ...overrides,
  };
}

/** The program already stored on the plan, carrying warnings the edit must keep. */
const storedProgram: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Push Day",
      exercises: [{ name: "Bench Press", sets: 3, reps: "8-10", restSeconds: 90 }],
    },
  ],
  limitationWarnings: ["Avoid overhead pressing while your shoulder settles."],
};

function readyPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    status: "ready",
    planSpecId: SPEC_A,
    name: "Summer Cut",
    programJson: storedProgram,
    updatedAt: LOADED_UPDATED_AT,
    version: LOADED_VERSION,
    ...overrides,
  };
}

type PlanRepoMock = { [K in keyof PlanRouteRepo]?: ReturnType<typeof vi.fn> };

function buildPlanRepo(overrides: PlanRepoMock = {}): PlanRepoMock {
  return {
    findPlanById: vi.fn().mockResolvedValue(readyPlan()),
    findLatestPlanBySpec: vi.fn().mockResolvedValue(undefined),
    findAllPlansByUser: vi.fn().mockResolvedValue([]),
    findConfirmedById: vi.fn().mockResolvedValue({ equipment: [] }),
    updateProgram: vi
      .fn()
      .mockImplementation((_t: string, _u: string, id: string, program: WorkoutProgram) =>
        Promise.resolve({
          id,
          status: "ready",
          planSpecId: SPEC_A,
          name: "Summer Cut",
          programJson: program,
          updatedAt: SAVED_UPDATED_AT,
          version: SAVED_VERSION,
        }),
      ),
    ...overrides,
  };
}

const noopGenerationService = {
  startGeneration: () => Promise.reject(new Error("unexpected call in edit tests")),
};

async function buildTestApp(
  repo: PlanRepoMock = buildPlanRepo(),
  options: { observability?: { recordEvent: ReturnType<typeof vi.fn> } } = {},
): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error.name === "AuthError") {
      return reply.code(401).send({ error: error.message });
    }
    // Schema validation failures carry their own status — preserve it so the
    // 400-on-a-malformed-envelope branch is actually observable.
    return reply.code(error.statusCode ?? 500).send({ error: error.message });
  });

  await app.register(authPlugin, { db: buildSessionDb() });
  await app.register(planRoutes, {
    repo: repo as unknown as PlanRouteRepo,
    generationService: noopGenerationService,
    ...(options.observability ? { observability: options.observability } : {}),
  });

  return app;
}

function put(app: FastifyInstance, payload: unknown) {
  return app.inject({
    method: "PUT",
    url: `/workout-plans/${PLAN_ID}/program`,
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
    payload: payload as Record<string, unknown>,
  });
}

describe("PUT /workout-plans/:id/program (17d PR D)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    app = await buildTestApp();

    const res = await app.inject({
      method: "PUT",
      url: `/workout-plans/${PLAN_ID}/program`,
      payload: {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it("is not registered when the repo cannot write a program", async () => {
    // The route is opt-in on the port, exactly like archive/unarchive: a repo
    // without the write must not expose a half-wired endpoint.
    app = await buildTestApp(buildPlanRepo({ updateProgram: undefined }));

    const res = await put(app, {
      program: editedProgram(),
      expectedVersion: LOADED_VERSION,
    });

    expect(res.statusCode).toBe(404);
  });

  describe("step 1 — the envelope", () => {
    it("400s when expectedVersion is missing", async () => {
      app = await buildTestApp();

      const res = await put(app, { program: editedProgram() });

      expect(res.statusCode).toBe(400);
    });

    it("400s when program is missing", async () => {
      app = await buildTestApp();

      const res = await put(app, { expectedVersion: LOADED_VERSION });

      expect(res.statusCode).toBe(400);
    });

    it("strips an unknown top-level field instead of letting it reach the write", async () => {
      // Fastify's ajv runs with `removeAdditional`, so `additionalProperties:
      // false` deletes rather than rejects. Either way the field is gone before
      // the handler runs — asserted on the repository call, since that is the
      // property that matters: a body cannot smuggle `status` into an edit.
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
        status: "failed",
      });

      expect(res.statusCode).toBe(200);
      for (const arg of repo.updateProgram!.mock.calls[0]!) {
        expect(JSON.stringify(arg ?? null)).not.toContain("failed");
      }
    });

    it("400s on an expectedVersion that is not an integer, rather than treating it as a conflict", async () => {
      // A malformed token is a client bug, not a lost race: answering 409 would
      // tell the user someone else saved first, which is a lie, and would send
      // them to reload for no reason. #421 collapsed this into the schema —
      // "integer >= 1" is the whole of what makes a version token usable, so
      // there is no second hand-written check to disagree with it.
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      for (const bad of ["not-a-number", 1.5, 0, -1, null]) {
        const res = await put(app, { program: editedProgram(), expectedVersion: bad });
        expect(res.statusCode).toBe(400);
      }
      expect(repo.updateProgram).not.toHaveBeenCalled();
    });
  });

  describe("step 2 — WorkoutProgramSchema", () => {
    it("422s on a program that fails the schema, leaving the stored one untouched", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: { weeklySessions: [{ day: 1, title: "Push" }], limitationWarnings: [] },
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: "invalid_program" });
      expect(repo.updateProgram).not.toHaveBeenCalled();
    });

    it("a submitted catalogId never reaches the repository", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: {
          weeklySessions: [
            {
              day: 1,
              title: "Push Day",
              exercises: [
                {
                  name: RESOLVABLE_EXERCISE,
                  sets: 4,
                  reps: "8-10",
                  restSeconds: 90,
                  catalogId: "forged-catalog-id",
                },
              ],
            },
          ],
          limitationWarnings: [],
        },
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(200);
      // Asserted on what the REPOSITORY was handed, not on the response: the
      // response could be reshaped without the write ever being safe.
      const written = repo.updateProgram!.mock.calls[0]![3] as WorkoutProgram;
      const exercise = written.weeklySessions[0]!.exercises[0]!;
      expect(exercise.catalogId).not.toBe("forged-catalog-id");
      expect(JSON.stringify(written)).not.toContain("forged-catalog-id");
    });

    it("the server resolves catalogId itself for a name in the vocabulary", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      const written = repo.updateProgram!.mock.calls[0]![3] as WorkoutProgram;
      expect(written.weeklySessions[0]!.exercises[0]!.catalogId).toBeTruthy();
    });

    it("a submitted limitationWarnings array is ignored and the stored one survives", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      await put(app, {
        program: editedProgram({ limitationWarnings: ["I am not a real warning"] }),
        expectedVersion: LOADED_VERSION,
      });

      const written = repo.updateProgram!.mock.calls[0]![3] as WorkoutProgram;
      expect(written.limitationWarnings).toEqual(storedProgram.limitationWarnings);
    });
  });

  describe("step 3 — validateEditedProgram", () => {
    it("422s on a program with zero sessions, naming the issue", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: { weeklySessions: [], limitationWarnings: [] },
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: "empty_program", issues: ["empty_program"] });
      expect(repo.updateProgram).not.toHaveBeenCalled();
    });

    it("422s on a day outside 1..7 — a day the start route could never accept", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram({
          weeklySessions: [
            {
              day: 8,
              title: "Push Day",
              exercises: [{ name: RESOLVABLE_EXERCISE, sets: 3, reps: "8", restSeconds: 60 }],
            },
          ],
        }),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe("invalid_day");
      expect(repo.updateProgram).not.toHaveBeenCalled();
    });

    it("422s on a duplicate day", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      const exercises = [{ name: RESOLVABLE_EXERCISE, sets: 3, reps: "8", restSeconds: 60 }];
      const res = await put(app, {
        program: editedProgram({
          weeklySessions: [
            { day: 2, title: "A", exercises },
            { day: 2, title: "B", exercises },
          ],
        }),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe("duplicate_day");
    });

    it("422s on a day with no exercises", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram({
          weeklySessions: [{ day: 1, title: "Push Day", exercises: [] }],
        }),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe("empty_session");
    });
  });

  describe("step 4 — loading the plan", () => {
    it("404s on another user's or tenant's plan, indistinguishable from a missing one", async () => {
      const repo = buildPlanRepo({ findPlanById: vi.fn().mockResolvedValue(undefined) });
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not_found" });
      expect(repo.updateProgram).not.toHaveBeenCalled();
    });

    it("409 plan_not_ready on a generating plan", async () => {
      const repo = buildPlanRepo({
        findPlanById: vi.fn().mockResolvedValue(readyPlan({ status: "generating" })),
      });
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "plan_not_ready" });
      expect(repo.updateProgram).not.toHaveBeenCalled();
    });

    it("409 plan_not_ready on a failed plan", async () => {
      const repo = buildPlanRepo({
        findPlanById: vi.fn().mockResolvedValue(readyPlan({ status: "failed" })),
      });
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "plan_not_ready" });
    });

    it("404s when the confirmed spec behind the plan cannot be read", async () => {
      const repo = buildPlanRepo({ findConfirmedById: vi.fn().mockResolvedValue(undefined) });
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(404);
      expect(repo.updateProgram).not.toHaveBeenCalled();
    });
  });

  describe("steps 6 and 7 — optimistic concurrency", () => {
    it("passes the caller's expectedVersion through to the repository as a number", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      const passed = repo.updateProgram!.mock.calls[0]![4];
      expect(passed).toBe(LOADED_VERSION);
      expect(typeof passed).toBe("number");
    });

    it("200s on a matching expectedVersion and returns the advanced version", async () => {
      app = await buildTestApp();

      const res = await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(PLAN_ID);
      // The token the editor must adopt for its next save. Without it, a second
      // save from the same tab would conflict with the tab's own first save.
      expect(body.version).toBe(SAVED_VERSION);
      expect(body.version).toBeGreaterThan(LOADED_VERSION);
      expect(body.updatedAt).toBe(SAVED_UPDATED_AT.toISOString());
      expect(body.program.weeklySessions[0].exercises[0].name).toBe(RESOLVABLE_EXERCISE);
    });

    it("409 edit_conflict, carrying the plan's CURRENT version, on a stale precondition", async () => {
      const movedOn = 9;
      const repo = buildPlanRepo({
        updateProgram: vi.fn().mockResolvedValue(undefined),
        findPlanById: vi
          .fn()
          .mockResolvedValueOnce(readyPlan())
          .mockResolvedValueOnce(readyPlan({ version: movedOn })),
      });
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({
        error: "edit_conflict",
        currentVersion: movedOn,
      });
    });

    it("re-reads the scoped row to disambiguate 0 rows updated, rather than failing generically", async () => {
      const repo = buildPlanRepo({
        updateProgram: vi.fn().mockResolvedValue(undefined),
        findPlanById: vi
          .fn()
          .mockResolvedValueOnce(readyPlan())
          .mockResolvedValueOnce(readyPlan()),
      });
      app = await buildTestApp(repo);

      await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      expect(repo.findPlanById).toHaveBeenCalledTimes(2);
      expect(repo.findPlanById!.mock.calls[1]).toEqual([TENANT_A, USER_A, PLAN_ID]);
    });

    it("404s when the re-read finds the plan gone between the load and the write", async () => {
      const repo = buildPlanRepo({
        updateProgram: vi.fn().mockResolvedValue(undefined),
        findPlanById: vi
          .fn()
          .mockResolvedValueOnce(readyPlan())
          .mockResolvedValueOnce(undefined),
      });
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not_found" });
    });

    it("409 plan_not_ready when the re-read finds the plan no longer ready", async () => {
      const repo = buildPlanRepo({
        updateProgram: vi.fn().mockResolvedValue(undefined),
        findPlanById: vi
          .fn()
          .mockResolvedValueOnce(readyPlan())
          .mockResolvedValueOnce(readyPlan({ status: "generating" })),
      });
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "plan_not_ready" });
    });
  });

  describe("observability", () => {
    it("reports an unresolved exercise with ids and the name only", async () => {
      const recordEvent = vi.fn();
      const repo = buildPlanRepo();
      app = await buildTestApp(repo, { observability: { recordEvent } });

      const res = await put(app, {
        program: editedProgram({
          weeklySessions: [
            {
              day: 1,
              title: "Push Day",
              exercises: [
                { name: "Wubbawubba Curl", sets: 3, reps: "10", restSeconds: 60 },
              ],
            },
          ],
        }),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(200);
      expect(recordEvent).toHaveBeenCalledTimes(1);
      const event = recordEvent.mock.calls[0]![0];
      expect(event.event).toBe("plan.edit_exercise_unresolved");
      expect(event.metadata.exerciseName).toBe("Wubbawubba Curl");
      expect(event.metadata.planId).toBe(PLAN_ID);
      // Scalars and ids only — never the program, never the user's notes.
      for (const value of Object.values(event.metadata as Record<string, unknown>)) {
        expect(["string", "number", "boolean", "undefined"]).toContain(typeof value);
      }
    });

    it("records nothing when every exercise resolves", async () => {
      const recordEvent = vi.fn();
      app = await buildTestApp(buildPlanRepo(), { observability: { recordEvent } });

      await put(app, {
        program: editedProgram(),
        expectedVersion: LOADED_VERSION,
      });

      expect(recordEvent).not.toHaveBeenCalled();
    });

    it("an unresolved exercise never fails the edit", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(repo);

      const res = await put(app, {
        program: editedProgram({
          weeklySessions: [
            {
              day: 1,
              title: "Push Day",
              exercises: [{ name: "Wubbawubba Curl", sets: 3, reps: "10", restSeconds: 60 }],
            },
          ],
        }),
        expectedVersion: LOADED_VERSION,
      });

      expect(res.statusCode).toBe(200);
      const written = repo.updateProgram!.mock.calls[0]![3] as WorkoutProgram;
      // Kept as free text with no id, exactly as generation does.
      expect(written.weeklySessions[0]!.exercises[0]!.name).toBe("Wubbawubba Curl");
      expect(written.weeklySessions[0]!.exercises[0]!.catalogId).toBeUndefined();
    });
  });
});
