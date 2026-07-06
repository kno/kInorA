import { describe, expect, it, vi } from "vitest";
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
    it("creates an immutable snapshot from the ready workout plan session", async () => {
      const { db, insert, transaction } = createStartDb();
      const repo = new WorkoutSessionRepository(db as never);

      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);
      readyProgram.weeklySessions[0]!.exercises[0]!.name = "Changed After Start";

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledTimes(3);
      expect(result).toMatchObject({
        id: SESSION_ID,
        workoutPlanId: PLAN_ID,
        status: "active",
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

      expect(started?.exercises[0]?.title).toBe("Bench Press");
      expect(started?.exercises[0]?.restSeconds).toBe(90);

      // Restore for other tests that share the module-level fixture.
      readyProgram.weeklySessions[0]!.exercises[0]!.name = "Bench Press";
      readyProgram.weeklySessions[0]!.exercises[0]!.restSeconds = 90;
    });

    it("returns the existing active session instead of creating a duplicate", async () => {
      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[sessionRow], [sessionRow]]],
        [sessionExercises, [exerciseRows]],
        [setRecords, [initialSetRows]],
      ]);
      const select = createQueuedSelectDb(queues).select;
      const transaction = vi.fn();
      const repo = new WorkoutSessionRepository({ select, transaction } as never);

      const result = await repo.startSession(TENANT_A, USER_A, PLAN_ID, 1);

      expect(transaction).not.toHaveBeenCalled();
      expect(result?.id).toBe(SESSION_ID);
      expect(result?.status).toBe("active");
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

      const queues = new Map<object, unknown[][]>([
        [workoutSessions, [[sessionRow], [sessionRow]]],
        [sessionExercises, [exerciseRows, exerciseRows]],
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
      // The user-scoped completion update matches no row, so nothing is returned.
      const select = createQueuedSelectDb(new Map<object, unknown[][]>()).select;
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      const repo = new WorkoutSessionRepository({ select, update } as never);

      const result = await repo.completeSession(TENANT_A, USER_B, SESSION_ID);

      expect(result).toBeUndefined();
    });
  });
});
