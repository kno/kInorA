import { describe, expect, it, vi } from "vitest";
import { SQL } from "drizzle-orm";
import type { WorkoutProgram } from "@kinora/contracts";
import { WorkoutSessionRepository } from "../workout-session.js";
import { sessionExercises, setRecords, workoutPlans, workoutSessions } from "../../schema.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const USER_B = "aaaaaaaa-0000-0000-0000-000000000003";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";
const PLAN_ID = "cccccccc-0000-0000-0000-000000000001";
const SESSION_ID = "dddddddd-0000-0000-0000-000000000001";
const EXERCISE_1_ID = "eeeeeeee-0000-0000-0000-000000000001";
const EXERCISE_2_ID = "eeeeeeee-0000-0000-0000-000000000002";
const SET_1_ID = "ffffffff-0000-0000-0000-000000000001";
const SET_2_ID = "ffffffff-0000-0000-0000-000000000002";
const SET_3_ID = "ffffffff-0000-0000-0000-000000000003";

const readyProgram: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Upper A",
      exercises: [
        { name: "Bench Press", sets: 2, reps: "8-10", restSeconds: 90, notes: "Pause 1s" },
        {
          name: "Chest Supported Row",
          sets: 1,
          reps: "10-12",
          restSeconds: 75,
          substitutionNote: "Use dumbbells if machine busy",
        },
      ],
    },
  ],
  limitationWarnings: [],
};

const readyPlanRow = {
  id: PLAN_ID,
  tenantId: TENANT_A,
  userId: USER_A,
  planSpecId: "spec-1",
  status: "ready" as const,
  programJson: readyProgram,
  errorMessage: null,
  createdAt: new Date("2026-07-04T08:00:00Z"),
  updatedAt: new Date("2026-07-04T08:00:00Z"),
};

const sessionRow = {
  id: SESSION_ID,
  tenantId: TENANT_A,
  userId: USER_A,
  workoutPlanId: PLAN_ID,
  status: "active" as const,
  day: 1,
  startedAt: new Date("2026-07-04T08:30:00Z"),
  completedAt: null,
  createdAt: new Date("2026-07-04T08:30:00Z"),
  updatedAt: new Date("2026-07-04T08:30:00Z"),
};

const completedSessionRow = {
  ...sessionRow,
  status: "completed" as const,
  completedAt: new Date("2026-07-04T09:20:00Z"),
  updatedAt: new Date("2026-07-04T09:20:00Z"),
};

const exerciseRows = [
  {
    id: EXERCISE_1_ID,
    workoutSessionId: SESSION_ID,
    exerciseIndex: 0,
    title: "Bench Press",
    restSeconds: 90,
    notes: "Pause 1s",
  },
  {
    id: EXERCISE_2_ID,
    workoutSessionId: SESSION_ID,
    exerciseIndex: 1,
    title: "Chest Supported Row",
    restSeconds: 75,
    notes: "Use dumbbells if machine busy",
  },
];

const initialSetRows = [
  {
    id: SET_1_ID,
    sessionExerciseId: EXERCISE_1_ID,
    setIndex: 0,
    targetReps: "8-10",
    actualReps: null,
    weightKg: null,
    rpe: null,
    completed: false,
    notes: null,
  },
  {
    id: SET_2_ID,
    sessionExerciseId: EXERCISE_1_ID,
    setIndex: 1,
    targetReps: "8-10",
    actualReps: null,
    weightKg: null,
    rpe: null,
    completed: false,
    notes: null,
  },
  {
    id: SET_3_ID,
    sessionExerciseId: EXERCISE_2_ID,
    setIndex: 0,
    targetReps: "10-12",
    actualReps: null,
    weightKg: null,
    rpe: null,
    completed: false,
    notes: null,
  },
];

const completedSetRows = [
  {
    ...initialSetRows[0],
    actualReps: 10,
    weightKg: "80.50",
    rpe: 8,
    completed: true,
    notes: "Strong set",
  },
];

