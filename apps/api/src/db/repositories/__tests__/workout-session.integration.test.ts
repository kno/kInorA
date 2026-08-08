/**
 * Real-Postgres integration coverage for `WorkoutSessionRepository.startSession`'s
 * auto-close transaction, `abandonSession` (17b-stale-session-recovery), and
 * bodyweight-volume threading (17c-profile-body-metrics, PR 4).
 *
 * A mocked-db unit suite (`workout-session.test.ts`) already pins the guard
 * stances, the Branch A/B fast path, and the bodyweight-threading call sites
 * against a mocked chain. What only a real Postgres proves for PR 4: the
 * resolution rule's date-ordering against a REAL `user_weight_entries`
 * series (a mock cannot model Postgres's own row ordering), and that the
 * batched `listAllForUser` read genuinely does not scale with session count.
 *
 * This file predates PR 4 (17b) but was NEVER added to the real-Postgres CI
 * job's hardcoded file list (`.github/workflows/ci-cd.yml`) — one more
 * instance of #382. Added to that list in the SAME commit as this diff, so
 * both the pre-existing 17b coverage and this PR's new bodyweight-resolution
 * assertions actually execute, not just exist in the repo.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * `workout-session-dashboard.integration.test.ts`) — skipped when no real
 * Postgres is wired so the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDbClient } from "../../client.js";
import {
  planSpecs,
  sessionExercises,
  setRecords,
  tenants,
  userWeightEntries,
  users,
  workoutPlans,
  workoutSessions,
} from "../../schema.js";
import { WorkoutSessionRepository } from "../workout-session.js";
import { UserWeightEntryRepository } from "../user-weight-entry.js";
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

describe.skipIf(!hasDb)("WorkoutSessionRepository.listSessionHistory (real Postgres, 17b PR 3)", () => {
  const { db, pool } = createDbClient();
  const repo = new WorkoutSessionRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `stale-session-history-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `stale-session-history-${Date.now()}-${Math.random()}@example.test` })
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

  /** One session with one logged, completed set of `weightKg * 5 reps` volume. */
  async function seedHistorySession(
    tenantId: string,
    userId: string,
    workoutPlanId: string,
    status: "completed" | "abandoned",
    startedAt: Date,
    completedAt: Date | null,
    weightKg: string,
  ): Promise<string> {
    const [session] = await db
      .insert(workoutSessions)
      .values({ tenantId, userId, workoutPlanId, status, day: 1, startedAt, completedAt })
      .returning({ id: workoutSessions.id });
    const [exercise] = await db
      .insert(sessionExercises)
      .values({ workoutSessionId: session!.id, exerciseIndex: 0, title: "Squat", restSeconds: 90 })
      .returning({ id: sessionExercises.id });
    await db
      .insert(setRecords)
      .values({ sessionExerciseId: exercise!.id, setIndex: 0, targetReps: "5", completed: true, actualReps: 5, weightKg });
    return session!.id;
  }

  it("orders by coalesce(completed_at, started_at) DESC, so an abandoned session's NULL completed_at does not float it to the top", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);

    // Completed 5 days before the abandoned session below started. Under a
    // naive `ORDER BY completed_at DESC`, Postgres sorts NULL FIRST, so this
    // older-but-actually-completed row would wrongly rank BELOW the
    // abandoned one only if the abandoned one is more recent by
    // `coalesce` — which it is here, so this asserts the correct order
    // rather than accidentally passing either way.
    const olderCompletedId = await seedHistorySession(
      tenantId,
      userId,
      planId,
      "completed",
      new Date("2026-08-01T09:00:00Z"),
      new Date("2026-08-01T10:00:00Z"),
      "50",
    );
    const abandonedId = await seedHistorySession(
      tenantId,
      userId,
      planId,
      "abandoned",
      new Date("2026-08-06T09:00:00Z"),
      null,
      "20",
    );

    const entries = await repo.listSessionHistory(tenantId, userId, { limit: 10, offset: 0 });

    expect(entries.map((entry) => entry.session.id)).toEqual([abandonedId, olderCompletedId]);
  });

  it("excludes an abandoned session from the completed-only trend chain and still computes its own totals", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);

    // Oldest → newest by coalesce(completed_at, started_at): completed (50),
    // abandoned with only 1 of many sets logged (25), completed (60).
    const oldestCompletedId = await seedHistorySession(
      tenantId,
      userId,
      planId,
      "completed",
      new Date("2026-08-01T09:00:00Z"),
      new Date("2026-08-01T10:00:00Z"),
      "10",
    );
    const abandonedId = await seedHistorySession(
      tenantId,
      userId,
      planId,
      "abandoned",
      new Date("2026-08-03T09:00:00Z"),
      null,
      "5",
    );
    const newestCompletedId = await seedHistorySession(
      tenantId,
      userId,
      planId,
      "completed",
      new Date("2026-08-05T09:00:00Z"),
      new Date("2026-08-05T10:00:00Z"),
      "12",
    );

    const entries = await repo.listSessionHistory(tenantId, userId, { limit: 10, offset: 0 });
    const newest = entries.find((entry) => entry.session.id === newestCompletedId);
    const abandoned = entries.find((entry) => entry.session.id === abandonedId);
    const oldest = entries.find((entry) => entry.session.id === oldestCompletedId);

    // Newest completed session pairs with the OLDEST completed session,
    // skipping the abandoned row that sits between them — otherwise a
    // 1-of-many-sets abandoned session would make this look like a huge
    // volume gain (60 vs. 25) instead of the true, modest gain (60 vs. 50).
    expect(newest?.trend).toEqual({ volumeDelta: 10, direction: "up" });
    // The abandoned session never gets a trend of its own.
    expect(abandoned?.trend).toBeUndefined();
    // Truthful about the one set it actually logged before it was closed.
    expect(abandoned?.totalVolume).toBe(25);
    // No completed session after it in this fixture, so no trend either.
    expect(oldest?.trend).toBeUndefined();
  });
});

