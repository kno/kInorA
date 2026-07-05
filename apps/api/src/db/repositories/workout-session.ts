import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  SessionExerciseRecord,
  SetRecordDTO,
  WorkoutExercise,
  WorkoutProgram,
  WorkoutSessionRecord,
} from "@kinora/contracts";
import type { Database } from "../client.js";
import { sessionExercises, setRecords, workoutPlans, workoutSessions } from "../schema.js";

interface WorkoutPlanRow {
  id: string;
  tenantId: string;
  userId: string;
  status: "generating" | "ready" | "failed";
  programJson: WorkoutProgram | null;
}

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

type StartTx = Pick<Database, "insert">;

export interface UpdateSetRecordInput {
  actualReps?: number;
  weightKg?: number;
  rpe?: number;
  completed: boolean;
  notes?: string;
}

export class WorkoutSessionRepository {
  constructor(private db: Database) {}

  async startSession(
    tenantId: string,
    userId: string,
    workoutPlanId: string,
    day: number
  ): Promise<WorkoutSessionRecord | undefined> {
    const existingActive = await this.findLatestActiveSession(tenantId, userId);
    if (existingActive) {
      return this.findById(tenantId, userId, existingActive.id);
    }

    const plan = await this.findReadyPlan(tenantId, userId, workoutPlanId);
    if (!plan?.programJson) {
      return undefined;
    }

    const plannedSession = plan.programJson.weeklySessions.find((session) => session.day === day);
    if (!plannedSession) {
      return undefined;
    }

    return this.db.transaction(async (tx) => {
      const sessionRows = await tx
        .insert(workoutSessions)
        .values({ tenantId, userId, workoutPlanId, status: "active" })
        .returning();
      const sessionRow = sessionRows[0] as WorkoutSessionRow | undefined;
      if (!sessionRow) {
        return undefined;
      }

      const exerciseRows = await this.insertSessionExercises(tx, sessionRow.id, plannedSession.exercises);
      const setRows = await this.insertSetRecords(tx, exerciseRows, plannedSession.exercises);

      return mapWorkoutSessionRecord(sessionRow, exerciseRows, setRows);
    });
  }

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

  async recordSet(
    tenantId: string,
    userId: string,
    sessionId: string,
    setId: string,
    input: UpdateSetRecordInput
  ): Promise<WorkoutSessionRecord | undefined> {
    const session = await this.findById(tenantId, userId, sessionId);
    if (!session || session.status !== "active") {
      return undefined;
    }

    const ownsSet = session.exercises.some((exercise) =>
      exercise.setRecords.some((setRecord) => setRecord.id === setId)
    );
    if (!ownsSet) {
      return undefined;
    }

    const rows = await this.db
      .update(setRecords)
      .set({
        actualReps: input.actualReps ?? null,
        weightKg: input.weightKg === undefined ? null : input.weightKg.toString(),
        rpe: input.rpe ?? null,
        completed: input.completed,
        notes: input.notes ?? null,
      })
      .where(eq(setRecords.id, setId))
      .returning();
    if (rows.length === 0) {
      return undefined;
    }

    return this.findById(tenantId, userId, sessionId);
  }

  async completeSession(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<WorkoutSessionRecord | undefined> {
    const rows = await this.db
      .update(workoutSessions)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.id, id),
          eq(workoutSessions.status, "active")
        )
      )
      .returning();
    if (rows.length === 0) {
      return undefined;
    }

    return this.findById(tenantId, userId, id);
  }

  private async findLatestActiveSession(
    tenantId: string,
    userId: string
  ): Promise<WorkoutSessionRow | undefined> {
    const rows = await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "active")
        )
      )
      .orderBy(desc(workoutSessions.startedAt))
      .limit(1);

    return rows[0] as WorkoutSessionRow | undefined;
  }

  private async findReadyPlan(
    tenantId: string,
    userId: string,
    workoutPlanId: string
  ): Promise<WorkoutPlanRow | undefined> {
    const rows = await this.db
      .select()
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId),
          eq(workoutPlans.id, workoutPlanId),
          eq(workoutPlans.status, "ready")
        )
      );

    return rows[0] as WorkoutPlanRow | undefined;
  }

  private async insertSessionExercises(
    tx: StartTx,
    workoutSessionId: string,
    exercises: WorkoutExercise[]
  ): Promise<SessionExerciseRow[]> {
    if (exercises.length === 0) {
      return [];
    }

    const rows = await tx
      .insert(sessionExercises)
      .values(
        exercises.map((exercise, exerciseIndex) => ({
          workoutSessionId,
          exerciseIndex,
          title: exercise.name,
          restSeconds: exercise.restSeconds,
          notes: combineExerciseNotes(exercise),
        }))
      )
      .returning();

    return rows as SessionExerciseRow[];
  }

  private async insertSetRecords(
    tx: StartTx,
    exerciseRows: SessionExerciseRow[],
    exercises: WorkoutExercise[]
  ): Promise<SetRecordRow[]> {
    const values = exerciseRows.flatMap((exerciseRow) => {
      const sourceExercise = exercises[exerciseRow.exerciseIndex];
      if (!sourceExercise) {
        return [];
      }

      return Array.from({ length: sourceExercise.sets }, (_, setIndex) => ({
        sessionExerciseId: exerciseRow.id,
        setIndex,
        targetReps: sourceExercise.reps,
        completed: false,
      }));
    });

    if (values.length === 0) {
      return [];
    }

    const rows = await tx.insert(setRecords).values(values).returning();
    return rows as SetRecordRow[];
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

function combineExerciseNotes(exercise: WorkoutExercise): string | null {
  const notes = [exercise.notes, exercise.substitutionNote].filter(
    (value): value is string => typeof value === "string" && value.trim() !== ""
  );
  return notes.length === 0 ? null : notes.join("\n\n");
}

function toOptionalNumber(value: number | string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  return typeof value === "number" ? value : Number(value);
}
