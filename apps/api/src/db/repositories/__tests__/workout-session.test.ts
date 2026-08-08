import { describe, expect, it, vi } from "vitest";
import { SQL } from "drizzle-orm";
import type { WorkoutProgram } from "@kinora/contracts";
import { WorkoutSessionRepository } from "../workout-session.js";
import { planSpecs, sessionExercises, setRecords, workoutPlans, workoutSessions } from "../../schema.js";

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
          notes: "Use dumbbells if machine busy",
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

/** 17b-stale-session-recovery: a stored `abandoned` row, `completedAt` still NULL. */
const abandonedSessionRow = {
  ...sessionRow,
  status: "abandoned" as const,
  completedAt: null,
  updatedAt: new Date("2026-08-02T10:00:00Z"),
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
          for: vi.fn().mockReturnValue({
            then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(nextRows)),
          }),
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

      // 17b: under the 24h threshold (1h after the active session started)
      // so this stays Branch B's conflict rather than falling through to
      // phase 3's auto-close.
      const now = new Date(sessionRow.startedAt.getTime() + 3600_000);
      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 2, now);

      expect(transaction).not.toHaveBeenCalled();
      expect(result?.kind).toBe("conflict");
      if (result?.kind === "conflict") {
        expect(result.activePlanId).toBe(PLAN_ID);
        expect(result.activeDay).toBe(1);
        // F2/risk-CRITICAL: the name is honestly populated from the scoped
        // plan lookup, not left undefined.
        expect(result.activePlanName).toBe("Summer Cut");
        // 17b: the blocking session's own id/date, for the actionable banner.
        expect(result.activeSessionId).toBe(SESSION_ID);
        expect(result.activeStartedAt).toBe(sessionRow.startedAt.toISOString());
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

      const now = new Date(sessionRow.startedAt.getTime() + 3600_000);
      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 2, now);

      expect(result?.kind).toBe("conflict");
      if (result?.kind === "conflict") {
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
      const now = new Date(legacyRow.startedAt.getTime() + 3600_000);
      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1, now);

      expect(transaction).not.toHaveBeenCalled();
      expect(result?.kind).toBe("conflict");
      if (result?.kind === "conflict") {
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
      // Neither title resolves to a catalog record, so #352 slice C leaves this
      // path exactly as it was: the classifier is still what answers.
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

    it("takes muscle_group from the catalog's taxonomy when the title resolves (#352 slice C)", async () => {
      // Both titles resolve to a catalog record, and for both the catalog
      // DISAGREES with the keyword classifier — which is the entire point:
      //   "Barbell Close-Grip Bench Press" -> catalog target `triceps`;
      //      the classifier sees "bench press" and says `chest`.
      //   "Hyperextension"                 -> catalog target `spine` -> back;
      //      the classifier has no keyword for it and says `null`.
      // The prescribed titles are asserted verbatim alongside the groups: the
      // snapshot must never be rewritten to the catalog's spelling.
      const catalogProgram: WorkoutProgram = {
        weeklySessions: [
          {
            day: 1,
            title: "Push",
            exercises: [
              { name: "Barbell Close-Grip Bench Press", sets: 3, reps: "6-8", restSeconds: 120 },
              { name: "Hyperextension", sets: 3, reps: "12", restSeconds: 60 },
            ],
          },
        ],
        limitationWarnings: [],
      };
      const select = createQueuedSelectDb(
        new Map<object, unknown[][]>([
          [workoutSessions, [[]]],
          [workoutPlans, [[{ ...readyPlanRow, programJson: catalogProgram }]]],
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
      const transaction = vi
        .fn()
        .mockImplementation(async (cb: (db: typeof tx) => Promise<unknown>) => cb(tx));
      const repo = new WorkoutSessionRepository({ select, transaction } as never);

      await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);

      const exercisesInsert = insert.mock.results[1]!.value as {
        values: ReturnType<typeof vi.fn>;
      };
      expect(exercisesInsert.values).toHaveBeenCalledWith([
        expect.objectContaining({
          title: "Barbell Close-Grip Bench Press",
          muscleGroup: "triceps",
        }),
        expect.objectContaining({ title: "Hyperextension", muscleGroup: "back" }),
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

    it("17c PR 4 — attaches resolvedBodyweightKg from the injected bodyweight source", async () => {
      const select = createQueuedSelectDb(
        new Map<object, unknown[][]>([
          [workoutSessions, [[completedSessionRow]]],
          [sessionExercises, [exerciseRows]],
          [setRecords, [completedSetRows]],
        ])
      ).select;
      const bodyweightSource = {
        listAllForUser: vi.fn().mockResolvedValue([{ weightKg: 80, recordedAt: "2026-07-01T00:00:00.000Z" }]),
      };
      const repo = new WorkoutSessionRepository({ select } as never, bodyweightSource);

      const result = await repo.findById(TENANT_A, USER_A, SESSION_ID);

      expect(bodyweightSource.listAllForUser).toHaveBeenCalledTimes(1);
      expect(bodyweightSource.listAllForUser).toHaveBeenCalledWith(USER_A);
      expect(result?.resolvedBodyweightKg).toBe(80);
    });

    it("17c PR 4 — leaves resolvedBodyweightKg undefined and issues no extra query when no source is injected", async () => {
      const select = createQueuedSelectDb(
        new Map<object, unknown[][]>([
          [workoutSessions, [[sessionRow]]],
          [sessionExercises, [exerciseRows]],
          [setRecords, [completedSetRows]],
        ])
      ).select;
      const repo = new WorkoutSessionRepository({ select } as never);

      const result = await repo.findById(TENANT_A, USER_A, SESSION_ID);

      expect(result?.resolvedBodyweightKg).toBeUndefined();
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

    it("17b pinned decision 4 — rejects a set write against an abandoned session (findById's status !== 'active' guard already covers it)", async () => {
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[abandonedSessionRow]]],
        [sessionExercises, [exerciseRows]],
        [setRecords, [initialSetRows]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const update = vi.fn();
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.recordSet(TENANT_A, USER_A, SESSION_ID, SET_1_ID, {
        completed: true,
      });

      expect(result).toBeUndefined();
      expect(update).not.toHaveBeenCalled();
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

    it("17b pinned decision 1 — rejects an abandoned session and never writes completed", async () => {
      // The WHERE status='active' guard already excludes an abandoned row (0
      // rows updated); the recovery re-read finds it 'abandoned', which the
      // explicit branch rejects rather than falling through into the
      // completed check.
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[abandonedSessionRow]]],
        [sessionExercises, [exerciseRows]],
        [setRecords, [initialSetRows]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.completeSession(TENANT_A, USER_A, SESSION_ID);

      expect(result).toBeUndefined();
    });
  });

  describe("deleteById", () => {
    /**
     * Build a mock db exposing a `delete` chain (`delete(t).where(...).returning(...)`)
     * alongside the shared queued-select harness for the scoped re-read.
     *
     * `deleteReturning` is the rows the `.returning()` resolves to.
     * `reReadRows` is queued on `workoutSessions` for the disambiguation
     * select that fires only when the delete matches 0 rows.
     */
    function buildDeleteDb(opts: {
      deleteReturning: unknown[];
      reReadRows?: unknown[][];
    }) {
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, opts.reReadRows ?? [[]]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const returning = vi.fn().mockResolvedValue(opts.deleteReturning);
      const where = vi.fn().mockReturnValue({ returning });
      const del = vi.fn().mockReturnValue({ where });
      return { db: { select, delete: del } as never, del, returning };
    }

    it("deletes the caller's own completed session and returns {kind:'deleted'} (cascades via FK onDelete)", async () => {
      const { db, del } = buildDeleteDb({ deleteReturning: [{ id: SESSION_ID }] });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteById(TENANT_A, USER_A, SESSION_ID);

      expect(result).toEqual({ kind: "deleted" });
      expect(del).toHaveBeenCalledTimes(1);
    });

    it("returns {kind:'not_found'} for a nonexistent session id — delete matches 0 rows and the scoped re-read finds nothing", async () => {
      const { db, del } = buildDeleteDb({
        deleteReturning: [],
        reReadRows: [[]], // scoped re-read returns nothing
      });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteById(TENANT_A, USER_A, "no-such-session");

      expect(result).toEqual({ kind: "not_found" });
      expect(del).toHaveBeenCalledTimes(1);
    });

    it("returns {kind:'not_found'} for another user's session — the scoped delete AND scoped re-read never surface the other owner's row (no IDOR)", async () => {
      // USER_B asks for USER_A's session. The delete WHERE is scoped to
      // (tenantId, USER_B, id) → 0 rows. The recovery re-read is scoped
      // identically → 0 rows. USER_B learns nothing about USER_A's session.
      const { db } = buildDeleteDb({
        deleteReturning: [],
        reReadRows: [[]],
      });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteById(TENANT_A, USER_B, SESSION_ID);

      expect(result).toEqual({ kind: "not_found" });
    });

    it("returns {kind:'active_conflict'} for an in-progress session — the status='completed' guard skips it and the scoped re-read surfaces 'active' (R3)", async () => {
      const { db } = buildDeleteDb({
        deleteReturning: [], // status='completed' guard excludes the active row
        reReadRows: [[{ status: "active" }]],
      });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteById(TENANT_A, USER_A, SESSION_ID);

      expect(result).toEqual({ kind: "active_conflict" });
    });

    it("NEGATIVE CONTROL — a cross-tenant delete for another tenant's session returns {kind:'not_found'} (scoped re-read finds nothing for TENANT_B)", async () => {
      const { db } = buildDeleteDb({
        deleteReturning: [],
        reReadRows: [[]],
      });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteById(TENANT_B, USER_A, SESSION_ID);

      expect(result).toEqual({ kind: "not_found" });
    });

    it("17b pinned decision 4 — accepts an abandoned session, never rejecting it as 'in progress'", async () => {
      const { db, del } = buildDeleteDb({ deleteReturning: [{ id: SESSION_ID }] });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteById(TENANT_A, USER_A, SESSION_ID);

      expect(result).toEqual({ kind: "deleted" });
      expect(del).toHaveBeenCalledTimes(1);
    });
  });

  describe("deleteAllByUser", () => {
    function buildBulkDeleteDb(opts: {
      deleteReturning: unknown[];
      activeRows?: unknown[];
      sessionRowsAfterDelete?: unknown[];
      exerciseRowsAfterDelete?: unknown[];
      setRowsAfterDelete?: unknown[];
    }) {
      const activeRows = opts.activeRows ?? [];
      const sessionRowsAfterDelete = opts.sessionRowsAfterDelete ?? [];
      const exerciseRowsAfterDelete = opts.exerciseRowsAfterDelete ?? [];
      const setRowsAfterDelete = opts.setRowsAfterDelete ?? [];

      const select = vi.fn().mockImplementation((shape?: unknown) => {
        const hasStatusShape =
          typeof shape === "object" &&
          shape !== null &&
          "status" in (shape as Record<string, unknown>);

        return {
          from: vi.fn().mockImplementation((table: object) => {
            if (table !== workoutSessions && table !== sessionExercises && table !== setRecords) {
              return {
                where: vi.fn().mockReturnValue({
                  for: vi.fn().mockResolvedValue([]),
                }),
              };
            }
            if (table === workoutSessions) {
              if (hasStatusShape) {
                return { where: vi.fn().mockResolvedValue(activeRows) };
              }
              return { where: vi.fn().mockResolvedValue(sessionRowsAfterDelete) };
            }
            if (table === sessionExercises) {
              return { where: vi.fn().mockResolvedValue(exerciseRowsAfterDelete) };
            }
            if (table === setRecords) {
              return { where: vi.fn().mockResolvedValue(setRowsAfterDelete) };
            }
            throw new Error(`Unexpected select table: ${String(table)}`);
          }),
        };
      });

      const returning = vi.fn().mockResolvedValue(opts.deleteReturning);
      const where = vi.fn().mockReturnValue({ returning });
      const del = vi.fn().mockReturnValue({ where });
      const transaction = vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ select, delete: del }));

      return { db: { select, delete: del, transaction } as never, del, select, transaction };
    }

    it("deletes all completed sessions owned by the caller, returns the deleted count, and leaves no cascaded exercise/set rows behind", async () => {
      const sessionA = { id: SESSION_ID };
      const sessionB = { id: "dddddddd-0000-0000-0000-000000000099" };
      const { db, del, select } = buildBulkDeleteDb({
        deleteReturning: [sessionA, sessionB],
      });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteAllByUser(TENANT_A, USER_A);

      expect(result).toEqual({ kind: "deleted", deletedCount: 2 });
      expect(del).toHaveBeenCalledTimes(1);
      expect(select).toHaveBeenCalledTimes(2);
      expect(select.mock.invocationCallOrder[0]).toBeLessThan(del.mock.invocationCallOrder[0]!);
    });

    it("returns count 0 when the caller has no completed sessions", async () => {
      const { db } = buildBulkDeleteDb({ deleteReturning: [] });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteAllByUser(TENANT_A, USER_A);

      expect(result).toEqual({ kind: "deleted", deletedCount: 0 });
    });

    it("returns conflict and preserves completed history when an active session exists for the scoped tenant/user", async () => {
      const { db, del, transaction } = buildBulkDeleteDb({
        deleteReturning: [{ id: SESSION_ID }],
        activeRows: [{ status: "active" }],
      });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteAllByUser(TENANT_A, USER_A);

      expect(result).toEqual({ kind: "active_conflict" });
      expect(del).not.toHaveBeenCalled();
      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it("does not leak another user's sessions in the same tenant — scoped delete returns count 0 and no active conflict", async () => {
      const { db } = buildBulkDeleteDb({ deleteReturning: [] });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteAllByUser(TENANT_A, USER_B);

      expect(result).toEqual({ kind: "deleted", deletedCount: 0 });
    });

    it("17b pinned decision 4 — deletes abandoned sessions alongside completed ones", async () => {
      const abandoned = { id: "dddddddd-0000-0000-0000-000000000098" };
      const completed = { id: SESSION_ID };
      const { db, del } = buildBulkDeleteDb({ deleteReturning: [abandoned, completed] });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.deleteAllByUser(TENANT_A, USER_A);

      expect(result).toEqual({ kind: "deleted", deletedCount: 2 });
      expect(del).toHaveBeenCalledTimes(1);
    });
  });

  describe("abandonSession (17b Discard)", () => {
    function buildAbandonDb(opts: { updateReturning: unknown[]; reReadRows?: unknown[][] }) {
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, opts.reReadRows ?? [[]]],
        [sessionExercises, [exerciseRows]],
        [setRecords, [initialSetRows]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const returning = vi.fn().mockResolvedValue(opts.updateReturning);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      return { db: { select, update } as never, update };
    }

    it("transitions an active session to abandoned and returns { kind: 'abandoned', session }", async () => {
      const { db, update } = buildAbandonDb({
        updateReturning: [{ id: SESSION_ID }],
        reReadRows: [[abandonedSessionRow]],
      });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.abandonSession(TENANT_A, USER_A, SESSION_ID);

      expect(update).toHaveBeenCalledTimes(1);
      expect(result.kind).toBe("abandoned");
      if (result.kind === "abandoned") {
        expect(result.session.status).toBe("abandoned");
      }
    });

    it("idempotent retry — an already-abandoned session is a 200 no-op, not a 404", async () => {
      // The status='active' guard on the UPDATE matches 0 rows on retry; the
      // scoped re-read finds the row already 'abandoned' and returns it.
      const { db } = buildAbandonDb({
        updateReturning: [],
        reReadRows: [[abandonedSessionRow]],
      });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.abandonSession(TENANT_A, USER_A, SESSION_ID);

      expect(result.kind).toBe("abandoned");
    });

    it("returns { kind: 'not_active' } for a completed session", async () => {
      const { db } = buildAbandonDb({
        updateReturning: [],
        reReadRows: [[completedSessionRow]],
      });
      const repo = new WorkoutSessionRepository(db);

      const result = await repo.abandonSession(TENANT_A, USER_A, SESSION_ID);

      expect(result).toEqual({ kind: "not_active" });
    });

    it("returns { kind: 'not_found' } for a nonexistent id, indistinguishable from another tenant/user's session (no IDOR leak)", async () => {
      const { db } = buildAbandonDb({ updateReturning: [], reReadRows: [[]] });
      const repo = new WorkoutSessionRepository(db);

      const notFound = await repo.abandonSession(TENANT_A, USER_A, "no-such-session");
      expect(notFound).toEqual({ kind: "not_found" });

      const { db: dbCrossTenant } = buildAbandonDb({ updateReturning: [], reReadRows: [[]] });
      const crossTenantRepo = new WorkoutSessionRepository(dbCrossTenant);
      const crossTenant = await crossTenantRepo.abandonSession(TENANT_B, USER_A, SESSION_ID);
      expect(crossTenant).toEqual({ kind: "not_found" });
    });
  });

  describe("listSessionHistory", () => {
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

      const entries = await repo.listSessionHistory(TENANT_A, USER_A, { limit: 2, offset: 0 });

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

    it("17c PR 4 — resolves the whole page's bodyweight in ONE batched read and reflects it in totalVolume", async () => {
      const bodyweightSetA = { ...setRowA, weightKg: null, actualReps: 12 };
      const { select } = createHistoryDb(
        [sessionRowA, sessionRowB, sessionRowC],
        [exerciseRowA, exerciseRowB, exerciseRowC],
        [bodyweightSetA, setRowB, setRowC],
      );
      const bodyweightSource = {
        listAllForUser: vi.fn().mockResolvedValue([{ weightKg: 80, recordedAt: "2026-07-01T00:00:00.000Z" }]),
      };
      const repo = new WorkoutSessionRepository({ select } as never, bodyweightSource);

      const entries = await repo.listSessionHistory(TENANT_A, USER_A, { limit: 2, offset: 0 });

      // One weight-series read for the entire page (3 rows including the
      // lookback), never one per session.
      expect(bodyweightSource.listAllForUser).toHaveBeenCalledTimes(1);
      expect(entries[0]?.session.id).toBe(SESSION_A_ID);
      expect(entries[0]?.totalVolume).toBe(80 * 12);
    });

    it("returns an empty page when the caller has no completed sessions, issuing no follow-up queries", async () => {
      const { select, exercisesWhere, setsWhere } = createHistoryDb([], [], []);
      const repo = new WorkoutSessionRepository({ select } as never);

      const entries = await repo.listSessionHistory(TENANT_A, USER_A, { limit: 2, offset: 0 });

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

      const entries = await repo.listSessionHistory(TENANT_A, USER_A, { limit: 2, offset: 0 });

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

      const entries = await repo.listSessionHistory(TENANT_A, USER_A, { limit: 2, offset: 0 });

      expect(entries).toHaveLength(2);
      expect(entries[0]?.trend).toEqual({ volumeDelta: 20, direction: "up" });
      expect(entries[1]?.trend).toBeUndefined();
      expect(select).toHaveBeenCalledTimes(3);
    });

    it("scopes the page query to (tenantId, userId) — a different tenant sees no rows", async () => {
      const { select } = createHistoryDb([], [], []);
      const repo = new WorkoutSessionRepository({ select } as never);

      const entries = await repo.listSessionHistory(TENANT_B, USER_A, { limit: 2, offset: 0 });

      expect(entries).toEqual([]);
    });

    it("defaults limit to 20 and offset to 0 when the caller omits pagination", async () => {
      const { select, sessionsWhere } = createHistoryDb([], [], []);
      const limitMock = vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) });
      sessionsWhere.mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: limitMock }) });
      const repo = new WorkoutSessionRepository({ select } as never);

      await repo.listSessionHistory(TENANT_A, USER_A, {});

      // limit+1 lookback row → 21 when the caller's default limit is 20.
      expect(limitMock).toHaveBeenCalledWith(21);
    });

    // 17b-stale-session-recovery PR 3: history widens from completed-only to
    // completed + abandoned. The mocked db here trusts whatever order it is
    // handed (the real `coalesce(completed_at, started_at) DESC` ordering is
    // proven against real Postgres in workout-session.integration.test.ts);
    // this suite pins the pure pairing/volume logic that runs over that order.
    function buildAbandonedSessionRow(id: string, startedAt: Date) {
      return {
        id,
        tenantId: TENANT_A,
        userId: USER_A,
        workoutPlanId: PLAN_ID,
        status: "abandoned" as const,
        day: 1,
        startedAt,
        completedAt: null,
      };
    }

    it("excludes an abandoned entry from the completed trend chain and gives it no trend of its own", async () => {
      const EXERCISE_ABANDONED_ID = "eeeeeeee-0000-0000-0000-00000000d004";
      const abandonedRow = buildAbandonedSessionRow(
        "dddddddd-0000-0000-0000-0000000000d4",
        new Date("2026-07-09T09:00:00Z"), // between A and B
      );
      const exerciseRowAbandoned = {
        ...exerciseRowA,
        id: EXERCISE_ABANDONED_ID,
        workoutSessionId: abandonedRow.id,
      };
      // Only 1 of the plan's sets was ever logged before discard/auto-close.
      const setRowAbandoned = buildSetRow(
        "ffffffff-0000-0000-0000-00000000d004",
        EXERCISE_ABANDONED_ID,
        "20.00",
        9,
      );

      const { select } = createHistoryDb(
        // Newest-first, as `coalesce(completed_at, started_at) DESC` would
        // return it: A (completed) → abandoned (between A and B) → B
        // (completed) → C (completed, the +1 lookback row).
        [sessionRowA, abandonedRow, sessionRowB, sessionRowC],
        [exerciseRowA, exerciseRowAbandoned, exerciseRowB, exerciseRowC],
        [setRowA, setRowAbandoned, setRowB, setRowC],
      );
      const repo = new WorkoutSessionRepository({ select } as never);

      const entries = await repo.listSessionHistory(TENANT_A, USER_A, { limit: 3, offset: 0 });

      expect(entries).toHaveLength(3);
      const [entryA, entryAbandoned, entryB] = entries;
      expect(entryA?.session.id).toBe(SESSION_A_ID);
      expect(entryAbandoned?.session.id).toBe(abandonedRow.id);
      expect(entryB?.session.id).toBe(SESSION_B_ID);

      // The abandoned entry is never given a trend of its own.
      expect(entryAbandoned?.trend).toBeUndefined();
      // The abandoned entry is truthful about the one set it actually logged.
      expect(entryAbandoned?.totalVolume).toBe(20 * 10);
      expect(entryAbandoned?.averageRpe).toBe(9);

      // A's trend pairs with the next COMPLETED session (B), skipping the
      // abandoned row that sits between them in fetch order — the naive
      // `records[index + 1]` pairing this replaces would have compared A
      // against the abandoned 1-set session and reported a huge, false drop.
      expect(entryA?.trend).toEqual({ volumeDelta: 20, direction: "up" });
      // B's trend still pairs with the completed lookback row C, unaffected
      // by the abandoned row's presence earlier in the page.
      expect(entryB?.trend).toEqual({ volumeDelta: 20, direction: "up" });
    });
  });

  describe("getDashboardSummary", () => {
    // Fixed "now" — Friday of the week 2026-07-13 (Mon) .. 2026-07-19 (Sun).
    const NOW = new Date("2026-07-17T12:00:00.000Z");

    const DASH_SESSION_TODAY = "aaaaaaaa-1111-0000-0000-000000000001";
    const DASH_SESSION_MON = "aaaaaaaa-1111-0000-0000-000000000002";
    const DASH_EXERCISE_MON = "bbbbbbbb-1111-0000-0000-000000000001";
    const DASH_SET_MON = "cccccccc-1111-0000-0000-000000000001";

    const dashProgram: WorkoutProgram = {
      weeklySessions: [
        { day: 1, title: "Tirón técnico", exercises: [{ name: "Row", sets: 1, reps: "10", restSeconds: 60 }] },
        { day: 2, title: "Pierna ligera", exercises: [{ name: "Squat", sets: 1, reps: "10", restSeconds: 60 }] },
      ],
      limitationWarnings: [],
    };

    const dashReadyPlanRow = {
      ...readyPlanRow,
      programJson: dashProgram,
    };

    function buildDashSessionRow(id: string, completedAt: Date) {
      return {
        id,
        tenantId: TENANT_A,
        userId: USER_A,
        workoutPlanId: PLAN_ID,
        status: "completed" as const,
        day: 1,
        startedAt: new Date(completedAt.getTime() - 30 * 60 * 1000),
        completedAt,
      };
    }

    const dashSessionToday = buildDashSessionRow(DASH_SESSION_TODAY, new Date("2026-07-17T08:00:00Z"));
    const dashSessionMon = buildDashSessionRow(DASH_SESSION_MON, new Date("2026-07-13T08:00:00Z"));

    const dashExerciseMon = {
      id: DASH_EXERCISE_MON,
      workoutSessionId: DASH_SESSION_MON,
      exerciseIndex: 0,
      title: "Row",
      restSeconds: 60,
      notes: null,
    };
    const dashSetMon = {
      id: DASH_SET_MON,
      sessionExerciseId: DASH_EXERCISE_MON,
      setIndex: 0,
      targetReps: "10",
      actualReps: 10,
      weightKg: "50.00",
      rpe: 7,
      completed: true,
      notes: null,
    };

    function createDashboardDb(input: {
      sessionRows: unknown[];
      planRows: unknown[];
      exerciseRows?: unknown[];
      setRows?: unknown[];
      /**
       * 14b-v1.1 — the confirmed plan_specs row backing `latestReadyPlan`, read
       * ONLY when the RPE fold runs (adherence not `"low"` and there IS a
       * ready plan with at least one completed session). Defaults to a spec
       * with no `intensityBias` (→ `"maintain"`).
       */
      specRows?: unknown[];
    }) {
      const sessionsWhere = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(input.sessionRows) }),
      });
      const plansWhere = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(input.planRows) }),
      });
      const exercisesWhere = vi.fn().mockResolvedValue(input.exerciseRows ?? []);
      const setsWhere = vi.fn().mockResolvedValue(input.setRows ?? []);
      const specWhere = vi.fn().mockResolvedValue(input.specRows ?? [{ specJson: {} }]);

      const select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((table: object) => {
          if (table === workoutSessions) return { where: sessionsWhere };
          if (table === workoutPlans) return { where: plansWhere };
          if (table === sessionExercises) return { where: exercisesWhere };
          if (table === setRecords) return { where: setsWhere };
          if (table === planSpecs) return { where: specWhere };
          throw new Error(`Unexpected select table: ${String(table)}`);
        }),
      }));

      return { select, sessionsWhere, plansWhere, exercisesWhere, setsWhere, specWhere };
    }

    it("returns the empty-state DTO when there is no history and no ready plan", async () => {
      const { select } = createDashboardDb({ sessionRows: [], planRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getDashboardSummary(TENANT_A, USER_A, NOW);

      expect(summary.streak).toBe(0);
      expect(summary.weeklyCompleted).toBe(0);
      expect(summary.weeklyPlanned).toBe(0);
      expect(summary.weeklyRollup).toEqual([]);
      expect(summary.recentDailyCompletion).toEqual([false, false, false, false, false, false, false]);
    });

    it("computes streak, weekly progress, and weekly rollup from bounded queries", async () => {
      const { select, sessionsWhere, plansWhere } = createDashboardDb({
        sessionRows: [dashSessionToday, dashSessionMon],
        planRows: [dashReadyPlanRow],
        exerciseRows: [dashExerciseMon],
        setRows: [dashSetMon],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getDashboardSummary(TENANT_A, USER_A, NOW);

      expect(summary.streak).toBe(1);
      expect(summary.weeklyCompleted).toBe(2);
      expect(summary.weeklyPlanned).toBe(2);
      expect(summary.weeklyRollup).toEqual([
        { dayIndex: 0, focus: "Tirón técnico", loadKg: 500, loadPercent: 100 },
        { dayIndex: 1, focus: "Pierna ligera", loadKg: 0, loadPercent: 0 },
      ]);
      // Bounded: sessions(1) + plans(1) + weekly-rollup exercises/sets(2) +
      // 14b RPE-fold exercises/sets/planSpec(3) — adherence is
      // insufficient_data here (dashReadyPlanRow is younger than the window),
      // so the RPE fold runs.
      expect(select).toHaveBeenCalledTimes(7);
      expect(sessionsWhere).toHaveBeenCalledTimes(1);
      expect(plansWhere).toHaveBeenCalledTimes(1);
    });

    it("17c PR 4 — weekly rollup reflects a resolved bodyweight for a weightless set", async () => {
      const bodyweightSetMon = { ...dashSetMon, weightKg: null, actualReps: 15 };
      const { select } = createDashboardDb({
        sessionRows: [dashSessionMon],
        planRows: [dashReadyPlanRow],
        exerciseRows: [dashExerciseMon],
        setRows: [bodyweightSetMon],
      });
      const bodyweightSource = {
        listAllForUser: vi.fn().mockResolvedValue([{ weightKg: 80, recordedAt: "2026-07-01T00:00:00.000Z" }]),
      };
      const repo = new WorkoutSessionRepository({ select } as never, bodyweightSource);

      const summary = await repo.getDashboardSummary(TENANT_A, USER_A, NOW);

      // One batched read regardless of how many sessions fall in the week.
      expect(bodyweightSource.listAllForUser).toHaveBeenCalledTimes(1);
      expect(bodyweightSource.listAllForUser).toHaveBeenCalledWith(USER_A);
      const mondayRow = summary.weeklyRollup.find((row) => row.dayIndex === 0);
      expect(mondayRow?.loadKg).toBe(80 * 15);
    });

    it("skips the exercise/set/RPE follow-up queries when there is no completed session at all", async () => {
      const { select, exercisesWhere, setsWhere, specWhere } = createDashboardDb({
        sessionRows: [],
        planRows: [dashReadyPlanRow],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      await repo.getDashboardSummary(TENANT_A, USER_A, NOW);

      expect(exercisesWhere).not.toHaveBeenCalled();
      expect(setsWhere).not.toHaveBeenCalled();
      // No completed session at all → the RPE fold has nothing to analyze
      // and is skipped entirely (no planSpecs round-trip either).
      expect(specWhere).not.toHaveBeenCalled();
      expect(select).toHaveBeenCalledTimes(2);
    });

    it("scopes both queries to (tenantId, userId) — a different tenant sees the empty state", async () => {
      const { select } = createDashboardDb({ sessionRows: [], planRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getDashboardSummary(TENANT_B, USER_A, NOW);

      expect(summary.weeklyCompleted).toBe(0);
      expect(summary.weeklyPlanned).toBe(0);
    });

    // 14a-v1.1 Slice A2 — the read folds a pure adherence adaptation
    // recommendation into the DTO. windowStart for NOW (2026-07-17) is
    // 2026-06-19T00:00:00Z (28 days back); the current UTC week is
    // 2026-07-13..2026-07-19. In-window/out-of-current-week completions keep
    // the exercise/set follow-up queries out of the way so we can assert the
    // read adds ZERO extra round-trip (and consumes no quota — the repo has no
    // billing dependency on this path at all).
    const ADAPT_PLAN_CREATED_BEFORE_WINDOW = new Date("2026-05-01T08:00:00Z");

    function buildProgramWithDays(days: number): WorkoutProgram {
      return {
        weeklySessions: Array.from({ length: days }, (_unused, index) => ({
          day: index + 1,
          title: `Day ${index + 1}`,
          exercises: [{ name: "Row", sets: 1, reps: "10", restSeconds: 60 }],
        })),
        limitationWarnings: [],
      };
    }

    function buildInWindowSessions(dates: string[], prefix: string) {
      return dates.map((date, index) =>
        buildDashSessionRow(`${prefix}${index + 1}`, new Date(`${date}T08:00:00Z`))
      );
    }

    it("attaches a low-adherence adaptation with source, suggestedChange, planSpecId and rationaleKey", async () => {
      const lowPlanRow = {
        ...readyPlanRow,
        planSpecId: "spec-low-1",
        programJson: buildProgramWithDays(4),
        createdAt: ADAPT_PLAN_CREATED_BEFORE_WINDOW,
      };
      // 5 completions inside [2026-06-19, 2026-07-17] but before the current
      // week (2026-07-13) → 5 / (4 * 4) = 31.25% < 70% → low.
      const lowSessions = buildInWindowSessions(
        ["2026-06-20", "2026-06-25", "2026-07-01", "2026-07-05", "2026-07-10"],
        "aaaaaaaa-2222-0000-0000-00000000000"
      );
      const { select } = createDashboardDb({ sessionRows: lowSessions, planRows: [lowPlanRow] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getDashboardSummary(TENANT_A, USER_A, NOW);

      expect(summary.adaptation).toBeDefined();
      expect(summary.adaptation!.source).toBe("adherence");
      expect(summary.adaptation!.level).toBe("low");
      expect(summary.adaptation!.suggestedChange).toEqual({
        kind: "reduce_frequency",
        fromDays: 4,
        toDays: 3,
      });
      expect(summary.adaptation!.planSpecId).toBe("spec-low-1");
      expect(summary.adaptation!.rationaleKey).toBe("adaptation.adherence.reduceFrequency");
      expect(summary.adaptation!.adherence).toMatchObject({
        periodWeeks: 4,
        completedInWindow: 5,
        plannedInWindow: 16,
      });
      // Pre-existing dashboard fields remain intact and additive — the
      // recommendation never mutates the week board (no "missed" state).
      expect(summary.weeklyPlanned).toBe(4);
      // No new DB round-trip and no quota consumer: still exactly the two
      // lookup queries (sessions, plans); no billing table is ever selected.
      expect(select).toHaveBeenCalledTimes(2);
    });

    it("attaches an ok adaptation with no suggestedChange at/above the threshold", async () => {
      const okPlanRow = {
        ...readyPlanRow,
        planSpecId: "spec-ok-1",
        programJson: buildProgramWithDays(1),
        createdAt: ADAPT_PLAN_CREATED_BEFORE_WINDOW,
      };
      // 3 completions / (1 * 4) = 75% >= 70% → ok.
      const okSessions = buildInWindowSessions(
        ["2026-06-20", "2026-07-01", "2026-07-10"],
        "aaaaaaaa-3333-0000-0000-00000000000"
      );
      const { select } = createDashboardDb({ sessionRows: okSessions, planRows: [okPlanRow] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getDashboardSummary(TENANT_A, USER_A, NOW);

      expect(summary.adaptation!.source).toBe("adherence");
      expect(summary.adaptation!.level).toBe("ok");
      expect(summary.adaptation!.suggestedChange).toBeUndefined();
      expect(summary.adaptation!.rationaleKey).toBeUndefined();
      expect(summary.adaptation!.planSpecId).toBe("spec-ok-1");
      // adherence "ok" (not "low") → the RPE fold still runs (2 more selects:
      // RPE-window exercises + planSpec; the sets query is skipped because no
      // exercise rows are stubbed here) but finds no rated sets at all →
      // insufficient_data → does NOT override the adherence-sourced slot.
      expect(select).toHaveBeenCalledTimes(4);
    });

    it("reports insufficient_data when the latest ready plan is younger than the window", async () => {
      // dashReadyPlanRow.createdAt (2026-07-04) is inside the window, so the
      // user has not had a full window to adhere → insufficient_data.
      const { select } = createDashboardDb({
        sessionRows: [dashSessionMon],
        planRows: [dashReadyPlanRow],
        exerciseRows: [dashExerciseMon],
        setRows: [dashSetMon],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getDashboardSummary(TENANT_A, USER_A, NOW);

      expect(summary.adaptation!.level).toBe("insufficient_data");
      expect(summary.adaptation!.suggestedChange).toBeUndefined();
      expect(summary.adaptation!.adherence).toBeUndefined();
    });

    // 14b-v1.1 Slice A3 — RPE fold + adherence-wins precedence. Builds
    // sessionExercises/setRecords rows for the last N completed sessions so
    // computeRpeAdaptation has a real window to aggregate.
    function buildRpeExerciseAndSetRows(sessionIds: string[], rpePerSession: number[][]) {
      const exerciseRows: unknown[] = [];
      const setRows: unknown[] = [];
      sessionIds.forEach((sessionId, sessionIndex) => {
        const exerciseId = `rpe-ex-${sessionIndex}`;
        exerciseRows.push({
          id: exerciseId,
          workoutSessionId: sessionId,
          exerciseIndex: 0,
          title: "Squat",
          restSeconds: 90,
          notes: null,
          muscleGroup: null,
        });
        (rpePerSession[sessionIndex] ?? []).forEach((rpe, setIndex) => {
          setRows.push({
            id: `rpe-set-${sessionIndex}-${setIndex}`,
            sessionExerciseId: exerciseId,
            setIndex,
            targetReps: "8",
            actualReps: 8,
            weightKg: "50.00",
            rpe,
            completed: true,
            notes: null,
          });
        });
      });
      return { exerciseRows, setRows };
    }

    it("surfaces an rpe adjust_load(decrease) recommendation when adherence is ok and the RPE trend is too hard", async () => {
      const okPlanRow = {
        ...readyPlanRow,
        planSpecId: "spec-ok-1",
        programJson: buildProgramWithDays(1),
        createdAt: ADAPT_PLAN_CREATED_BEFORE_WINDOW,
      };
      const okSessions = buildInWindowSessions(
        ["2026-06-20", "2026-07-01", "2026-07-10"],
        "aaaaaaaa-3333-0000-0000-00000000000"
      );
      const { exerciseRows, setRows } = buildRpeExerciseAndSetRows(
        okSessions.map((row) => row.id),
        [[9, 9], [9, 9], [9, 9]]
      );
      const { select } = createDashboardDb({
        sessionRows: okSessions,
        planRows: [okPlanRow],
        exerciseRows,
        setRows,
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getDashboardSummary(TENANT_A, USER_A, NOW);

      expect(summary.adaptation!.source).toBe("rpe");
      expect(summary.adaptation!.level).toBe("low");
      expect(summary.adaptation!.suggestedChange).toEqual({
        kind: "adjust_load",
        direction: "decrease",
        from: "maintain",
        to: "reduce",
      });
      expect(summary.adaptation!.rationaleKey).toBe("adaptation.rpe.reduceLoad");
      expect(summary.adaptation!.planSpecId).toBe("spec-ok-1");
      expect(summary.adaptation!.rpe).toMatchObject({ meanRpe: 9, sessionsWithRpe: 3, setsWithRpe: 6 });
      // Pre-existing weekly board fields are untouched by the RPE override.
      expect(summary.weeklyPlanned).toBe(1);
    });

    it("adherence-low precedence suppresses the RPE signal even when the RPE trend is also actionable", async () => {
      const lowPlanRow = {
        ...readyPlanRow,
        planSpecId: "spec-low-1",
        programJson: buildProgramWithDays(4),
        createdAt: ADAPT_PLAN_CREATED_BEFORE_WINDOW,
      };
      const lowSessions = buildInWindowSessions(
        ["2026-06-20", "2026-06-25", "2026-07-01", "2026-07-05", "2026-07-10"],
        "aaaaaaaa-2222-0000-0000-00000000000"
      );
      const { exerciseRows, setRows } = buildRpeExerciseAndSetRows(
        lowSessions.map((row) => row.id),
        [[9, 9], [9, 9], [9, 9], [9, 9], [9, 9]]
      );
      const { select, specWhere } = createDashboardDb({
        sessionRows: lowSessions,
        planRows: [lowPlanRow],
        exerciseRows,
        setRows,
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getDashboardSummary(TENANT_A, USER_A, NOW);

      // Adherence is "low" (31.25% < 70%) — it wins the single slot; the RPE
      // policy is never even invoked (no planSpecs round-trip for its bias).
      expect(summary.adaptation!.source).toBe("adherence");
      expect(summary.adaptation!.suggestedChange).toEqual({
        kind: "reduce_frequency",
        fromDays: 4,
        toDays: 3,
      });
      expect(specWhere).not.toHaveBeenCalled();
    });

    it("reports insufficient_data with no planSpecId when there is no active ready plan", async () => {
      const { select } = createDashboardDb({ sessionRows: [], planRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getDashboardSummary(TENANT_A, USER_A, NOW);

      expect(summary.adaptation!.source).toBe("adherence");
      expect(summary.adaptation!.level).toBe("insufficient_data");
      expect(summary.adaptation!.planSpecId).toBeUndefined();
      expect(summary.adaptation!.suggestedChange).toBeUndefined();
    });
  });

  describe("getClientDashboard", () => {
    // Fixed "now" — Friday of the week 2026-07-13 (Mon) .. 2026-07-19 (Sun),
    // matching the getDashboardSummary fixture above.
    const NOW = new Date("2026-07-17T12:00:00.000Z");

    const CD_SESSION_1_ID = "aaaaaaaa-3333-0000-0000-000000000001";
    const CD_EXERCISE_1_ID = "bbbbbbbb-3333-0000-0000-000000000001";
    const CD_SET_1_ID = "cccccccc-3333-0000-0000-000000000001";

    const cdProgram: WorkoutProgram = {
      weeklySessions: [{ day: 1, title: "Full Body", exercises: [{ name: "Squat", sets: 1, reps: "5", restSeconds: 120 }] }],
      limitationWarnings: [],
    };

    const cdReadyPlanRow = { ...readyPlanRow, programJson: cdProgram };

    function buildCdSessionRow(id: string, completedAt: Date) {
      return {
        id,
        tenantId: TENANT_A,
        userId: USER_A,
        workoutPlanId: PLAN_ID,
        status: "completed" as const,
        day: 1,
        startedAt: new Date(completedAt.getTime() - 30 * 60 * 1000),
        completedAt,
      };
    }

    const cdSession1 = buildCdSessionRow(CD_SESSION_1_ID, new Date("2026-07-15T09:00:00Z"));

    const cdExercise1 = {
      id: CD_EXERCISE_1_ID,
      workoutSessionId: CD_SESSION_1_ID,
      exerciseIndex: 0,
      title: "Squat",
      restSeconds: 120,
      notes: null,
    };
    const cdSet1 = {
      id: CD_SET_1_ID,
      sessionExerciseId: CD_EXERCISE_1_ID,
      setIndex: 0,
      targetReps: "5",
      actualReps: 5,
      weightKg: "100.00",
      rpe: 8,
      completed: true,
      notes: null,
    };
    const cdSet2 = { ...cdSet1, id: "cccccccc-3333-0000-0000-000000000002", setIndex: 1, rpe: 9 };

    function createClientDashboardDb(input: {
      sessionRows: unknown[];
      planRows: unknown[];
      exerciseRows?: unknown[];
      setRows?: unknown[];
    }) {
      const sessionsWhere = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(input.sessionRows) }),
      });
      const plansWhere = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(input.planRows) }),
      });
      const exercisesWhere = vi.fn().mockResolvedValue(input.exerciseRows ?? []);
      const setsWhere = vi.fn().mockResolvedValue(input.setRows ?? []);

      const select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((table: object) => {
          if (table === workoutSessions) return { where: sessionsWhere };
          if (table === workoutPlans) return { where: plansWhere };
          if (table === sessionExercises) return { where: exercisesWhere };
          if (table === setRecords) return { where: setsWhere };
          throw new Error(`Unexpected select table: ${String(table)}`);
        }),
      }));

      return { select, sessionsWhere, plansWhere, exercisesWhere, setsWhere };
    }

    it("1.6 returns the empty-state DTO when there is no history and no ready plan", async () => {
      const { select } = createClientDashboardDb({ sessionRows: [], planRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const dashboard = await repo.getClientDashboard(TENANT_A, USER_A, NOW);

      expect(dashboard.rpeTrend).toHaveLength(8);
      expect(dashboard.rpeTrend.every((point) => point.meanRpe === null)).toBe(true);
      expect(dashboard.completionRate).toEqual({ periodDays: 28, planned: 0, completed: 0, percent: 0 });
      expect(dashboard.recentSessions).toEqual([]);
    });

    it("1.7 aggregates rpeTrend/completionRate/recentSessions from the caller's own completed sessions", async () => {
      const { select } = createClientDashboardDb({
        sessionRows: [cdSession1],
        planRows: [cdReadyPlanRow],
        exerciseRows: [cdExercise1],
        setRows: [cdSet1, cdSet2],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const dashboard = await repo.getClientDashboard(TENANT_A, USER_A, NOW);

      // The current week's bucket (2026-07-13) aggregates both rated sets (8, 9).
      const currentWeekBucket = dashboard.rpeTrend[7]!;
      expect(currentWeekBucket.meanRpe).toBeCloseTo(8.5, 5);
      expect(currentWeekBucket.sessionsWithRpe).toBe(1);

      // plannedSessionsPerWeek=1 -> planned=4; 1 completion in the 28-day window.
      expect(dashboard.completionRate).toEqual({ periodDays: 28, planned: 4, completed: 1, percent: 25 });

      expect(dashboard.recentSessions).toEqual([
        { date: "2026-07-15T09:00:00.000Z", volumeKg: 1000, meanRpe: 8.5 },
      ]);
    });

    it("17c PR 4 — recentSessions[].volumeKg reflects a resolved bodyweight for a weightless set", async () => {
      const bodyweightSet = { ...cdSet1, weightKg: null, actualReps: 12 };
      const { select } = createClientDashboardDb({
        sessionRows: [cdSession1],
        planRows: [cdReadyPlanRow],
        exerciseRows: [cdExercise1],
        setRows: [bodyweightSet],
      });
      const bodyweightSource = {
        listAllForUser: vi.fn().mockResolvedValue([{ weightKg: 70, recordedAt: "2026-07-01T00:00:00.000Z" }]),
      };
      const repo = new WorkoutSessionRepository({ select } as never, bodyweightSource);

      const dashboard = await repo.getClientDashboard(TENANT_A, USER_A, NOW);

      expect(bodyweightSource.listAllForUser).toHaveBeenCalledTimes(1);
      expect(dashboard.recentSessions).toEqual([
        { date: "2026-07-15T09:00:00.000Z", volumeKg: 70 * 12, meanRpe: 8 },
      ]);
    });

    it("1.6/req3 tenant-safe by construction — reading a different tenant returns the empty state (real filtering proven in the Postgres integration test)", async () => {
      const { select } = createClientDashboardDb({ sessionRows: [], planRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const dashboard = await repo.getClientDashboard(TENANT_B, USER_A, NOW);

      expect(dashboard.recentSessions).toEqual([]);
      expect(dashboard.completionRate.completed).toBe(0);
    });
  });

  describe("getStatsRange", () => {
    // Fixed "now" — mid-month, so the current/previous month split is unambiguous.
    const NOW = new Date("2026-07-17T12:00:00.000Z");

    const STATS_SESSION_CURRENT = "aaaaaaaa-2222-0000-0000-000000000001";
    const STATS_EXERCISE_CURRENT = "bbbbbbbb-2222-0000-0000-000000000001";
    const STATS_SET_CURRENT = "cccccccc-2222-0000-0000-000000000001";

    const STATS_SESSION_PREVIOUS = "aaaaaaaa-2222-0000-0000-000000000002";
    const STATS_EXERCISE_PREVIOUS = "bbbbbbbb-2222-0000-0000-000000000002";
    const STATS_SET_PREVIOUS = "cccccccc-2222-0000-0000-000000000002";

    function buildStatsSessionRow(id: string, startedAt: Date, completedAt: Date) {
      return {
        id,
        tenantId: TENANT_A,
        userId: USER_A,
        workoutPlanId: PLAN_ID,
        status: "completed" as const,
        day: 1,
        startedAt,
        completedAt,
      };
    }

    // July 2026 (current month) session: 60 min duration, 500kg volume.
    const statsSessionCurrent = buildStatsSessionRow(
      STATS_SESSION_CURRENT,
      new Date("2026-07-10T08:00:00Z"),
      new Date("2026-07-10T09:00:00Z")
    );
    // June 2026 (previous month) session: 30 min duration, 200kg volume.
    const statsSessionPrevious = buildStatsSessionRow(
      STATS_SESSION_PREVIOUS,
      new Date("2026-06-10T08:00:00Z"),
      new Date("2026-06-10T08:30:00Z")
    );

    const statsExerciseCurrent = {
      id: STATS_EXERCISE_CURRENT,
      workoutSessionId: STATS_SESSION_CURRENT,
      exerciseIndex: 0,
      title: "Row",
      restSeconds: 60,
      notes: null,
    };
    const statsSetCurrent = {
      id: STATS_SET_CURRENT,
      sessionExerciseId: STATS_EXERCISE_CURRENT,
      setIndex: 0,
      targetReps: "10",
      actualReps: 10,
      weightKg: "50.00",
      rpe: 7,
      completed: true,
      notes: null,
    };

    const statsExercisePrevious = {
      id: STATS_EXERCISE_PREVIOUS,
      workoutSessionId: STATS_SESSION_PREVIOUS,
      exerciseIndex: 0,
      title: "Squat",
      restSeconds: 60,
      notes: null,
    };
    const statsSetPrevious = {
      id: STATS_SET_PREVIOUS,
      sessionExerciseId: STATS_EXERCISE_PREVIOUS,
      setIndex: 0,
      targetReps: "10",
      actualReps: 10,
      weightKg: "20.00",
      rpe: 6,
      completed: true,
      notes: null,
    };

    function createStatsDb(input: {
      sessionRows: unknown[];
      exerciseRows?: unknown[];
      setRows?: unknown[];
    }) {
      const sessionsWhere = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(input.sessionRows),
      });
      const exercisesWhere = vi.fn().mockResolvedValue(input.exerciseRows ?? []);
      const setsWhere = vi.fn().mockResolvedValue(input.setRows ?? []);

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

    it("returns the empty-state DTO (zero KPIs, null deltas, empty trend) when there is no history", async () => {
      const { select } = createStatsDb({ sessionRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getStatsRange(TENANT_A, USER_A, "month", NOW);

      expect(summary.range).toBe("month");
      expect(summary.totalVolumeKg).toEqual({ value: 0, deltaVsPreviousPeriod: null });
      expect(summary.sessionCount).toEqual({ value: 0, deltaVsPreviousPeriod: null });
      expect(summary.totalDurationMin).toEqual({ value: 0, deltaVsPreviousPeriod: null });
      expect(summary.prCount).toEqual({ value: 0, deltaVsPreviousPeriod: null });
      expect(summary.volumeTrend).toEqual({ current: [], previous: [] });
      expect(summary.muscleGroupDistribution).toEqual([]);
      expect(summary.personalRecords).toEqual([]);
    });

    it("computes KPIs with deltas vs. the previous period from a bounded query", async () => {
      const { select, sessionsWhere, exercisesWhere, setsWhere } = createStatsDb({
        sessionRows: [statsSessionCurrent, statsSessionPrevious],
        exerciseRows: [statsExerciseCurrent, statsExercisePrevious],
        setRows: [statsSetCurrent, statsSetPrevious],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getStatsRange(TENANT_A, USER_A, "month", NOW);

      expect(summary.range).toBe("month");
      // current volume 500kg vs previous 200kg -> +150%
      expect(summary.totalVolumeKg).toEqual({ value: 500, deltaVsPreviousPeriod: 150 });
      // current 1 session vs previous 1 session -> 0% delta
      expect(summary.sessionCount).toEqual({ value: 1, deltaVsPreviousPeriod: 0 });
      // current 60min vs previous 30min -> +100%
      expect(summary.totalDurationMin).toEqual({ value: 60, deltaVsPreviousPeriod: 100 });
      expect(summary.volumeTrend).toEqual({ current: [500], previous: [200] });

      // Bounded: exactly one session lookup + two follow-up inArray queries.
      expect(select).toHaveBeenCalledTimes(3);
      expect(sessionsWhere).toHaveBeenCalledTimes(1);
      expect(exercisesWhere).toHaveBeenCalledTimes(1);
      expect(setsWhere).toHaveBeenCalledTimes(1);
    });

    it("computes the muscle-group distribution + personal records from the CURRENT period only (Slice 3b)", async () => {
      const { select } = createStatsDb({
        sessionRows: [statsSessionCurrent, statsSessionPrevious],
        exerciseRows: [
          { ...statsExerciseCurrent, muscleGroup: "back" },
          { ...statsExercisePrevious, muscleGroup: "quads" },
        ],
        setRows: [statsSetCurrent, statsSetPrevious],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getStatsRange(TENANT_A, USER_A, "month", NOW);

      // Only the current-period ("Row" -> back) exercise contributes; the
      // previous-period ("Squat" -> quads) exercise is out of scope.
      expect(summary.muscleGroupDistribution).toEqual([{ muscleGroup: "back", setCount: 1, volumeKg: 500 }]);

      // Epley: 50 * (1 + 10/30) = 66.666...
      expect(summary.personalRecords).toHaveLength(1);
      expect(summary.personalRecords[0]!.exerciseTitle).toBe("Row");
      expect(summary.personalRecords[0]!.estimated1RM).toBeCloseTo(66.6667, 3);
      expect(summary.personalRecords[0]!.achievedAt).toBe(statsSessionCurrent.completedAt.toISOString());
      expect(summary.prCount).toEqual({ value: 1, deltaVsPreviousPeriod: null });
    });

    it("excludes an unmapped exercise from the distribution without breaking the rest of the summary (Slice 3b)", async () => {
      const unmappedExercise = {
        ...statsExerciseCurrent,
        id: "bbbbbbbb-2222-0000-0000-000000000099",
        title: "Zumba combo freestyle",
        muscleGroup: null,
      };
      const unmappedSet = {
        ...statsSetCurrent,
        id: "cccccccc-2222-0000-0000-000000000099",
        sessionExerciseId: unmappedExercise.id,
      };
      const { select } = createStatsDb({
        sessionRows: [statsSessionCurrent],
        exerciseRows: [unmappedExercise],
        setRows: [unmappedSet],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getStatsRange(TENANT_A, USER_A, "month", NOW);

      expect(summary.muscleGroupDistribution).toEqual([]);
      // Still contributes to volume/PRs — only the distribution excludes it.
      expect(summary.totalVolumeKg.value).toBe(500);
      expect(summary.personalRecords).toHaveLength(1);
    });

    it("omits a bodyweight-only exercise from PRs (no eligible set) without erroring (Slice 3b)", async () => {
      const bodyweightExercise = {
        ...statsExerciseCurrent,
        id: "bbbbbbbb-2222-0000-0000-000000000098",
        title: "Pull-up",
        muscleGroup: "back",
      };
      const bodyweightSet = {
        ...statsSetCurrent,
        id: "cccccccc-2222-0000-0000-000000000098",
        sessionExerciseId: bodyweightExercise.id,
        weightKg: "0",
      };
      const { select } = createStatsDb({
        sessionRows: [statsSessionCurrent],
        exerciseRows: [bodyweightExercise],
        setRows: [bodyweightSet],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getStatsRange(TENANT_A, USER_A, "month", NOW);

      expect(summary.personalRecords).toEqual([]);
      expect(summary.prCount).toEqual({ value: 0, deltaVsPreviousPeriod: null });
    });

    it("17c PR 4 — totalVolumeKg and muscleGroupDistribution reflect a resolved bodyweight, PRs stay unaffected (non-regression)", async () => {
      const bodyweightExercise = {
        ...statsExerciseCurrent,
        id: "bbbbbbbb-2222-0000-0000-000000000097",
        title: "Pull-up",
        muscleGroup: "back",
      };
      const bodyweightSet = {
        ...statsSetCurrent,
        id: "cccccccc-2222-0000-0000-000000000097",
        sessionExerciseId: bodyweightExercise.id,
        weightKg: "0",
        actualReps: 10,
      };
      const { select } = createStatsDb({
        sessionRows: [statsSessionCurrent],
        exerciseRows: [bodyweightExercise],
        setRows: [bodyweightSet],
      });
      const bodyweightSource = {
        listAllForUser: vi.fn().mockResolvedValue([{ weightKg: 75, recordedAt: "2026-07-01T00:00:00.000Z" }]),
      };
      const repo = new WorkoutSessionRepository({ select } as never, bodyweightSource);

      const summary = await repo.getStatsRange(TENANT_A, USER_A, "month", NOW);

      // One batched weight-series read for the whole range (current + previous).
      expect(bodyweightSource.listAllForUser).toHaveBeenCalledTimes(1);
      expect(summary.totalVolumeKg.value).toBe(75 * 10);
      expect(summary.muscleGroupDistribution).toEqual([{ muscleGroup: "back", setCount: 1, volumeKg: 75 * 10 }]);
      // Personal records read the set's own logged load only — never the
      // resolved bodyweight — so a bodyweight-only exercise still yields no PR.
      expect(summary.personalRecords).toEqual([]);
      expect(summary.prCount).toEqual({ value: 0, deltaVsPreviousPeriod: null });
    });

    it("returns a null delta when the previous period has zero data (never Infinity/NaN)", async () => {
      const { select } = createStatsDb({
        sessionRows: [statsSessionCurrent],
        exerciseRows: [statsExerciseCurrent],
        setRows: [statsSetCurrent],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getStatsRange(TENANT_A, USER_A, "month", NOW);

      expect(summary.totalVolumeKg).toEqual({ value: 500, deltaVsPreviousPeriod: null });
      expect(summary.sessionCount).toEqual({ value: 1, deltaVsPreviousPeriod: null });
      expect(summary.totalDurationMin).toEqual({ value: 60, deltaVsPreviousPeriod: null });
      expect(summary.volumeTrend).toEqual({ current: [500], previous: [] });
      expect(Number.isFinite(summary.totalVolumeKg.deltaVsPreviousPeriod)).toBe(false);
      expect(summary.totalVolumeKg.deltaVsPreviousPeriod).not.toBeNaN();
    });

    it("scopes the query to (tenantId, userId) — a different tenant sees the empty state", async () => {
      const { select } = createStatsDb({ sessionRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const summary = await repo.getStatsRange(TENANT_B, USER_A, "month", NOW);

      expect(summary.sessionCount).toEqual({ value: 0, deltaVsPreviousPeriod: null });
    });
  });

  describe("getWeeklyOverview", () => {
    // Monday 2026-07-13 .. Sunday 2026-07-19 (UTC).
    const WEEK_START = new Date("2026-07-13T00:00:00.000Z");
    const NOW = new Date("2026-07-16T12:00:00.000Z"); // Thursday

    const weekProgram: WorkoutProgram = {
      weeklySessions: [
        { day: 1, title: "Tirón técnico", exercises: [{ name: "Row", sets: 1, reps: "10", restSeconds: 60 }] },
        { day: 2, title: "Pierna ligera", exercises: [{ name: "Squat", sets: 1, reps: "10", restSeconds: 60 }] },
      ],
      limitationWarnings: [],
    };
    const weekReadyPlanRow = { ...readyPlanRow, programJson: weekProgram };

    function buildWeekSessionRow(id: string, completedAt: Date) {
      return {
        id,
        tenantId: TENANT_A,
        userId: USER_A,
        workoutPlanId: PLAN_ID,
        status: "completed" as const,
        day: 1,
        startedAt: new Date(completedAt.getTime() - 30 * 60 * 1000),
        completedAt,
      };
    }

    function createWeekDb(input: { sessionRows: unknown[]; planRows: unknown[] }) {
      const sessionsWhere = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(input.sessionRows),
      });
      const plansWhere = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(input.planRows) }),
      });

      const select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((table: object) => {
          if (table === workoutSessions) return { where: sessionsWhere };
          if (table === workoutPlans) return { where: plansWhere };
          throw new Error(`Unexpected select table: ${String(table)}`);
        }),
      }));

      return { select, sessionsWhere, plansWhere };
    }

    it("returns the Monday-first week with the planned overlay and real done days (bounded, 2 queries)", async () => {
      const doneSession = buildWeekSessionRow("aaaaaaaa-3333-0000-0000-000000000001", new Date("2026-07-14T08:00:00Z"));
      const { select, sessionsWhere, plansWhere } = createWeekDb({
        sessionRows: [doneSession],
        planRows: [weekReadyPlanRow],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const overview = await repo.getWeeklyOverview(TENANT_A, USER_A, WEEK_START, NOW);

      expect(overview.weekStart).toBe("2026-07-13");
      expect(overview.days).toHaveLength(7);
      expect(overview.days[0]!.status).toBe("rest"); // Monday: past planned training day, not completed
      expect(overview.days[1]!.status).toBe("done"); // Tuesday: real completed session
      expect(overview.days[3]!.status).toBe("active"); // Thursday: today, no completion
      expect(overview.previousWeekStart).toBe("2026-07-06");
      expect(overview.nextWeekStart).toBe("2026-07-20");
      expect(select).toHaveBeenCalledTimes(2);
      expect(sessionsWhere).toHaveBeenCalledTimes(1);
      expect(plansWhere).toHaveBeenCalledTimes(1);
    });

    it("renders an all-rest week for a week predating the plan/account, with no error", async () => {
      const { select } = createWeekDb({ sessionRows: [], planRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const pastWeekStart = new Date("2020-01-06T00:00:00.000Z");
      const overview = await repo.getWeeklyOverview(TENANT_A, USER_A, pastWeekStart, NOW);

      expect(overview.days.every((day) => day.status === "rest")).toBe(true);
    });

    it("counts done regardless of plan version — completion is never filtered by plan id", async () => {
      const otherPlanSession = {
        ...buildWeekSessionRow("aaaaaaaa-3333-0000-0000-000000000002", new Date("2026-07-13T08:00:00Z")),
        workoutPlanId: "ffffffff-9999-0000-0000-000000000001",
      };
      const { select } = createWeekDb({ sessionRows: [otherPlanSession], planRows: [weekReadyPlanRow] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const overview = await repo.getWeeklyOverview(TENANT_A, USER_A, WEEK_START, NOW);

      expect(overview.days[0]!.status).toBe("done");
    });

    it("scopes the query to (tenantId, userId) — a different tenant sees the empty/all-rest board", async () => {
      const { select } = createWeekDb({ sessionRows: [], planRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const overview = await repo.getWeeklyOverview(TENANT_B, USER_A, WEEK_START, NOW);

      expect(overview.days.every((day) => day.status === "rest" || day.status === "active")).toBe(true);
    });
  });

  describe("getExerciseDetail", () => {
    const HISTORY_SESSION_A = "aaaaaaaa-4444-0000-0000-000000000001";
    const HISTORY_EXERCISE_A = "bbbbbbbb-4444-0000-0000-000000000001";
    const HISTORY_SET_A = "cccccccc-4444-0000-0000-000000000001";

    const historySessionA = {
      id: HISTORY_SESSION_A,
      tenantId: TENANT_A,
      userId: USER_A,
      workoutPlanId: PLAN_ID,
      status: "completed" as const,
      day: 1,
      startedAt: new Date("2026-07-10T08:00:00Z"),
      completedAt: new Date("2026-07-10T09:00:00Z"),
    };

    const historyExerciseA = {
      id: HISTORY_EXERCISE_A,
      workoutSessionId: HISTORY_SESSION_A,
      exerciseIndex: 0,
      title: "Bench Press",
      restSeconds: 90,
      notes: null,
    };

    const historySetA = {
      id: HISTORY_SET_A,
      sessionExerciseId: HISTORY_EXERCISE_A,
      setIndex: 0,
      targetReps: "8-10",
      actualReps: 8,
      weightKg: "80.00",
      rpe: 8,
      completed: true,
      notes: null,
    };

    function createExerciseDetailDb(input: {
      sessionRows: unknown[];
      exerciseRows?: unknown[];
      setRows?: unknown[];
    }) {
      const sessionsWhere = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(input.sessionRows) }),
      });
      const exercisesWhere = vi.fn().mockResolvedValue(input.exerciseRows ?? []);
      const setsWhere = vi.fn().mockResolvedValue(input.setRows ?? []);

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

    it("returns recent sets for the matched exercise title, scoped to (tenantId, userId)", async () => {
      const { select } = createExerciseDetailDb({
        sessionRows: [historySessionA],
        exerciseRows: [historyExerciseA],
        setRows: [historySetA],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const detail = await repo.getExerciseDetail(TENANT_A, USER_A, "Bench Press");

      expect(detail.exerciseTitle).toBe("Bench Press");
      expect(detail.recentSets).toEqual([
        { completedAt: historySessionA.completedAt.toISOString(), weightKg: 80, actualReps: 8, rpe: 8 },
      ]);
    });

    it("returns an empty recentSets array (no error) when the exercise has no history", async () => {
      const { select } = createExerciseDetailDb({ sessionRows: [historySessionA], exerciseRows: [], setRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const detail = await repo.getExerciseDetail(TENANT_A, USER_A, "Never Performed");

      expect(detail.recentSets).toEqual([]);
    });

    it("is IDOR-safe: a crafted title cannot read another user's rows", async () => {
      // The session-scan query is scoped to (TENANT_A, USER_B) and returns
      // none of USER_A's sessions, so even though "Bench Press" matches
      // historyExerciseA's title, it can never surface USER_A's data for
      // a USER_B-scoped call — the title filter only narrows an ALREADY
      // (tenantId, userId)-scoped set, it can never widen it.
      const { select, exercisesWhere } = createExerciseDetailDb({ sessionRows: [] });
      const repo = new WorkoutSessionRepository({ select } as never);

      const detail = await repo.getExerciseDetail(TENANT_A, USER_B, "Bench Press");

      expect(detail.recentSets).toEqual([]);
      expect(exercisesWhere).not.toHaveBeenCalled();
    });

    it("matches exercise title case-insensitively via normalizeTitle (#140)", async () => {
      // #140: "bench press" (lowercase) must match stored "Bench Press"
      const { select } = createExerciseDetailDb({
        sessionRows: [historySessionA],
        exerciseRows: [historyExerciseA],  // title: "Bench Press"
        setRows: [historySetA],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const detail = await repo.getExerciseDetail(TENANT_A, USER_A, "bench press");

      expect(detail.exerciseTitle).toBe("bench press");
      expect(detail.recentSets).toHaveLength(1);
      expect(detail.recentSets[0]!.weightKg).toBe(80);
    });

    it("matches exercise title with extra whitespace via normalizeTitle (#140)", async () => {
      // #140: "Bench  Press" (double space) must match stored "Bench Press"
      const { select } = createExerciseDetailDb({
        sessionRows: [historySessionA],
        exerciseRows: [historyExerciseA],  // title: "Bench Press"
        setRows: [historySetA],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const detail = await repo.getExerciseDetail(TENANT_A, USER_A, "Bench  Press");

      expect(detail.exerciseTitle).toBe("Bench  Press");
      expect(detail.recentSets).toHaveLength(1);
    });

    it("matches exercise title with diacritics via normalizeTitle (#140)", async () => {
      // #140: "Sentadílla" (accented) must match stored "Sentadilla"
      const exerciseWithAccent = { ...historyExerciseA, id: "exercise-accent", title: "Sentadilla" };
      const setForAccent = { ...historySetA, id: "set-accent", sessionExerciseId: "exercise-accent" };
      const { select } = createExerciseDetailDb({
        sessionRows: [historySessionA],
        exerciseRows: [exerciseWithAccent],
        setRows: [setForAccent],
      });
      const repo = new WorkoutSessionRepository({ select } as never);

      const detail = await repo.getExerciseDetail(TENANT_A, USER_A, "Sentadílla");

      expect(detail.exerciseTitle).toBe("Sentadílla");
      expect(detail.recentSets).toHaveLength(1);
    });
  });

  /**
   * #352 slice A — the technique link on a tracked session.
   *
   * `session_exercises` stores only the free-text `title`, and deliberately
   * gains no column for this: the id is derived inside
   * `mapWorkoutSessionRecord`, the ONE mapping every session read path goes
   * through. These tests go through `findById` (the tracker's read) because
   * that is what proves the wiring, not just the resolver — which has its own
   * tests in `packages/exercise-catalog`.
   *
   * The ids are the shipped dataset's real ones, so a dataset re-import that
   * moves them fails here rather than silently pointing users at the wrong
   * animation.
   */
  describe("catalog technique link (#352 slice A)", () => {
    const PUSH_UP_ID = "0662";

    function createFindByIdDb(titles: string[]) {
      const rows = titles.map((title, index) => ({
        id: `exercise-${index}`,
        workoutSessionId: SESSION_ID,
        exerciseIndex: index,
        title,
        restSeconds: 60,
        notes: null,
      }));

      return createQueuedSelectDb(
        new Map<object, unknown[][]>([
          [workoutSessions, [[sessionRow]]],
          [sessionExercises, [rows]],
          [setRecords, [[]]],
        ])
      ).select;
    }

    it("exposes the catalog id of a title the catalog knows", async () => {
      const repo = new WorkoutSessionRepository({
        select: createFindByIdDb(["Push-Ups"]),
      } as never);

      const session = await repo.findById(TENANT_A, USER_A, SESSION_ID);

      expect(session?.exercises[0]?.catalogExerciseId).toBe(PUSH_UP_ID);
    });

    it("leaves catalogExerciseId undefined for a title the catalog does not know", async () => {
      const repo = new WorkoutSessionRepository({
        select: createFindByIdDb(["Totally Invented Movement"]),
      } as never);

      const session = await repo.findById(TENANT_A, USER_A, SESSION_ID);

      // The UI degrades on exactly this: no id means no link at all.
      expect(session?.exercises[0]?.catalogExerciseId).toBeUndefined();
    });

    it("never rewrites the stored title to the catalog's spelling", async () => {
      // The catalog record is named "push-up"; the prescription said
      // "Push-Ups". The snapshot is what the user was told to do and must
      // survive the link being added beside it.
      const repo = new WorkoutSessionRepository({
        select: createFindByIdDb(["Push-Ups", "Totally Invented Movement"]),
      } as never);

      const session = await repo.findById(TENANT_A, USER_A, SESSION_ID);

      expect(session?.exercises.map((exercise) => exercise.title)).toEqual([
        "Push-Ups",
        "Totally Invented Movement",
      ]);
    });

    it("resolves each exercise of a session independently", async () => {
      const repo = new WorkoutSessionRepository({
        select: createFindByIdDb([
          "Push-Ups",
          "Totally Invented Movement",
          "Dumbbell Bench Press",
        ]),
      } as never);

      const session = await repo.findById(TENANT_A, USER_A, SESSION_ID);

      expect(session?.exercises.map((exercise) => exercise.catalogExerciseId)).toEqual([
        PUSH_UP_ID,
        undefined,
        "0289",
      ]);
    });
  });
});
