import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";

import {
  sessionExercises,
  setRecords,
  workoutSessionStatusEnum,
  workoutSessions,
} from "../schema.js";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0005_workout_tracking.sql", import.meta.url)),
  "utf8",
);

describe("workout_session_status enum", () => {
  it("exposes the active and completed values", () => {
    expect(workoutSessionStatusEnum.enumValues).toEqual(["active", "completed"]);
  });
});

describe("workout_sessions schema shape", () => {
  it("defines a workout_sessions table", () => {
    expect(isTable(workoutSessions)).toBe(true);
  });

  it("has tenant/user/workout-plan ownership columns", () => {
    const cols = getTableColumns(workoutSessions);
    expect(cols.tenantId.columnType).toBe("PgUUID");
    expect(cols.userId.columnType).toBe("PgUUID");
    expect(cols.workoutPlanId.columnType).toBe("PgUUID");
  });

  it("has status and lifecycle timestamps", () => {
    const cols = getTableColumns(workoutSessions);
    expect(cols.status.columnType).toBe("PgEnumColumn");
    expect(cols.startedAt).toBeDefined();
    expect(cols.completedAt).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });
});

describe("session_exercises schema shape", () => {
  it("defines a session_exercises table", () => {
    expect(isTable(sessionExercises)).toBe(true);
  });

  it("stores exercise snapshot context for the live session", () => {
    const cols = getTableColumns(sessionExercises);
    expect(cols.workoutSessionId.columnType).toBe("PgUUID");
    expect(cols.exerciseIndex.columnType).toBe("PgInteger");
    expect(cols.title.columnType).toBe("PgText");
    expect(cols.restSeconds.columnType).toBe("PgInteger");
    expect(cols.notes.columnType).toBe("PgText");
  });
});

describe("set_records schema shape", () => {
  it("defines a set_records table", () => {
    expect(isTable(setRecords)).toBe(true);
  });

  it("stores planned set targets and logged workout fields", () => {
    const cols = getTableColumns(setRecords);
    expect(cols.sessionExerciseId.columnType).toBe("PgUUID");
    expect(cols.setIndex.columnType).toBe("PgInteger");
    expect(cols.targetReps.columnType).toBe("PgText");
    expect(cols.actualReps.columnType).toBe("PgInteger");
    expect(cols.weightKg.columnType).toBe("PgNumeric");
    expect(cols.weightKg.precision).toBe(6);
    expect(cols.weightKg.scale).toBe(2);
    expect(cols.rpe.columnType).toBe("PgInteger");
    expect(cols.completed.columnType).toBe("PgBoolean");
    expect(cols.notes.columnType).toBe("PgText");
  });
});

describe("workout tracking migration", () => {
  it("creates the single-active-session partial unique index", () => {
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "workout_sessions_single_active_per_user_unique"',
    );
    expect(migrationSql).toContain('WHERE "workout_sessions"."status" = \'active\'');
  });

  it("creates all three workout tracking tables", () => {
    expect(migrationSql).toContain('CREATE TABLE "workout_sessions"');
    expect(migrationSql).toContain('CREATE TABLE "session_exercises"');
    expect(migrationSql).toContain('CREATE TABLE "set_records"');
  });
});
