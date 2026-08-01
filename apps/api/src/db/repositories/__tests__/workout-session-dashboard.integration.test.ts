/**
 * Real-Postgres integration coverage for `WorkoutSessionRepository.getClientDashboard`
 * (15b-v2-trainer-dashboard-branding, Phase S1). A mocked-db unit suite
 * (`workout-session.test.ts`) proves the aggregation shape; only a real
 * Postgres can prove req 3 (design.md "Tenant-Safe Dashboard Data"): a
 * decoy completed session for the SAME client under a DIFFERENT tenant is
 * excluded from the returned metrics.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * `trainer-assignment.integration.test.ts`) — skipped when no real Postgres
 * is wired so the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../client.js";
import { tenants, users, planSpecs, workoutPlans, workoutSessions } from "../../schema.js";
import { WorkoutSessionRepository } from "../workout-session.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("WorkoutSessionRepository.getClientDashboard (real Postgres, 15b-v2 S1)", () => {
  const { db, pool } = createDbClient();
  const repo = new WorkoutSessionRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `dashboard-tenant-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `dashboard-${Date.now()}-${Math.random()}@example.test` })
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
        programJson: { weeklySessions: [{ day: 1, title: "Full Body", exercises: [] }], limitationWarnings: [] },
      })
      .returning({ id: workoutPlans.id });
    return plan!.id;
  }

  async function seedCompletedSession(
    tenantId: string,
    userId: string,
    workoutPlanId: string,
    completedAt: Date
  ): Promise<void> {
    await db.insert(workoutSessions).values({
      tenantId,
      userId,
      workoutPlanId,
      status: "completed",
      startedAt: new Date(completedAt.getTime() - 30 * 60 * 1000),
      completedAt,
    });
  }

  it("1.6/req3 excludes a decoy completed session belonging to a DIFFERENT tenant for the same client userId", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const clientUserId = await seedUser();

    const planA = await seedReadyPlan(tenantA, clientUserId);
    const planB = await seedReadyPlan(tenantB, clientUserId);

    const now = new Date("2026-07-17T12:00:00.000Z");
    // One completed session in tenant A (the tenant under test).
    await seedCompletedSession(tenantA, clientUserId, planA, new Date("2026-07-15T09:00:00.000Z"));
    // Decoy: same client userId, but a DIFFERENT tenant (B) — must never be
    // aggregated when reading tenant A's dashboard.
    await seedCompletedSession(tenantB, clientUserId, planB, new Date("2026-07-16T09:00:00.000Z"));

    const dashboard = await repo.getClientDashboard(tenantA, clientUserId, now);

    // Only the tenant-A session counts toward recentSessions/completionRate.
    expect(dashboard.recentSessions).toHaveLength(1);
    expect(dashboard.recentSessions[0]!.date).toBe(new Date("2026-07-15T09:00:00.000Z").toISOString());
    expect(dashboard.completionRate.completed).toBe(1);
  });
});

describe.skipIf(hasDb)("WorkoutSessionRepository.getClientDashboard (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
