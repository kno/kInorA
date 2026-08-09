/**
 * Real-Postgres proof of what editing a program does — and does not — do
 * (17d PR D).
 *
 * Three claims, none of which a mocked db can settle, because all three are
 * about how two repositories interact through actual rows:
 *
 * 1. The NEXT session started after an edit is built from the edited program.
 *    `startSession` re-reads `program_json` on every call, so this should pass
 *    on the first run — if it does not, the design is wrong, not the test.
 * 2. Removing a day makes that day unstartable, and says so: `startSession`
 *    resolves it to `day_not_in_plan` carrying the days that remain (PR B's
 *    refusal, exercised end-to-end rather than re-implemented here).
 * 3. An edit landing while a session is ACTIVE cannot touch that session.
 *    `session_exercises` is the immutable what-happened record, snapshotted at
 *    start; this asserts the rows are byte-identical before and after the
 *    edit, which is the behavioural half of the same guarantee the tracker's
 *    source-scan guard pins structurally.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, the same pattern as
 * `workout-plan-archive.integration.test.ts`) — skipped when no real Postgres
 * is wired so the default `vitest run` stays hermetic. Picked up automatically
 * by the CI integration glob; no workflow edit needed.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import {
  planSpecs,
  sessionExercises,
  setRecords,
  tenants,
  users,
  workoutPlans,
} from "../../schema.js";
import { WorkoutPlanRepository } from "../workout-plan.js";
import { WorkoutSessionRepository } from "../workout-session.js";
import type { WorkoutProgram } from "@kinora/contracts";

const hasDb = Boolean(process.env.DATABASE_URL);

function programOf(days: number): WorkoutProgram {
  return {
    weeklySessions: Array.from({ length: days }, (_unused, index) => ({
      day: index + 1,
      title: `Day ${index + 1}`,
      exercises: [
        { name: `Original Exercise ${index + 1}`, sets: 3, reps: "8-10", restSeconds: 90 },
      ],
    })),
    limitationWarnings: [],
  };
}

describe.skipIf(!hasDb)("Program edit end-to-end (real Postgres, 17d PR D)", () => {
  const { db, pool } = createDbClient();
  const planRepo = new WorkoutPlanRepository(db);
  const sessionRepo = new WorkoutSessionRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedOwner(): Promise<{ tenantId: string; userId: string }> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `plan-edit-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    const [user] = await db
      .insert(users)
      .values({ email: `plan-edit-${Date.now()}-${Math.random()}@example.test` })
      .returning({ id: users.id });
    return { tenantId: tenant!.id, userId: user!.id };
  }

  async function seedReadyPlan(
    tenantId: string,
    userId: string,
    program: WorkoutProgram,
  ): Promise<{ id: string; updatedAt: Date }> {
    const [spec] = await db
      .insert(planSpecs)
      .values({ tenantId, userId, specJson: {}, confirmed: true })
      .returning({ id: planSpecs.id });
    const [plan] = await db
      .insert(workoutPlans)
      .values({
        tenantId,
        userId,
        planSpecId: spec!.id,
        status: "ready",
        programJson: program,
      })
      .returning({ id: workoutPlans.id, updatedAt: workoutPlans.updatedAt });
    return { id: plan!.id, updatedAt: plan!.updatedAt };
  }

  /**
   * Everything a session recorded: its exercise snapshot rows plus every set
   * record hanging off them. Compared verbatim before and after an edit.
   */
  async function snapshotOf(sessionId: string) {
    const exercises = await db
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.workoutSessionId, sessionId))
      .orderBy(sessionExercises.exerciseIndex);
    const sets = exercises.length
      ? await db
          .select()
          .from(setRecords)
          .where(
            inArray(
              setRecords.sessionExerciseId,
              exercises.map((row) => row.id),
            ),
          )
          .orderBy(setRecords.setIndex)
      : [];
    return { exercises, sets };
  }

  it("the next session started after an edit is built from the edited program", async () => {
    const { tenantId, userId } = await seedOwner();
    const plan = await seedReadyPlan(tenantId, userId, programOf(2));

    const edited = programOf(2);
    edited.weeklySessions[0]!.exercises[0]!.name = "Edited Exercise";
    const updated = await planRepo.updateProgram(
      tenantId,
      userId,
      plan.id,
      edited,
      plan.updatedAt,
    );
    expect(updated).toBeDefined();

    const outcome = await sessionRepo.startSession(tenantId, userId, plan.id, 1);

    expect(outcome?.kind).toBe("started");
    const sessionId = outcome && "session" in outcome ? outcome.session.id : undefined;
    const rows = await db
      .select({ title: sessionExercises.title })
      .from(sessionExercises)
      .where(eq(sessionExercises.workoutSessionId, sessionId!));
    expect(rows.map((row) => row.title)).toEqual(["Edited Exercise"]);
  });

  it("a successful edit advances updated_at, so the same token cannot be replayed", async () => {
    const { tenantId, userId } = await seedOwner();
    const plan = await seedReadyPlan(tenantId, userId, programOf(1));

    const first = await planRepo.updateProgram(
      tenantId,
      userId,
      plan.id,
      programOf(1),
      plan.updatedAt,
    );
    const replay = await planRepo.updateProgram(
      tenantId,
      userId,
      plan.id,
      programOf(1),
      plan.updatedAt,
    );

    expect(first!.updatedAt.getTime()).toBeGreaterThan(plan.updatedAt.getTime());
    // The losing writer of a two-tab race gets exactly this: 0 rows, which the
    // route turns into 409 edit_conflict rather than a silent overwrite.
    expect(replay).toBeUndefined();
  });

  it("editing 4 days down to 3 makes the removed day resolve to day_not_in_plan", async () => {
    const { tenantId, userId } = await seedOwner();
    const plan = await seedReadyPlan(tenantId, userId, programOf(4));

    await planRepo.updateProgram(tenantId, userId, plan.id, programOf(3), plan.updatedAt);

    const outcome = await sessionRepo.startSession(tenantId, userId, plan.id, 4);

    expect(outcome).toEqual({ kind: "day_not_in_plan", availableDays: [1, 2, 3] });
  });

  it("an edit made while a session is active leaves that session's snapshot untouched", async () => {
    const { tenantId, userId } = await seedOwner();
    const plan = await seedReadyPlan(tenantId, userId, programOf(2));

    const started = await sessionRepo.startSession(tenantId, userId, plan.id, 1);
    const sessionId = started && "session" in started ? started.session.id : undefined;
    expect(sessionId).toBeDefined();

    const before = await snapshotOf(sessionId!);
    expect(before.exercises.length).toBeGreaterThan(0);
    expect(before.sets.length).toBeGreaterThan(0);

    const edited = programOf(2);
    edited.weeklySessions[0]!.title = "Completely Different Day";
    edited.weeklySessions[0]!.exercises[0] = {
      name: "Something Else Entirely",
      sets: 9,
      reps: "1",
      restSeconds: 5,
    };
    const current = await planRepo.findById(tenantId, userId, plan.id);
    const updated = await planRepo.updateProgram(
      tenantId,
      userId,
      plan.id,
      edited,
      current!.updatedAt,
    );
    expect(updated).toBeDefined();

    const after = await snapshotOf(sessionId!);

    // Byte-identical: the snapshot is the true immutable what-happened record,
    // and an edit is not a rewrite of it.
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("the edit is invisible to the active session but visible to the one started after it", async () => {
    const { tenantId, userId } = await seedOwner();
    const plan = await seedReadyPlan(tenantId, userId, programOf(2));

    const first = await sessionRepo.startSession(tenantId, userId, plan.id, 1);
    const firstId = first && "session" in first ? first.session.id : undefined;

    const edited = programOf(2);
    edited.weeklySessions[1]!.exercises[0]!.name = "Edited Day Two";
    const current = await planRepo.findById(tenantId, userId, plan.id);
    await planRepo.updateProgram(tenantId, userId, plan.id, edited, current!.updatedAt);

    await sessionRepo.abandonSession(tenantId, userId, firstId!);
    const second = await sessionRepo.startSession(tenantId, userId, plan.id, 2);
    const secondId = second && "session" in second ? second.session.id : undefined;

    const firstRows = await db
      .select({ name: sessionExercises.title })
      .from(sessionExercises)
      .where(eq(sessionExercises.workoutSessionId, firstId!));
    const secondRows = await db
      .select({ name: sessionExercises.title })
      .from(sessionExercises)
      .where(eq(sessionExercises.workoutSessionId, secondId!));

    expect(firstRows.map((row) => row.name)).toEqual(["Original Exercise 1"]);
    expect(secondRows.map((row) => row.name)).toEqual(["Edited Day Two"]);
  });
});

describe.skipIf(hasDb)("Program edit end-to-end (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
