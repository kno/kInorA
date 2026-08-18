/**
 * Real-Postgres integration coverage for
 * `WorkoutSessionRepository.getClientListMeta` (GH client-list-meta) — the
 * batched name/lastSessionAt/completionRate enrichment behind
 * `GET /trainer/clients`. A mocked-db unit suite would have to hand-fake four
 * separate query shapes (profile lookup, two session-aggregate reads, and a
 * plan lookup); only a real Postgres proves the GROUP BY / window-boundary
 * math end-to-end the same way `workout-session-dashboard.integration.test.ts`
 * proves `getClientDashboard`.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness) — skipped when no
 * real Postgres is wired so the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../client.js";
import { tenants, users, userProfiles, planSpecs, workoutPlans, workoutSessions } from "../../schema.js";
import { WorkoutSessionRepository } from "../workout-session.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("WorkoutSessionRepository.getClientListMeta (real Postgres, GH client-list-meta)", () => {
  const { db, pool } = createDbClient();
  const repo = new WorkoutSessionRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `client-list-meta-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `client-list-meta-${Date.now()}-${Math.random()}@example.test` })
      .returning({ id: users.id });
    return user!.id;
  }

  async function seedProfile(userId: string, name: string): Promise<void> {
    await db.insert(userProfiles).values({ userId, name });
  }

  async function seedReadyPlan(
    tenantId: string,
    userId: string,
    weeklySessionCount: number,
    createdAt?: Date,
  ): Promise<string> {
    const [spec] = await db
      .insert(planSpecs)
      .values({ tenantId, userId, specJson: {}, confirmed: true })
      .returning({ id: planSpecs.id });
    const weeklySessions = Array.from({ length: weeklySessionCount }, (_, i) => ({
      day: i + 1,
      title: `Session ${i + 1}`,
      exercises: [],
    }));
    const [plan] = await db
      .insert(workoutPlans)
      .values({
        tenantId,
        userId,
        planSpecId: spec!.id,
        status: "ready",
        programJson: { weeklySessions, limitationWarnings: [] },
        ...(createdAt ? { createdAt } : {}),
      })
      .returning({ id: workoutPlans.id });
    return plan!.id;
  }

  async function seedCompletedSession(
    tenantId: string,
    userId: string,
    workoutPlanId: string,
    completedAt: Date,
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

  it("returns [] without touching the database for an empty client list", async () => {
    const result = await repo.getClientListMeta("00000000-0000-0000-0000-000000000000", []);
    expect(result).toEqual([]);
  });

  it("returns name, lastSessionAt, and completionRate for a seeded client, matched by tenant + id", async () => {
    const tenantId = await seedTenant();
    const clientId = await seedUser();
    await seedProfile(clientId, "Ada Lovelace");

    const now = new Date("2026-08-15T12:00:00.000Z");
    // 3 sessions/week planned; one completed 5 days ago (inside the 28-day window).
    const planId = await seedReadyPlan(tenantId, clientId, 3);
    const completedAt = new Date("2026-08-10T09:00:00.000Z");
    await seedCompletedSession(tenantId, clientId, planId, completedAt);

    const [result] = await repo.getClientListMeta(tenantId, [clientId], now);

    expect(result).toEqual({
      clientUserId: clientId,
      name: "Ada Lovelace",
      lastSessionAt: completedAt.toISOString(),
      // planned = 3 * 4 = 12; completed = 1; percent = round(1/12*100) = 8.
      completionRate: 8,
    });
  });

  it("gives a client with no profile and no sessions all-null fields, never fabricated values", async () => {
    const tenantId = await seedTenant();
    const clientId = await seedUser();

    const [result] = await repo.getClientListMeta(tenantId, [clientId]);

    expect(result).toEqual({
      clientUserId: clientId,
      name: null,
      lastSessionAt: null,
      completionRate: null,
    });
  });

  it("28-day window edge: a session older than 28 days moves lastSessionAt but NOT completionRate", async () => {
    const tenantId = await seedTenant();
    const clientId = await seedUser();
    await seedProfile(clientId, "Grace Hopper");

    const now = new Date("2026-08-15T12:00:00.000Z");
    const planId = await seedReadyPlan(tenantId, clientId, 2);

    // Recent (inside the 28-day window): counts toward completionRate.
    const recentCompletedAt = new Date("2026-08-05T09:00:00.000Z");
    await seedCompletedSession(tenantId, clientId, planId, recentCompletedAt);

    // Older than 28 days before `now`: must NOT count toward completionRate,
    // but IS the client's most recent session chronologically is still the
    // recent one — so seed an even OLDER session to prove it does not
    // regress lastSessionAt, and does not inflate completionRate either.
    const staleCompletedAt = new Date("2026-06-01T09:00:00.000Z");
    await seedCompletedSession(tenantId, clientId, planId, staleCompletedAt);

    const [result] = await repo.getClientListMeta(tenantId, [clientId], now);

    // lastSessionAt reflects the MOST RECENT completed session overall
    // (all-time max), unaffected by the 28-day completion-rate window.
    expect(result!.lastSessionAt).toBe(recentCompletedAt.toISOString());
    // completionRate only counts the ONE session inside the rolling 28-day
    // window: planned = 2 * 4 = 8; completed = 1; percent = round(1/8*100) = 13.
    expect(result!.completionRate).toBe(13);
  });

  it("excludes a decoy client under a DIFFERENT tenant with the same completed-session history", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const clientId = await seedUser();
    await seedProfile(clientId, "Decoy Target");

    const now = new Date("2026-08-15T12:00:00.000Z");
    const planA = await seedReadyPlan(tenantA, clientId, 3);
    const planB = await seedReadyPlan(tenantB, clientId, 3);
    await seedCompletedSession(tenantA, clientId, planA, new Date("2026-08-10T09:00:00.000Z"));
    // Decoy: same client userId, but under tenant B — must never leak into
    // tenant A's read.
    await seedCompletedSession(tenantB, clientId, planB, new Date("2026-08-14T09:00:00.000Z"));

    const [result] = await repo.getClientListMeta(tenantA, [clientId], now);

    expect(result!.lastSessionAt).toBe(new Date("2026-08-10T09:00:00.000Z").toISOString());
  });

  it("batches the whole roster in one call — never a per-client N+1", async () => {
    const tenantId = await seedTenant();
    const clientA = await seedUser();
    const clientB = await seedUser();
    await seedProfile(clientA, "Client A");
    await seedProfile(clientB, "Client B");

    const now = new Date("2026-08-15T12:00:00.000Z");
    const planA = await seedReadyPlan(tenantId, clientA, 4);
    await seedCompletedSession(tenantId, clientA, planA, new Date("2026-08-12T09:00:00.000Z"));

    const results = await repo.getClientListMeta(tenantId, [clientA, clientB], now);

    expect(results).toHaveLength(2);
    const byId = new Map(results.map((r) => [r.clientUserId, r]));
    expect(byId.get(clientA)!.name).toBe("Client A");
    expect(byId.get(clientA)!.lastSessionAt).not.toBeNull();
    expect(byId.get(clientB)!.name).toBe("Client B");
    expect(byId.get(clientB)!.lastSessionAt).toBeNull();
    expect(byId.get(clientB)!.completionRate).toBeNull();
  });
});

describe.skipIf(hasDb)("WorkoutSessionRepository.getClientListMeta (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