function createQueuedSelectDb(queues: Map<object, unknown[][]>) {
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockImplementation((table: object) => ({
      where: vi.fn().mockImplementation(() => {
        const tableQueue = queues.get(table) ?? [[]];
        const nextRows = tableQueue.shift() ?? [];
        queues.set(table, tableQueue);
        const limit = vi.fn().mockResolvedValue(nextRows);
        const orderBy = vi.fn().mockReturnValue({
          limit,
          then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(nextRows)),
        });
        return {
          orderBy,
          then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(nextRows)),
        };
      }),
    })),
  });

  return { select };
}

function createStartDb() {
  const select = createQueuedSelectDb(
    new Map<object, unknown[][]>([
      [workoutSessions, [[]]],
      [workoutPlans, [[readyPlanRow]]],
    ])
  ).select;

  const insert = vi.fn().mockImplementation((table: object) => ({
    values: vi.fn().mockImplementation(() => {
      if (table === workoutSessions) return { returning: vi.fn().mockResolvedValue([sessionRow]) };
      if (table === sessionExercises) return { returning: vi.fn().mockResolvedValue(exerciseRows) };
      if (table === setRecords) return { returning: vi.fn().mockResolvedValue(initialSetRows) };
      throw new Error(`Unexpected insert table: ${String(table)}`);
    }),
  }));

  const tx = { insert, select };
  const transaction = vi.fn().mockImplementation(async (cb: (db: typeof tx) => Promise<unknown>) => cb(tx));

  return { db: { select, transaction }, insert, transaction };
}

