/**
 * Real-Postgres E2E coverage for `POST /clients/:clientUserId/plan-specs`
 * (15a-v2-trainer-account-access, Slice 4, task 4.6): invite → accept →
 * trainer creates a plan for the client → the plan is persisted OWNED BY the
 * client (not the trainer) → generation completes → the trainer's OWN quota
 * (not the client's) is consumed → a trainer with no active assignment is
 * denied before any write.
 *
 * Wires the ACTUAL `planRoutes` plugin to REAL `PlanSpecRepository` /
 * `WorkoutPlanRepository` / `PlanDraftRepository` / `TrainerAssignmentRepository`
 * / `BillingStateReaderRepository` / `QuotaLedgerRepository` instances against
 * Postgres — the same pattern as `trainer.integration.test.ts`. Opt-in via
 * `DATABASE_URL`; skipped when no real Postgres is wired so `vitest run` stays
 * hermetic by default.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createDbClient } from "../../db/client.js";
import { and, eq } from "drizzle-orm";
import { tenants, users, memberships, tenantBillingStates, billingUsageLedger } from "../../db/schema.js";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes } from "../plan.js";
import { PlanSpecRepository } from "../../db/repositories/plan-spec.js";
import { PlanDraftRepository } from "../../db/repositories/plan-draft.js";
import { WorkoutPlanRepository } from "../../db/repositories/workout-plan.js";
import { TrainerAssignmentRepository } from "../../db/repositories/trainer-assignment.js";
import { BillingStateReaderRepository, QuotaLedgerRepository } from "../../db/repositories/billing-quota.js";
import { CheckAndConsumeQuota } from "../../billing/quota-consumption.js";
import { CheckEntitlement } from "../../billing/entitlement.js";
import { PlanGenerationService } from "../../ai/generation-service.js";
import { MockPlanGenerator } from "../../ai/mock-generator.js";
import { createPlanRouteRepo } from "../../plan-route-repo.js";
import {
  createCyclingAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
  VALID_TOKEN,
} from "../../test-support/auth-mocks.js";

const hasDb = Boolean(process.env.DATABASE_URL);

const specInput = {
  goal: "strength",
  location: "gym",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  equipment: ["barbell"],
  limitations: [],
};

describe.skipIf(!hasDb)(
  "POST /clients/:clientUserId/plan-specs (real Postgres, 15a-v2 Slice 4)",
  () => {
    const { db, pool } = createDbClient();
    const planSpecRepo = new PlanSpecRepository(db);
    const planDraftRepo = new PlanDraftRepository(db);
    const workoutPlanRepo = new WorkoutPlanRepository(db);
    const assignmentRepo = new TrainerAssignmentRepository(db);
    const entitlementReader = new BillingStateReaderRepository(db);
    const quotaLedgerRepo = new QuotaLedgerRepository(db);
    const checkEntitlement = new CheckEntitlement(entitlementReader);
    const checkAndConsumeQuota = new CheckAndConsumeQuota(checkEntitlement, quotaLedgerRepo);

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
        .values({ name: `plan-client-owned-${Date.now()}-${Math.random()}` })
        .returning({ id: tenants.id });
      return tenant!.id;
    }

    async function seedUser(): Promise<string> {
      const [user] = await db
        .insert(users)
        .values({ email: `plan-client-owned-${Date.now()}-${Math.random()}@example.test` })
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

    async function buildApp(sessionUserId: string, sessionTenantId: string, role: "member" | "trainer") {
      const built = Fastify();
      const authDb = createCyclingAuthMockDb({
        sessionRows: [buildSessionRow({ tenantId: sessionTenantId, userId: sessionUserId })],
        membershipRows: [buildActiveMembershipRow({ tenantId: sessionTenantId, userId: sessionUserId, role })],
      });
      await built.register(authPlugin, { db: authDb });
      const repo = createPlanRouteRepo({ database: db, planSpecRepo, planDraftRepo, workoutPlanRepo });
      const generationService = new PlanGenerationService(new MockPlanGenerator(), planSpecRepo, workoutPlanRepo);
      await built.register(planRoutes, {
        repo,
        generationService,
        billing: {
          checkAndConsume: (scope, feature, operationKey) =>
            checkAndConsumeQuota.checkAndConsume(scope, feature, operationKey),
        },
        trainerAccess: { assignmentRepo, entitlementReader },
      });
      return built;
    }

    it("creates a client-owned plan, consumes the TRAINER's own quota, and generation completes owned by the client", async () => {
      const trainerTenantId = await seedTenant();
      await seedTrainerBilling(trainerTenantId);
      const trainerId = await seedUser();
      await seedActiveMembership(trainerTenantId, trainerId, "trainer");
      const clientId = await seedUser();
      // Client joins the trainer's tenant + gets an ACTIVE assignment (the
      // Slice 3 invite/accept outcome, replicated directly here since this
      // suite only exercises Slice 4's plan-creation route).
      await seedActiveMembership(trainerTenantId, clientId, "member");
      await assignmentRepo.create(trainerTenantId, trainerId, clientId, "invited");
      const created = await assignmentRepo.findByClientUserId(clientId);
      await assignmentRepo.updateStatus(trainerTenantId, created!.id, "active");

      app = await buildApp(trainerId, trainerTenantId, "trainer");

      const res = await app.inject({
        method: "POST",
        url: `/clients/${clientId}/plan-specs`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: specInput,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; planId: string; status: string };
      expect(body.status).toBe("generating");

      // The persisted plan_specs row is owned by the CLIENT, not the trainer.
      const specRow = await planSpecRepo.findConfirmedById(trainerTenantId, clientId, body.id);
      expect(specRow).toBeDefined();
      expect(specRow!.userId).toBe(clientId);

      // A second identical create-for-client call also succeeds (the trainer
      // tier's default limit has ample headroom) — repeated client-plan
      // creation stays metered against the SAME trainer-tenant ledger without
      // erroring out.
      const secondRes = await app.inject({
        method: "POST",
        url: `/clients/${clientId}/plan-specs`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { ...specInput, name: "second" },
      });
      expect(secondRes.statusCode).toBe(201);

      // Direct proof of task 4.3: the ledger rows for BOTH consumes are keyed
      // by the TRAINER's own (tenantId, userId) — never the client's — even
      // though the client owns the resulting plan_specs/workout_plans rows.
      const ledgerRows = await db
        .select()
        .from(billingUsageLedger)
        .where(
          and(
            eq(billingUsageLedger.tenantId, trainerTenantId),
            eq(billingUsageLedger.userId, trainerId),
            eq(billingUsageLedger.feature, "plan_generation"),
          ),
        );
      expect(ledgerRows).toHaveLength(2);
      expect(ledgerRows.every((r) => r.decision === "allowed")).toBe(true);
      const clientLedgerRows = await db
        .select()
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.userId, clientId));
      expect(clientLedgerRows).toHaveLength(0);

      // Generation completes asynchronously (fire-and-forget) — poll until the
      // workout_plans row for this spec reaches "ready", owned by the client.
      await vi.waitFor(async () => {
        const plan = await workoutPlanRepo.findLatestByPlanSpec(trainerTenantId, clientId, body.id);
        expect(plan?.status).toBe("ready");
      });

      // Isolation: a DIFFERENT client (never assigned to this trainer) reading
      // their own workout-plans list never sees this plan (repo filter
      // unchanged — (tenantId, userId) scoped exactly as before this slice).
      const otherClientId = await seedUser();
      await seedActiveMembership(trainerTenantId, otherClientId, "member");
      const otherClientApp = await buildApp(otherClientId, trainerTenantId, "member");
      const otherClientPlans = await otherClientApp.inject({
        method: "GET",
        url: "/workout-plans",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(otherClientPlans.json()).toEqual([]);
      await otherClientApp.close();

      // The client themself sees the plan under a session scoped to the
      // trainer's tenant (their newly-active dual membership).
      const clientApp = await buildApp(clientId, trainerTenantId, "member");
      const clientPlans = await clientApp.inject({
        method: "GET",
        url: "/workout-plans",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(clientPlans.statusCode).toBe(200);
      expect((clientPlans.json() as unknown[]).length).toBeGreaterThanOrEqual(1);
      await clientApp.close();
    });

    it("denies (403) a trainer with no active assignment to the client — nothing created", async () => {
      const trainerTenantId = await seedTenant();
      await seedTrainerBilling(trainerTenantId);
      const trainerId = await seedUser();
      await seedActiveMembership(trainerTenantId, trainerId, "trainer");
      const unassignedClientId = await seedUser();

      app = await buildApp(trainerId, trainerTenantId, "trainer");

      const res = await app.inject({
        method: "POST",
        url: `/clients/${unassignedClientId}/plan-specs`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: specInput,
      });

      expect(res.statusCode).toBe(403);
      const plans = await workoutPlanRepo.findAllByUser(trainerTenantId, unassignedClientId);
      expect(plans).toEqual([]);
    });
  },
);

describe.skipIf(hasDb)(
  "POST /clients/:clientUserId/plan-specs (real Postgres) — skipped",
  () => {
    it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
      expect(hasDb).toBe(false);
    });
  },
);
