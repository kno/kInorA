/**
 * Real-Postgres integration coverage for `WorkoutPlanRepository.setArchived`
 * and the `includeArchived` filter (17d PR B).
 *
 * The mocked-db unit suite (`workout-plan.test.ts`) proves the SQL shape
 * (the `archived_at IS NULL` condition is present/absent, `setArchived`'s
 * COALESCE idempotency) against a db double that cannot itself enforce a
 * WHERE clause. Only a real Postgres proves the acceptance criterion this
 * change exists for: archiving a plan with completed sessions destroys
 * ZERO `workout_sessions` rows, and unarchive restores default-list
 * visibility exactly.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * `workout-session-dashboard.integration.test.ts`) — skipped when no real
 * Postgres is wired so the default `vitest run` stays hermetic. Picked up
 * automatically by the CI integration glob (#392) — no workflow edit needed.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import { planSpecs, tenants, users, workoutPlans, workoutSessions } from "../../schema.js";
import { WorkoutPlanRepository } from "../workout-plan.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("WorkoutPlanRepository archive (real Postgres, 17d PR B)", () => {
  const { db, pool } = createDbClient();
  const repo = new WorkoutPlanRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `plan-archive-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `plan-archive-${Date.now()}-${Math.random()}@example.test` })
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
        programJson: {
          weeklySessions: [{ day: 1, title: "Full Body", exercises: [] }],
          limitationWarnings: [],
        },
      })
      .returning({ id: workoutPlans.id });
    return plan!.id;
  }

  async function seedCompletedSession(
    tenantId: string,
    userId: string,
    workoutPlanId: string
  ): Promise<void> {
    await db.insert(workoutSessions).values({
      tenantId,
      userId,
      workoutPlanId,
      status: "completed",
      startedAt: new Date("2026-07-01T09:00:00.000Z"),
      completedAt: new Date("2026-07-01T10:00:00.000Z"),
    });
  }

  async function countSessions(workoutPlanId: string): Promise<number> {
    const rows = await db
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(eq(workoutSessions.workoutPlanId, workoutPlanId));
    return rows.length;
  }

  it("archiving a plan with completed sessions destroys ZERO workout_sessions rows", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    await seedCompletedSession(tenantId, userId, planId);
    await seedCompletedSession(tenantId, userId, planId);

    const before = await countSessions(planId);
    const result = await repo.setArchived(tenantId, userId, planId, true);
    const after = await countSessions(planId);

    expect(result?.archivedAt).not.toBeNull();
    expect(after).toBe(before);
    expect(after).toBe(2);
  });

  it("an archived plan is excluded from findAllByUser's default (filtered) list", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    await repo.setArchived(tenantId, userId, planId, true);

    const defaultList = await repo.findAllByUser(tenantId, userId);
    const includingArchived = await repo.findAllByUser(tenantId, userId, { includeArchived: true });

    expect(defaultList.find((p) => p.id === planId)).toBeUndefined();
    expect(includingArchived.find((p) => p.id === planId)).toBeDefined();
  });

  it("unarchive restores default-list visibility exactly", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);
    await repo.setArchived(tenantId, userId, planId, true);

    const unarchived = await repo.setArchived(tenantId, userId, planId, false);
    const defaultList = await repo.findAllByUser(tenantId, userId);

    expect(unarchived?.archivedAt).toBeNull();
    expect(defaultList.find((p) => p.id === planId)).toBeDefined();
  });

  it("a repeated archive call does not move the timestamp (idempotent)", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const planId = await seedReadyPlan(tenantId, userId);

    const first = await repo.setArchived(tenantId, userId, planId, true);
    const second = await repo.setArchived(tenantId, userId, planId, true);

    expect(second?.archivedAt?.getTime()).toBe(first?.archivedAt?.getTime());
  });
});

describe.skipIf(hasDb)("WorkoutPlanRepository archive (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