describe("WorkoutSessionRepository", () => {
  describe("startSession", () => {
    it("Branch C — creates an immutable snapshot with the day persisted when no active session exists", async () => {
      const { db, insert, transaction } = createStartDb();
      const repo = new WorkoutSessionRepository(db as never);

      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);
      readyProgram.weeklySessions[0]!.exercises[0]!.name = "Changed After Start";

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledTimes(3);
      expect(result.kind).toBe("started");
      // The day must be written on the new session row.
      const sessionInsert = insert.mock.results[0]!.value as {
        values: ReturnType<typeof vi.fn>;
      };
      expect(sessionInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({ workoutPlanId: PLAN_ID, day: 1, status: "active" }),
      );
      expect(result).toMatchObject({
        kind: "started",
        session: {
          id: SESSION_ID,
          workoutPlanId: PLAN_ID,
          status: "active",
          day: 1,
          exercises: [
            {
              id: EXERCISE_1_ID,
              title: "Bench Press",
              restSeconds: 90,
              setRecords: [
                { id: SET_1_ID, targetReps: "8-10", completed: false },
                { id: SET_2_ID, targetReps: "8-10", completed: false },
              ],
            },
            {
              id: EXERCISE_2_ID,
              title: "Chest Supported Row",
              notes: "Use dumbbells if machine busy",
              setRecords: [{ id: SET_3_ID, targetReps: "10-12", completed: false }],
            },
          ],
        },
      });
    });

    it("snapshots exercise context so later plan edits do not leak into the started session", async () => {
      const { db } = createStartDb();
      const repo = new WorkoutSessionRepository(db as never);

      const started = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);

      // Mutating the source plan program after the snapshot is taken must not
      // change the persisted relational session that was already returned.
      readyProgram.weeklySessions[0]!.exercises[0]!.name = "Mutated After Snapshot";
      readyProgram.weeklySessions[0]!.exercises[0]!.restSeconds = 999;

      expect(started.kind).toBe("started");
      if (started.kind === "started") {
        expect(started.session.exercises[0]?.title).toBe("Bench Press");
        expect(started.session.exercises[0]?.restSeconds).toBe(90);
      }

      // Restore for other tests that share the module-level fixture.
      readyProgram.weeklySessions[0]!.exercises[0]!.name = "Bench Press";
      readyProgram.weeklySessions[0]!.exercises[0]!.restSeconds = 90;
    });

    it("returns undefined and performs no insert when the plan is not in a ready state", async () => {
      // workoutSessions queue: no active session → falls through to plan lookup
      // workoutPlans queue: empty → plan not found (not ready / wrong owner / wrong id)
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[]]],
        [workoutPlans, [[]]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const transaction = vi.fn();
      const repo = new WorkoutSessionRepository({ select, transaction } as never);

      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);

      expect(result).toBeUndefined();
      expect(transaction).not.toHaveBeenCalled();
    });

    it("returns undefined and performs no insert when the requested day does not exist in the plan", async () => {
      // Day 99 is not present in readyProgram which only has day 1.
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[]]],
        [workoutPlans, [[readyPlanRow]]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const transaction = vi.fn();
      const repo = new WorkoutSessionRepository({ select, transaction } as never);

      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 99);

      expect(result).toBeUndefined();
      expect(transaction).not.toHaveBeenCalled();
    });

    it("Branch A — resumes the active session when (planId, day) matches", async () => {
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[sessionRow], [sessionRow]]],
        [sessionExercises, [exerciseRows]],
        [setRecords, [initialSetRows]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const transaction = vi.fn();
      const repo = new WorkoutSessionRepository({ select, transaction } as never);

      // sessionRow.day === 1 and PLAN_ID matches → resume.
      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);

      expect(transaction).not.toHaveBeenCalled();
      expect(result.kind).toBe("resumed");
      if (result.kind === "resumed") {
        expect(result.session.id).toBe(SESSION_ID);
        expect(result.session.status).toBe("active");
      }
    });

    it("Branch B — reports a conflict when the active session is a different (planId, day)", async () => {
      // Active session is (PLAN_ID, day 1); the caller requests day 2 → conflict.
      // After the active-session read the repo looks up the active plan's name
      // (tenant+user scoped) to populate activePlanName; that named plan row is
      // queued as the SECOND workoutPlans read.
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[sessionRow]]],
        [workoutPlans, [[{ name: "Summer Cut", createdAt: readyPlanRow.createdAt }]]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const transaction = vi.fn();
      const repo = new WorkoutSessionRepository({ select, transaction } as never);

      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 2);

      expect(transaction).not.toHaveBeenCalled();
      expect(result.kind).toBe("conflict");
      if (result.kind === "conflict") {
        expect(result.activePlanId).toBe(PLAN_ID);
        expect(result.activeDay).toBe(1);
        // F2/risk-CRITICAL: the name is honestly populated from the scoped
        // plan lookup, not left undefined.
        expect(result.activePlanName).toBe("Summer Cut");
      }
    });

    it("Branch B — resolves a null plan name to the date-based default label (F2)", async () => {
      // A blank/legacy plan name must resolve through defaultPlanName so the
      // client still receives a non-empty label.
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[sessionRow]]],
        [
          workoutPlans,
          [[{ name: null, createdAt: new Date("2026-07-06T09:30:00.000Z") }]],
        ],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const repo = new WorkoutSessionRepository({ select, transaction: vi.fn() } as never);

      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 2);

      expect(result.kind).toBe("conflict");
      if (result.kind === "conflict") {
        expect(result.activePlanName).toBe("Plan 2026-07-06");
      }
    });

    it("Branch B (legacy null-day) — reports a conflict and never resumes when the active session has no day", async () => {
      const legacyRow = { ...sessionRow, day: null };
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[legacyRow]]],
        [workoutPlans, [[{ name: "Summer Cut", createdAt: readyPlanRow.createdAt }]]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const transaction = vi.fn();
      const repo = new WorkoutSessionRepository({ select, transaction } as never);

      // Even requesting the SAME plan and day 1 must NOT resume a null-day row.
      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);

      expect(transaction).not.toHaveBeenCalled();
      expect(result.kind).toBe("conflict");
      if (result.kind === "conflict") {
        expect(result.activePlanId).toBe(PLAN_ID);
        expect(result.activeDay).toBeNull();
      }
    });

    it("Branch A (defensive) — returns undefined when the active row cannot be re-read by findById (F5)", async () => {
      // Simulated race/inconsistency: findLatestActiveSession returns an active
      // row for the requested (planId, day), but the subsequent findById read
      // returns nothing (e.g. concurrent completion). The intended, covered
      // behavior is to return undefined so the route maps it to a 404 rather
      // than a phantom resume — this test LOCKS that contract.
      const queues = new Map<object, unknown[][]>([
        // 1st workoutSessions read = active lookup (row present),
        // 2nd = findById (empty → undefined).
        [workoutSessions, [[sessionRow], []]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const transaction = vi.fn();
      const repo = new WorkoutSessionRepository({ select, transaction } as never);

      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);

      expect(result).toBeUndefined();
      expect(transaction).not.toHaveBeenCalled();
    });

    it("Multi-week — creates a new row for a (planId, day) with a completed history and no active row", async () => {
      // No ACTIVE session (findLatestActiveSession filters on status='active'),
      // so a prior completed session for the same (planId, day) does not block
      // starting a fresh row on a later week.
      const { db, insert, transaction } = createStartDb();
      const repo = new WorkoutSessionRepository(db as never);

      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledTimes(3);
      expect(result.kind).toBe("started");
      if (result.kind === "started") {
        expect(result.session.id).toBe(SESSION_ID);
      }
    });

    it("classifies each exercise's muscle_group at write time via classifyExerciseMuscleGroup (09c-v1 Slice 1b)", async () => {
      // Bench Press -> chest (bare "bench press"); Chest Supported Row -> back
      // (bare "row"), matching the fixtures already used across this file.
      const { db, insert } = createStartDb();
      const repo = new WorkoutSessionRepository(db as never);

      await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);

      const exercisesInsert = insert.mock.results[1]!.value as {
        values: ReturnType<typeof vi.fn>;
      };
      expect(exercisesInsert.values).toHaveBeenCalledWith([
        expect.objectContaining({ title: "Bench Press", muscleGroup: "chest" }),
        expect.objectContaining({ title: "Chest Supported Row", muscleGroup: "back" }),
      ]);
    });

    it("degrades to a null muscle_group for an unclassifiable exercise title", async () => {
      const unclassifiableProgram: WorkoutProgram = {
        weeklySessions: [
          {
            day: 1,
            title: "Odd Day",
            exercises: [{ name: "Farmer's Carry", sets: 3, reps: "40m", restSeconds: 60 }],
          },
        ],
        limitationWarnings: [],
      };
      const planRow = { ...readyPlanRow, programJson: unclassifiableProgram };
      const select = createQueuedSelectDb(
        new Map<object, unknown[][]>([
          [workoutSessions, [[]]],
          [workoutPlans, [[planRow]]],
        ]),
      ).select;

      const insert = vi.fn().mockImplementation((table: object) => ({
        values: vi.fn().mockImplementation(() => {
          if (table === workoutSessions) return { returning: vi.fn().mockResolvedValue([sessionRow]) };
          if (table === sessionExercises) return { returning: vi.fn().mockResolvedValue([]) };
          if (table === setRecords) return { returning: vi.fn().mockResolvedValue([]) };
          throw new Error(`Unexpected insert table: ${String(table)}`);
        }),
      }));
      const tx = { insert, select };
      const transaction = vi.fn().mockImplementation(async (cb: (db: typeof tx) => Promise<unknown>) => cb(tx));
      const repo = new WorkoutSessionRepository({ select, transaction } as never);

      await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);

      const exercisesInsert = insert.mock.results[1]!.value as {
        values: ReturnType<typeof vi.fn>;
      };
      expect(exercisesInsert.values).toHaveBeenCalledWith([
        expect.objectContaining({ title: "Farmer's Carry", muscleGroup: null }),
      ]);
    });
  });

  describe("findById", () => {
    it("returns a tenant/user scoped workout session with exercises and sets", async () => {
      const select = createQueuedSelectDb(
        new Map<object, unknown[][]>([
          [workoutSessions, [[sessionRow]]],
          [sessionExercises, [exerciseRows]],
          [setRecords, [completedSetRows]],
        ])
      ).select;
      const repo = new WorkoutSessionRepository({ select } as never);

      const result = await repo.findById(TENANT_A, USER_A, SESSION_ID);

      expect(result?.day).toBe(1);
      expect(result?.exercises[0]?.setRecords[0]).toMatchObject({
        id: SET_1_ID,
        actualReps: 10,
        weightKg: 80.5,
        rpe: 8,
        completed: true,
      });
    });

    it("returns undefined for a tenant mismatch", async () => {
      const select = createQueuedSelectDb(new Map([[workoutSessions, [[]]]])).select;
      const repo = new WorkoutSessionRepository({ select } as never);

      const result = await repo.findById(TENANT_B, USER_A, SESSION_ID);

      expect(result).toBeUndefined();
    });

    it("returns undefined for a user mismatch within the same tenant", async () => {
      const select = createQueuedSelectDb(new Map([[workoutSessions, [[]]]])).select;
      const repo = new WorkoutSessionRepository({ select } as never);

      const result = await repo.findById(TENANT_A, USER_B, SESSION_ID);

      expect(result).toBeUndefined();
    });
  });

  describe("recordSet", () => {
    it("writes actual set data and returns the refreshed session snapshot", async () => {
      const updatedSetRows = [
        {
          ...initialSetRows[0],
          actualReps: 10,
          weightKg: "80",
          rpe: 8,
          completed: true,
          notes: "Strong set",
        },
        initialSetRows[1],
        initialSetRows[2],
      ];

      // sessionExercises is read 3×: findById(pre-check), the session-scoping
      // subquery build in the UPDATE (risk-BLOCKER fix), and findById(refresh).
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[sessionRow], [sessionRow]]],
        [sessionExercises, [exerciseRows, exerciseRows, exerciseRows]],
        [setRecords, [initialSetRows, updatedSetRows]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const returning = vi.fn().mockResolvedValue([updatedSetRows[0]]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.recordSet(TENANT_A, USER_A, SESSION_ID, SET_1_ID, {
        actualReps: 10,
        weightKg: 80,
        rpe: 8,
        completed: true,
        notes: "Strong set",
      });

      expect(update).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith({
        actualReps: 10,
        weightKg: "80",
        rpe: 8,
        completed: true,
        notes: "Strong set",
      });
      expect(result?.exercises[0]?.setRecords[0]).toMatchObject({
        id: SET_1_ID,
        actualReps: 10,
        weightKg: 80,
        rpe: 8,
        completed: true,
        notes: "Strong set",
      });
    });

    it("NEGATIVE CONTROL (risk-BLOCKER/IDOR) — the UPDATE is scoped to the caller's session so a cross-session setId affects no rows", async () => {
      // Attack shape: a caller who owns SESSION_ID passes a setId that actually
      // belongs to ANOTHER session/user. Even if a pre-check were fooled, the
      // write must be constrained to sets whose sessionExercise belongs to
      // SESSION_ID — so the DB matches zero rows and recordSet returns undefined.
      //
      // Without the fix the UPDATE was `WHERE eq(setRecords.id, setId)` only:
      // the foreign set WOULD be mutated. This test asserts (a) the .where()
      // predicate is the composite session-scoped `and` (not a bare id eq), and
      // (b) a zero-row result maps to undefined (no cross-tenant write).
      const foreignSetId = "ffffffff-9999-9999-9999-999999999999";
      // findById returns a session whose exercises DO contain the foreign set,
      // simulating a pre-check that passed; the SQL scope is the real defense.
      const sessionWithForeignSet = {
        ...sessionRow,
      };
      const exercisesWithForeignSet = [
        { ...exerciseRows[0] },
      ];
      const setRowsWithForeign = [
        { ...initialSetRows[0], id: foreignSetId, sessionExerciseId: EXERCISE_1_ID },
      ];

      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[sessionWithForeignSet]]],
        [sessionExercises, [exercisesWithForeignSet, exercisesWithForeignSet]],
        [setRecords, [setRowsWithForeign]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      // The scoped UPDATE matches no row belonging to SESSION_ID → empty result.
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.recordSet(TENANT_A, USER_A, SESSION_ID, foreignSetId, {
        completed: true,
      });

      // No row updated → no cross-tenant write leaked back to the caller.
      expect(result).toBeUndefined();
      // The write predicate MUST be the composite session-scoped `and`
      // (id-eq AND the sessionExercise-membership subquery), never a bare
      // single-column `eq(setRecords.id, setId)`.
      //
      // Structural discriminator: drizzle's `and(...)` wraps its combined
      // sub-conditions in a nested SQL chunk, so its queryChunks contain ≥1
      // instance of SQL; a bare `eq` has ZERO nested SQL chunks (its middle
      // chunk is the raw Column). Without the fix (bare eq), nestedSqlChunks
      // is 0 and this assertion fails — the negative control.
      expect(where).toHaveBeenCalledTimes(1);
      const predicate = where.mock.calls[0]![0] as { queryChunks?: unknown[] };
      const nestedSqlChunks = (predicate.queryChunks ?? []).filter(
        (chunk) => chunk instanceof SQL,
      ).length;
      expect(nestedSqlChunks).toBeGreaterThanOrEqual(1);
    });

    it("returns undefined when the set does not belong to the active session", async () => {
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[sessionRow]]],
        [sessionExercises, [exerciseRows]],
        [setRecords, [initialSetRows]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const update = vi.fn();
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.recordSet(
        TENANT_A,
        USER_A,
        SESSION_ID,
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
        { completed: true }
      );

      expect(result).toBeUndefined();
      expect(update).not.toHaveBeenCalled();
    });

    it("does not write a set for a session owned by another user in the same tenant", async () => {
      // The scoped session read finds nothing for USER_B, so no set write happens.
      const queues = new Map<object, unknown[][]>([[workoutSessions, [[]]]]);
      const select = createQueuedSelectDb(queues).select;
      const update = vi.fn();
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.recordSet(TENANT_A, USER_B, SESSION_ID, SET_1_ID, {
        completed: true,
      });

      expect(result).toBeUndefined();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("completeSession", () => {
    it("marks the active session as completed and returns completed state", async () => {
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[completedSessionRow]]],
        [sessionExercises, [exerciseRows]],
        [setRecords, [initialSetRows]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const returning = vi.fn().mockResolvedValue([completedSessionRow]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.completeSession(TENANT_A, USER_A, SESSION_ID);

      expect(update).toHaveBeenCalledTimes(1);
      expect(result?.status).toBe("completed");
      expect(result?.completedAt).toBe("2026-07-04T09:20:00.000Z");
    });

    it("does not complete a session owned by another user in the same tenant", async () => {
      // The user-scoped completion update matches no row, AND the recovery
      // re-read (scoped identically to findById) finds nothing for USER_B
      // either, so the caller correctly gets undefined (404), not a leak.
      const queues = new Map<object, unknown[][]>([[workoutSessions, [[]]]]);
      const select = createQueuedSelectDb(queues).select;
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.completeSession(TENANT_A, USER_B, SESSION_ID);

      expect(result).toBeUndefined();
    });

    it("idempotent retry — a completed session is re-read scoped by (tenantId, userId, id) and returned as a 200 no-op, without re-running completion side effects", async () => {
      // The update's WHERE status='active' guard matches 0 rows because the
      // session was already completed by a prior successful request. The
      // repo must recover via a re-read scoped EXACTLY like findById
      // (tenantId, userId, id) and return the already-completed row instead
      // of treating the 0-row update as a 404.
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[completedSessionRow]]],
        [sessionExercises, [exerciseRows]],
        [setRecords, [completedSetRows]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.completeSession(TENANT_A, USER_A, SESSION_ID);

      // Exactly one UPDATE attempt — no retry loop, no second completion side effect.
      expect(update).toHaveBeenCalledTimes(1);
      expect(result?.status).toBe("completed");
      expect(result?.id).toBe(SESSION_ID);
    });

    it("NEGATIVE CONTROL (no IDOR) — a 0-row update recovery re-read is scoped by (tenantId, userId, id), so retrying against another tenant/user's completed session returns undefined, never that session's data", async () => {
      // Attack shape: caller retries complete for a sessionId that exists and
      // is already completed, but under the WRONG (tenantId, userId). The
      // recovery re-read must be scoped identically to findById — never an
      // unscoped `WHERE id = :id` — so it finds nothing for this caller and
      // returns undefined (404), not the other tenant's/user's session data.
      const queues = new Map<object, unknown[][]>([[workoutSessions, [[]]]]);
      const select = createQueuedSelectDb(queues).select;
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.completeSession(TENANT_B, USER_A, SESSION_ID);

      expect(result).toBeUndefined();
    });
  });

  describe("listCompletedSessions", () => {
    const SESSION_A_ID = "dddddddd-0000-0000-0000-0000000000a1";
    const SESSION_B_ID = "dddddddd-0000-0000-0000-0000000000b2";
    const SESSION_C_ID = "dddddddd-0000-0000-0000-0000000000c3";
    const EXERCISE_A_ID = "eeeeeeee-0000-0000-0000-00000000a001";
    const EXERCISE_B_ID = "eeeeeeee-0000-0000-0000-00000000b002";
    const EXERCISE_C_ID = "eeeeeeee-0000-0000-0000-00000000c003";

    function buildCompletedSessionRow(id: string, completedAt: Date) {
      return {
        id,
        tenantId: TENANT_A,
        userId: USER_A,
        workoutPlanId: PLAN_ID,
        status: "completed" as const,
        day: 1,
        startedAt: new Date(completedAt.getTime() - 45 * 60 * 1000),
        completedAt,
      };
    }

    // Newest → oldest: A (page[0]), B (page[1], only 2 requested), C (the
    // limit+1 lookback row — supplies B's trend prior, never returned itself).
    const sessionRowA = buildCompletedSessionRow(SESSION_A_ID, new Date("2026-07-10T09:00:00Z"));
    const sessionRowB = buildCompletedSessionRow(SESSION_B_ID, new Date("2026-07-08T09:00:00Z"));
    const sessionRowC = buildCompletedSessionRow(SESSION_C_ID, new Date("2026-07-06T09:00:00Z"));

    const exerciseRowA = {
      id: EXERCISE_A_ID,
      workoutSessionId: SESSION_A_ID,
      exerciseIndex: 0,
      title: "Bench Press",
      restSeconds: 90,
      notes: null,
    };
    const exerciseRowB = { ...exerciseRowA, id: EXERCISE_B_ID, workoutSessionId: SESSION_B_ID };
    const exerciseRowC = { ...exerciseRowA, id: EXERCISE_C_ID, workoutSessionId: SESSION_C_ID };

    function buildSetRow(id: string, sessionExerciseId: string, weightKg: string, rpe: number) {
      return {
        id,
        sessionExerciseId,
        setIndex: 0,
        targetReps: "8-10",
        actualReps: 10,
        weightKg,
        rpe,
        completed: true,
        notes: null,
      };
    }

    // A: 10 * 10 = 100 volume. B: 8 * 10 = 80. C: 6 * 10 = 60.
    const setRowA = buildSetRow("ffffffff-0000-0000-0000-00000000a001", EXERCISE_A_ID, "10.00", 8);
    const setRowB = buildSetRow("ffffffff-0000-0000-0000-00000000b002", EXERCISE_B_ID, "8.00", 7);
    const setRowC = buildSetRow("ffffffff-0000-0000-0000-00000000c003", EXERCISE_C_ID, "6.00", 6);

    function createHistoryDb(sessionRows: unknown[], exerciseRows: unknown[], setRows: unknown[]) {
      const sessionsWhere = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            offset: vi.fn().mockResolvedValue(sessionRows),
          }),
        }),
      });
      const exercisesWhere = vi.fn().mockResolvedValue(exerciseRows);
      const setsWhere = vi.fn().mockResolvedValue(setRows);

      const select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((table: object) => {
          if (table === workoutSessions) return { where: sessionsWhere };
          if (table === sessionExercises) return { where: exercisesWhere };
          if (table === setRecords) return { where: setsWhere };
          throw new Error(`Unexpected select table: ${String(table)}`);
        }),
      }));

      return { select, sessionsWhere, exercisesWhere, setsWhere };
    }

    it("batch-fetches a page via a constant, bounded number of queries — never one query per row", async () => {
      const { select, sessionsWhere, exercisesWhere, setsWhere } = createHistoryDb(
        [sessionRowA, sessionRowB, sessionRowC],
        [exerciseRowA, exerciseRowB, exerciseRowC],
        [setRowA, setRowB, setRowC],
      );
      const repo = new WorkoutSessionRepository({ select } as never);

      const entries = await repo.listCompletedSessions(TENANT_A, USER_A, { limit: 2, offset: 0 });

      // Exactly 3 queries total (sessions page, exercises inArray, sets
      // inArray) — NOT 3 + (2 * per-row findById calls). This is the
      // constant-query-count assertion the design forbids regressing.
      expect(select).toHaveBeenCalledTimes(3);
      expect(sessionsWhere).toHaveBeenCalledTimes(1);
      expect(exercisesWhere).toHaveBeenCalledTimes(1);
      expect(setsWhere).toHaveBeenCalledTimes(1);
      expect(entries).toHaveLength(2);
      expect(entries[0]?.session.id).toBe(SESSION_A_ID);
      expect(entries[0]?.totalVolume).toBe(100);
      expect(entries[0]?.averageRpe).toBe(8);
      expect(entries[1]?.session.id).toBe(SESSION_B_ID);
      expect(entries[1]?.totalVolume).toBe(80);
    });

    it("returns an empty page when the caller has no completed sessions, issuing no follow-up queries", async () => {
      const { select, exercisesWhere, setsWhere } = createHistoryDb([], [], []);
      const repo = new WorkoutSessionRepository({ select } as never);

      const entries = await repo.listCompletedSessions(TENANT_A, USER_A, { limit: 2, offset: 0 });

      expect(entries).toEqual([]);
      expect(exercisesWhere).not.toHaveBeenCalled();
      expect(setsWhere).not.toHaveBeenCalled();
    });

    it("computes trend via the bounded n+1 lookback row, without an extra query beyond the 3 batch queries", async () => {
      const { select } = createHistoryDb(
        [sessionRowA, sessionRowB, sessionRowC],
        [exerciseRowA, exerciseRowB, exerciseRowC],
        [setRowA, setRowB, setRowC],
      );
      const repo = new WorkoutSessionRepository({ select } as never);

      const entries = await repo.listCompletedSessions(TENANT_A, USER_A, { limit: 2, offset: 0 });

      // A (page[0]) vs its immediate prior B: 100 - 80 = 20, up.
      expect(entries[0]?.trend).toEqual({ volumeDelta: 20, direction: "up" });
      // B (the OLDEST page item) vs the lookback-only row C: 80 - 60 = 20, up.
      // C itself is never returned as a page entry.
      expect(entries[1]?.trend).toEqual({ volumeDelta: 20, direction: "up" });
      expect(entries.some((entry) => entry.session.id === SESSION_C_ID)).toBe(false);
      // Still exactly 3 queries — the lookback row came from the SAME
      // limit+1 page query, not a separate lookback round-trip.
      expect(select).toHaveBeenCalledTimes(3);
    });

    it("omits trend for the last page item when there is no prior session at all (fewer than limit+1 rows returned)", async () => {
      const { select } = createHistoryDb(
        [sessionRowA, sessionRowB],
        [exerciseRowA, exerciseRowB],
        [setRowA, setRowB],
      );
      const repo = new WorkoutSessionRepository({ select } as never);

      const entries = await repo.listCompletedSessions(TENANT_A, USER_A, { limit: 2, offset: 0 });

      expect(entries).toHaveLength(2);
      expect(entries[0]?.trend).toEqual({ volumeDelta: 20, direction: "up" });
      expect(entries[1]?.trend).toBeUndefined();
      expect(select).toHaveBeenCalledTimes(3);
    });

    it("scopes the page query to (tenantId, userId) — a different tenant sees no rows", async () => {
      const { select } = createHistoryDb([], [], []);
      const repo = new WorkoutSessionRepository({ select } as never);

      const entries = await repo.listCompletedSessions(TENANT_B, USER_A, { limit: 2, offset: 0 });

      expect(entries).toEqual([]);
    });

    it("defaults limit to 20 and offset to 0 when the caller omits pagination", async () => {
      const { select, sessionsWhere } = createHistoryDb([], [], []);
      const limitMock = vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) });
      sessionsWhere.mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: limitMock }) });
      const repo = new WorkoutSessionRepository({ select } as never);

      await repo.listCompletedSessions(TENANT_A, USER_A, {});

      // limit+1 lookback row → 21 when the caller's default limit is 20.
      expect(limitMock).toHaveBeenCalledWith(21);
    });
  });
});