describe.skipIf(!hasDb)("WorkoutSessionRepository — bodyweight volume threading (real Postgres, 17c PR 4)", () => {
  const { db, pool } = createDbClient();
  const repo = new WorkoutSessionRepository(db, new UserWeightEntryRepository(db));

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `bodyweight-volume-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `bodyweight-volume-${Date.now()}-${Math.random()}@example.test` })
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

  /** One completed session with one bodyweight-only set (no logged weightKg). */
  async function seedBodyweightSession(
    tenantId: string,
    userId: string,
    workoutPlanId: string,
    startedAt: Date,
    completedAt: Date,
    actualReps: number,
  ): Promise<string> {
    const [session] = await db
      .insert(workoutSessions)
      .values({ tenantId, userId, workoutPlanId, status: "completed", day: 1, startedAt, completedAt })
      .returning({ id: workoutSessions.id });
    const [exercise] = await db
      .insert(sessionExercises)
      .values({ workoutSessionId: session!.id, exerciseIndex: 0, title: "Push-up", restSeconds: 60 })
      .returning({ id: sessionExercises.id });
    await db
      .insert(setRecords)
      .values({ sessionExerciseId: exercise!.id, setIndex: 0, targetReps: "15", completed: true, actualReps, weightKg: null });
    return session!.id;
  }

  it("resolves the session-date-nearest weight entry against a REAL series and applies it to totalVolume", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);

    // Entries straddling the session so the "nearest at-or-before" rule
    // (not "most recent regardless of date") is what a mock cannot prove.
    await db.insert(userWeightEntries).values([
      { userId, weightKg: "80.00", recordedAt: new Date("2026-06-01T00:00:00Z") },
      { userId, weightKg: "78.00", recordedAt: new Date("2026-07-01T00:00:00Z") },
      { userId, weightKg: "90.00", recordedAt: new Date("2026-09-01T00:00:00Z") },
    ]);

    const sessionId = await seedBodyweightSession(
      tenantId,
      userId,
      planId,
      new Date("2026-08-01T08:00:00Z"),
      new Date("2026-08-01T09:00:00Z"),
      15,
    );

    const entries = await repo.listSessionHistory(tenantId, userId, { limit: 10, offset: 0 });
    const entry = entries.find((e) => e.session.id === sessionId);

    // 2026-08-01 is nearest-at-or-before the 2026-07-01 entry, NOT the
    // 2026-09-01 entry (which is after the session) or the 2026-06-01 one
    // (which is not the nearest).
    expect(entry?.session.resolvedBodyweightKg).toBe(78);
    expect(entry?.totalVolume).toBe(78 * 15);
  });

  it("does not let a later weigh-in rewrite an already-resolved older session (settled-history pin)", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);

    await db.insert(userWeightEntries).values({
      userId,
      weightKg: "80.00",
      recordedAt: new Date("2026-04-01T00:00:00Z"),
    });

    const sessionId = await seedBodyweightSession(
      tenantId,
      userId,
      planId,
      new Date("2026-05-01T08:00:00Z"),
      new Date("2026-05-01T09:00:00Z"),
      10,
    );

    const before = await repo.listSessionHistory(tenantId, userId, { limit: 10, offset: 0 });
    const beforeEntry = before.find((e) => e.session.id === sessionId);
    expect(beforeEntry?.session.resolvedBodyweightKg).toBe(80);

    // A later reading, recorded AFTER the session date, must not change it.
    await db.insert(userWeightEntries).values({
      userId,
      weightKg: "76.00",
      recordedAt: new Date("2026-06-01T00:00:00Z"),
    });

    const after = await repo.listSessionHistory(tenantId, userId, { limit: 10, offset: 0 });
    const afterEntry = after.find((e) => e.session.id === sessionId);
    expect(afterEntry?.session.resolvedBodyweightKg).toBe(80);
  });

  it("issues exactly one weight-series query for a page of many sessions — never one per session", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);

    await db.insert(userWeightEntries).values({
      userId,
      weightKg: "80.00",
      recordedAt: new Date("2026-01-01T00:00:00Z"),
    });

    for (let i = 0; i < 5; i++) {
      await seedBodyweightSession(
        tenantId,
        userId,
        planId,
        new Date(`2026-0${i + 2}-01T08:00:00Z`),
        new Date(`2026-0${i + 2}-01T09:00:00Z`),
        10,
      );
    }

    const listAllForUserSpy = vi.spyOn(UserWeightEntryRepository.prototype, "listAllForUser");
    const entries = await repo.listSessionHistory(tenantId, userId, { limit: 10, offset: 0 });

    expect(listAllForUserSpy).toHaveBeenCalledTimes(1);
    expect(entries.filter((e) => e.session.resolvedBodyweightKg === 80)).toHaveLength(5);
    listAllForUserSpy.mockRestore();
  });
});

describe.skipIf(hasDb)("WorkoutSessionRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
