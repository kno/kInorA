/**
 * Real-Postgres integration coverage for `WorkoutSessionRepository.startSession`'s
 * auto-close transaction and `abandonSession` (17b-stale-session-recovery).
 *
 * A mocked-db unit suite (`workout-session.test.ts`) already pins the guard
 * stances and the Branch A/B fast path; only a real Postgres can prove the
 * three-phase transaction's actual mechanics: the age-scoped UPDATE, the
 * partial-unique-index interaction, and the double-tap race. Injected `now`
 * throughout — no clock mocking.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * `workout-session-dashboard.integration.test.ts`) — skipped when no real
 * Postgres is wired so the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../client.js";
import { planSpecs, sessionExercises, setRecords, tenants, users, workoutPlans, workoutSessions } from "../../schema.js";
import { WorkoutSessionRepository } from "../workout-session.js";
import { eq } from "drizzle-orm";

const hasDb = Boolean(process.env.DATABASE_URL);

const NOW = new Date("2026-08-07T12:00:00.000Z");
const AGED_STARTED_AT = new Date(NOW.getTime() - 25 * 3600_000); // 25h ago
const UNDER_THRESHOLD_STARTED_AT = new Date(NOW.getTime() - 23 * 3600_000); // 23h ago

const twoDaySessionsProgram = {
  weeklySessions: [
    { day: 1, title: "Day 1", exercises: [{ name: "Squat", sets: 3, reps: "5", restSeconds: 90 }] },
    { day: 2, title: "Day 2", exercises: [{ name: "Bench", sets: 3, reps: "5", restSeconds: 90 }] },
  ],
  limitationWarnings: [] as string[],
};

describe.skipIf(!hasDb)("WorkoutSessionRepository.startSession auto-close transaction (real Postgres, 17b)", () => {
  const { db, pool } = createDbClient();
  const repo = new WorkoutSessionRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `stale-session-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `stale-session-${Date.now()}-${Math.random()}@example.test` })
      .returning({ id: users.id });
    return user!.id;
  }

  async function seedReadyPlan(tenantId: string, userId: string): Promise<string> {
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
        programJson: twoDaySessionsProgram,
      })
      .returning({ id: workoutPlans.id });
    return plan!.id;
  }

  async function seedActiveSession(
    tenantId: string,
    userId: string,
    workoutPlanId: string,
    startedAt: Date,
    day = 1,
  ): Promise<string> {
    const [session] = await db
      .insert(workoutSessions)
      .values({ tenantId, userId, workoutPlanId, status: "active", day, startedAt })
      .returning({ id: workoutSessions.id });
    const [exercise] = await db
      .insert(sessionExercises)
      .values({
        workoutSessionId: session!.id,
        exerciseIndex: 0,
        title: "Squat",
        restSeconds: 90,
      })
      .returning({ id: sessionExercises.id });
    await db.insert(setRecords).values([
      { sessionExerciseId: exercise!.id, setIndex: 0, targetReps: "5", completed: true, actualReps: 5, weightKg: "100" },
      { sessionExerciseId: exercise!.id, setIndex: 1, targetReps: "5", completed: false },
    ]);
    return session!.id;
  }

  it("auto-closes an aged session as abandoned (never completed), preserves its data, and returns the notice", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    const staleId = await seedActiveSession(tenantId, userId, planId, AGED_STARTED_AT, 1);

    const setCountBefore = await db.select().from(setRecords);
    const exerciseCountBefore = await db.select().from(sessionExercises);

    const outcome = await repo.startSession(tenantId, userId, planId, 2, NOW);

    expect(outcome?.kind).toBe("started");

    const [staleRow] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, staleId));
    expect(staleRow?.status).toBe("abandoned");
    // Direct assertion: auto-close NEVER writes completed.
    expect(staleRow?.status).not.toBe("completed");
    expect(staleRow?.completedAt).toBeNull();

    // Every session_exercises/set_records row belonging to the stale session
    // still exists — auto-close is a status update, never a delete.
    const exerciseRowsAfter = await db
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.workoutSessionId, staleId));
    expect(exerciseRowsAfter).toHaveLength(1);
    const setRowsAfter = await db
      .select()
      .from(setRecords)
      .where(eq(setRecords.sessionExerciseId, exerciseRowsAfter[0]!.id));
    expect(setRowsAfter).toHaveLength(2);

    const setCountAfter = await db.select().from(setRecords);
    const exerciseCountAfter = await db.select().from(sessionExercises);
    expect(setCountAfter.length).toBe(setCountBefore.length + 1); // +1 for the new session's set
    expect(exerciseCountAfter.length).toBe(exerciseCountBefore.length + 1);

    if (outcome?.kind === "started") {
      expect(outcome.autoClosedSession).toEqual({
        id: staleId,
        startedAt: AGED_STARTED_AT.toISOString(),
      });
    }
  });

  it("does not auto-close an under-threshold session — returns conflict and leaves the old row untouched", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    const activeId = await seedActiveSession(tenantId, userId, planId, UNDER_THRESHOLD_STARTED_AT, 1);

    const [before] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, activeId));

    const outcome = await repo.startSession(tenantId, userId, planId, 2, NOW);

    expect(outcome?.kind).toBe("conflict");
    if (outcome?.kind === "conflict") {
      expect(outcome.activeSessionId).toBe(activeId);
      expect(outcome.activeStartedAt).toBe(UNDER_THRESHOLD_STARTED_AT.toISOString());
    }

    const [after] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, activeId));
    expect(after?.status).toBe("active");
    expect(after?.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
  });

  it("resumes the same-plan-same-day session regardless of age, with no auto-close transition", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    const activeId = await seedActiveSession(tenantId, userId, planId, AGED_STARTED_AT, 1);

    const outcome = await repo.startSession(tenantId, userId, planId, 1, NOW);

    expect(outcome?.kind).toBe("resumed");

    const [row] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, activeId));
    expect(row?.status).toBe("active");
  });

  it("a concurrent double-tap on an aged session resolves to exactly one active row, one started + one resumed, no unique-violation error", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    await seedActiveSession(tenantId, userId, planId, AGED_STARTED_AT, 1);

    const [resultA, resultB] = await Promise.all([
      repo.startSession(tenantId, userId, planId, 2, NOW),
      repo.startSession(tenantId, userId, planId, 2, NOW),
    ]);

    const kinds = [resultA?.kind, resultB?.kind].sort();
    expect(kinds).toEqual(["resumed", "started"]);

    const activeRows = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.status, "active"));
    const activeForUser = activeRows.filter((row) => row.userId === userId);
    expect(activeForUser).toHaveLength(1);
  });

  it("phase 2 precedes phase 3 — a 404 (unknown day) leaves the stale row active, auto-closing nothing", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    const staleId = await seedActiveSession(tenantId, userId, planId, AGED_STARTED_AT, 1);

    const outcome = await repo.startSession(tenantId, userId, planId, 9, NOW);

    expect(outcome).toBeUndefined();

    const [row] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, staleId));
    expect(row?.status).toBe("active");
  });
});

describe.skipIf(!hasDb)("WorkoutSessionRepository.abandonSession (real Postgres, 17b Discard)", () => {
  const { db, pool } = createDbClient();
  const repo = new WorkoutSessionRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `stale-session-abandon-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `stale-session-abandon-${Date.now()}-${Math.random()}@example.test` })
      .returning({ id: users.id });
    return user!.id;
  }

  async function seedReadyPlan(tenantId: string, userId: string): Promise<string> {
    const [spec] = await db
      .insert(planSpecs)
      .values({ tenantId, userId, specJson: {}, confirmed: true })
      .returning({ id: planSpecs.id });
    const [plan] = await db
      .insert(workoutPlans)
      .values({ tenantId, userId, planSpecId: spec!.id, status: "ready", programJson: twoDaySessionsProgram })
      .returning({ id: workoutPlans.id });
    return plan!.id;
  }

  async function seedSession(
    tenantId: string,
    userId: string,
    workoutPlanId: string,
    status: "active" | "completed" | "abandoned",
  ): Promise<string> {
    const [session] = await db
      .insert(workoutSessions)
      .values({
        tenantId,
        userId,
        workoutPlanId,
        status,
        day: 1,
        completedAt: status === "completed" ? new Date() : null,
      })
      .returning({ id: workoutSessions.id });
    return session!.id;
  }

  it("transitions an active session to abandoned, preserving its data", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    const sessionId = await seedSession(tenantId, userId, planId, "active");

    const result = await repo.abandonSession(tenantId, userId, sessionId);

    expect(result.kind).toBe("abandoned");
    const [row] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId));
    expect(row?.status).toBe("abandoned");
    expect(row?.completedAt).toBeNull();
  });

  it("is idempotent — abandoning an already-abandoned session is a 200 no-op", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    const sessionId = await seedSession(tenantId, userId, planId, "abandoned");

    const result = await repo.abandonSession(tenantId, userId, sessionId);

    expect(result.kind).toBe("abandoned");
  });

  it("returns not_active for a completed session", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    const sessionId = await seedSession(tenantId, userId, planId, "completed");

    const result = await repo.abandonSession(tenantId, userId, sessionId);

    expect(result).toEqual({ kind: "not_active" });
  });

  it("returns not_found for another tenant's session, indistinguishable from nonexistent", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantA, userId);
    const sessionId = await seedSession(tenantA, userId, planId, "active");

    const result = await repo.abandonSession(tenantB, userId, sessionId);

    expect(result).toEqual({ kind: "not_found" });
  });
});

describe.skipIf(hasDb)("WorkoutSessionRepository.startSession / abandonSession (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
