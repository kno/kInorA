import { describe, expect, it, vi } from "vitest";
import { WorkoutSessionRepository } from "../workout-session.js";
import { sessionExercises, setRecords, workoutSessions } from "../../schema.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const USER_B = "aaaaaaaa-0000-0000-0000-000000000003";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";
const PLAN_ID = "cccccccc-0000-0000-0000-000000000001";
const SESSION_ID = "dddddddd-0000-0000-0000-000000000001";
const EXERCISE_ID = "eeeeeeee-0000-0000-0000-000000000001";
const SET_ID = "ffffffff-0000-0000-0000-000000000001";

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

const exerciseRows = [
  {
    id: EXERCISE_ID,
    workoutSessionId: SESSION_ID,
    exerciseIndex: 0,
    title: "Bench Press",
    restSeconds: 90,
    notes: "Pause 1s",
  },
];

const setRows = [
  {
    id: SET_ID,
    sessionExerciseId: EXERCISE_ID,
    setIndex: 0,
    targetReps: "8-10",
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
        return {
          orderBy: vi.fn().mockResolvedValue(nextRows),
          then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(nextRows)),
        };
      }),
    })),
  });

  return { select };
}

describe("WorkoutSessionRepository", () => {
  describe("findById", () => {
    it("returns a tenant/user scoped workout session with exercises and sets", async () => {
      const select = createQueuedSelectDb(
        new Map<object, unknown[][]>([
          [workoutSessions, [[sessionRow]]],
          [sessionExercises, [exerciseRows]],
          [setRecords, [setRows]],
        ])
      ).select;
      const repo = new WorkoutSessionRepository({ select } as never);

      const result = await repo.findById(TENANT_A, USER_A, SESSION_ID);

      expect(result).toEqual({
        id: SESSION_ID,
        workoutPlanId: PLAN_ID,
        status: "active",
        startedAt: "2026-07-04T08:30:00.000Z",
        exercises: [
          {
            id: EXERCISE_ID,
            workoutSessionId: SESSION_ID,
            exerciseIndex: 0,
            title: "Bench Press",
            restSeconds: 90,
            notes: "Pause 1s",
            setRecords: [
              {
                id: SET_ID,
                sessionExerciseId: EXERCISE_ID,
                setIndex: 0,
                targetReps: "8-10",
                actualReps: 10,
                weightKg: 80.5,
                rpe: 8,
                completed: true,
                notes: "Strong set",
              },
            ],
          },
        ],
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
});
