/**
 * Real-Postgres integration coverage for the trainer-scoped progress reads
 * (GH #447): `GET /trainer/clients/:clientUserId/progress/stats`.
 *
 * Wires the ACTUAL `trainerRoutes` plugin to REAL `TrainerAssignmentRepository`
 * / `BillingStateReaderRepository` / `WorkoutSessionRepository` instances
 * against Postgres — the same pattern as `trainer.integration.test.ts` and
 * `plan-client-owned.integration.test.ts`. Proves two things a mocked-repo
 * route suite cannot:
 *   1. A real grant → assign → read round-trip: a trainer with an ACTIVE
 *      `trainer_client_assignments` row sees the CLIENT's real stats.
 *   2. Revoking that assignment loses access IMMEDIATELY — the very next read
 *      denies with a flat 403, proving `findActiveAssignment`'s
 *      `status = "active"` filter (not an in-memory/cached decision) is what
 *      gates every request.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness) — skipped when no
 * real Postgres is wired so the default `vitest run` stays hermetic.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createDbClient } from "../../db/client.js";
import { tenants, users, memberships, tenantBillingStates, planSpecs, workoutPlans, workoutSessions } from "../../db/schema.js";
import { authPlugin } from "../../auth/plugin.js";
import { trainerRoutes } from "../trainer.js";
import { TrainerAssignmentRepository } from "../../db/repositories/trainer-assignment.js";
import { MembershipRepository, UserRepository } from "../../db/repositories/auth-context.js";
import { BillingStateReaderRepository } from "../../db/repositories/billing-quota.js";
import { WorkoutSessionRepository } from "../../db/repositories/workout-session.js";
import { createCyclingAuthMockDb, buildSessionRow, buildActiveMembershipRow, VALID_TOKEN } from "../../test-support/auth-mocks.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("GET /trainer/clients/:clientUserId/progress/stats (real Postgres, GH #447)", () => {
  const { db, pool } = createDbClient();
  const assignmentRepo = new TrainerAssignmentRepository(db);
  const membershipRepo = new MembershipRepository(db);
  const userRepo = new UserRepository(db);
  const entitlementReader = new BillingStateReaderRepository(db);
  const progressRepo = new WorkoutSessionRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `trainer-progress-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `trainer-progress-${Date.now()}-${Math.random()}@example.test` })
      .returning({ id: users.id });
    return user!.id;
  }

  async function seedTrainerBilling(tenantId: string): Promise<void> {
    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "trainer",
      status: "active",
      source: "system",
    });
  }

  async function seedActiveMembership(
    tenantId: string,
    userId: string,
    role: "owner" | "member" | "trainer",
  ): Promise<void> {
    await db.insert(memberships).values({ tenantId, userId, role, status: "active" });
  }

  async function seedCompletedSession(tenantId: string, userId: string, completedAt: Date): Promise<void> {
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
    await db.insert(workoutSessions).values({
      tenantId,
      userId,
      workoutPlanId: plan!.id,
      status: "completed",
      startedAt: new Date(completedAt.getTime() - 30 * 60 * 1000),
      completedAt,
    });
  }

  async function buildApp(sessionUserId: string, sessionTenantId: string, role: "member" | "trainer") {
    const built = Fastify();
    // `createCyclingAuthMockDb` (not the one-shot `createAuthMockDb`) since
    // the revoke-then-reread scenario issues MULTIPLE requests against the
    // SAME app instance.
    const authDb = createCyclingAuthMockDb({
      sessionRows: [buildSessionRow({ tenantId: sessionTenantId, userId: sessionUserId })],
      membershipRows: [buildActiveMembershipRow({ tenantId: sessionTenantId, userId: sessionUserId, role })],
    });
    await built.register(authPlugin, { db: authDb });
    await built.register(trainerRoutes, {
      assignmentRepo,
      membershipRepo,
      userRepo,
      entitlementReader,
      dashboardRepo: progressRepo,
      planRepo: { findLatestReadyByOwner: async () => undefined },
      progressRepo,
    });
    return built;
  }

  it("grant -> assign -> read: a trainer with an active assignment reads the CLIENT's real stats", async () => {
    const trainerTenantId = await seedTenant();
    await seedTrainerBilling(trainerTenantId);
    const trainerId = await seedUser();
    await seedActiveMembership(trainerTenantId, trainerId, "trainer");
    const clientId = await seedUser();
    await seedActiveMembership(trainerTenantId, clientId, "member");

    // Grant: invite -> accept, replicated directly (this suite exercises the
    // progress read, not the invite/accept flow already covered by
    // `trainer.integration.test.ts`).
    await assignmentRepo.create(trainerTenantId, trainerId, clientId, "invited");
    const created = await assignmentRepo.findByClientUserId(clientId);
    await assignmentRepo.updateStatus(trainerTenantId, created!.id, "active");

    // A real completed session for the CLIENT, well within the "month" range.
    const now = new Date();
    await seedCompletedSession(trainerTenantId, clientId, now);

    app = await buildApp(trainerId, trainerTenantId, "trainer");

    const res = await app.inject({
      method: "GET",
      url: `/trainer/clients/${clientId}/progress/stats`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessionCount: { value: number } };
    expect(body.sessionCount.value).toBe(1);
  });

  it("revoking the assignment loses access immediately — the next read denies with a flat 403", async () => {
    const trainerTenantId = await seedTenant();
    await seedTrainerBilling(trainerTenantId);
    const trainerId = await seedUser();
    await seedActiveMembership(trainerTenantId, trainerId, "trainer");
    const clientId = await seedUser();
    await seedActiveMembership(trainerTenantId, clientId, "member");

    await assignmentRepo.create(trainerTenantId, trainerId, clientId, "invited");
    const created = await assignmentRepo.findByClientUserId(clientId);
    await assignmentRepo.updateStatus(trainerTenantId, created!.id, "active");

    app = await buildApp(trainerId, trainerTenantId, "trainer");

    const firstRes = await app.inject({
      method: "GET",
      url: `/trainer/clients/${clientId}/progress/stats`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(firstRes.statusCode).toBe(200);

    // Trainer revokes their own assignment (the same transition
    // `POST /trainer/clients/:clientUserId/revoke` performs).
    await assignmentRepo.updateStatus(trainerTenantId, created!.id, "revoked");

    const secondRes = await app.inject({
      method: "GET",
      url: `/trainer/clients/${clientId}/progress/stats`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(secondRes.statusCode).toBe(403);
  });
});

describe.skipIf(hasDb)("GET /trainer/clients/:clientUserId/progress/stats (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
