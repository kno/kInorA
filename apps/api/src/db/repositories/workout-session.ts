import { and, eq, inArray } from "drizzle-orm";
import type {
  SessionExerciseRecord,
  SetRecordDTO,
  WorkoutSessionRecord,
} from "@kinora/contracts";
import type { Database } from "../client.js";
import { sessionExercises, setRecords, workoutSessions } from "../schema.js";

interface WorkoutSessionRow {
  id: string;
  tenantId: string;
  userId: string;
  workoutPlanId: string;
  status: "active" | "completed";
  startedAt: Date;
  completedAt: Date | null;
}

interface SessionExerciseRow {
  id: string;
  workoutSessionId: string;
  exerciseIndex: number;
  title: string;
  restSeconds: number;
  notes: string | null;
}

interface SetRecordRow {
  id: string;
  sessionExerciseId: string;
  setIndex: number;
  targetReps: string;
  actualReps: number | null;
  weightKg: number | string | null;
  rpe: number | null;
  completed: boolean;
  notes: string | null;
}

export class WorkoutSessionRepository {
  constructor(private db: Database) {}

  async findById(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<WorkoutSessionRecord | undefined> {
    const sessionRows = await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.id, id)
        )
      );
    const sessionRow = sessionRows[0] as WorkoutSessionRow | undefined;
    if (!sessionRow) {
      return undefined;
    }

    const exerciseRows = (await this.db
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.workoutSessionId, sessionRow.id))
      .orderBy(sessionExercises.exerciseIndex)) as SessionExerciseRow[];

    const exerciseIds = exerciseRows.map((exercise) => exercise.id);
    const setRows =
      exerciseIds.length === 0
        ? []
        : ((await this.db
            .select()
            .from(setRecords)
            .where(inArray(setRecords.sessionExerciseId, exerciseIds))) as SetRecordRow[]);

    return mapWorkoutSessionRecord(sessionRow, exerciseRows, setRows);
  }
}

function mapWorkoutSessionRecord(
  sessionRow: WorkoutSessionRow,
  exerciseRows: SessionExerciseRow[],
  setRows: SetRecordRow[]
): WorkoutSessionRecord {
  const setsByExerciseId = new Map<string, SetRecordDTO[]>();

  for (const setRow of setRows) {
    const current = setsByExerciseId.get(setRow.sessionExerciseId) ?? [];
    current.push({
      id: setRow.id,
      sessionExerciseId: setRow.sessionExerciseId,
      setIndex: setRow.setIndex,
      targetReps: setRow.targetReps,
      actualReps: setRow.actualReps ?? undefined,
      weightKg: toOptionalNumber(setRow.weightKg),
      rpe: setRow.rpe ?? undefined,
      completed: setRow.completed,
      notes: setRow.notes ?? undefined,
    });
    setsByExerciseId.set(setRow.sessionExerciseId, current);
  }

  const exercises: SessionExerciseRecord[] = exerciseRows
    .slice()
    .sort((left, right) => left.exerciseIndex - right.exerciseIndex)
    .map((exerciseRow) => ({
      id: exerciseRow.id,
      workoutSessionId: exerciseRow.workoutSessionId,
      exerciseIndex: exerciseRow.exerciseIndex,
      title: exerciseRow.title,
      restSeconds: exerciseRow.restSeconds,
      notes: exerciseRow.notes ?? undefined,
      setRecords: (setsByExerciseId.get(exerciseRow.id) ?? [])
        .slice()
        .sort((left, right) => left.setIndex - right.setIndex),
    }));

  return {
    id: sessionRow.id,
    workoutPlanId: sessionRow.workoutPlanId,
    status: sessionRow.status,
    exercises,
    startedAt: sessionRow.startedAt.toISOString(),
    completedAt: sessionRow.completedAt?.toISOString() ?? undefined,
  };
}

function toOptionalNumber(value: number | string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  return typeof value === "number" ? value : Number(value);
}
