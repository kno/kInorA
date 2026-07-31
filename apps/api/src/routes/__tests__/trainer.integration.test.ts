/**
 * Real-Postgres integration coverage for the trainer invite/assignment/
 * list-clients flow (15a-v2-trainer-account-access, Slice 3).
 *
 * Exercises the ACTUAL `trainerRoutes` plugin wired to real
 * `TrainerAssignmentRepository` + `MembershipRepository` + `UserRepository`
 * instances against Postgres — proving the one-trainer-per-client partial
 * unique index (schema, Slice 1) surfaces as a real 409 through the route
 * layer, not just a mocked repo throw.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * the other integration suites) — skipped when no real Postgres is wired so
 * the default `vitest run` stays hermetic.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createDbClient } from "../../db/client.js";
import { tenants, users, memberships } from "../../db/schema.js";
import { authPlugin } from "../../auth/plugin.js";
import { trainerRoutes } from "../trainer.js";
import { TrainerAssignmentRepository } from "../../db/repositories/trainer-assignment.js";
import { MembershipRepository, UserRepository } from "../../db/repositories/auth-context.js";
import { BillingStateReaderRepository } from "../../db/repositories/billing-quota.js";
import { createCyclingAuthMockDb, buildSessionRow, buildActiveMembershipRow, VALID_TOKEN } from "../../test-support/auth-mocks.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Trainer invite/accept/list routes (real Postgres, 15a-v2 Slice 3)", () => {
  const { db, pool } = createDbClient();
  const assignmentRepo = new TrainerAssignmentRepository(db);
  const membershipRepo = new MembershipRepository(db);
  const userRepo = new UserRepository(db);
  const entitlementReader = new BillingStateReaderRepository(db);

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
      .values({ name: `trainer-route-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedUser(email?: string): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: email ?? `trainer-route-${Date.now()}-${Math.random()}@example.test` })
      .returning({ id: users.id });
    return user!.id;
  }

  // Trainer entitlement is read via `resolveEffectiveTier`, which needs an
  // active `tenant_billing_states` row with `tier: "trainer"`. Reuses the
  // same billing tables every other billing integration suite seeds.
  async function seedTrainerBilling(tenantId: string): Promise<void> {
    const { tenantBillingStates } = await import("../../db/schema.js");
    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "trainer",
      status: "active",
      source: "system",
    });
  }

  // `resolveEffectiveTier` (via `BillingStateReaderRepository.loadContext`)
  // reads the REAL `memberships` row for (tenantId, userId) to resolve
  // `membershipStatus` — the mocked auth DB only satisfies the auth
  // pipeline's session/role check, not the entitlement gate's own read.
  async function seedActiveTrainerMembership(tenantId: string, userId: string): Promise<void> {
    await db.insert(memberships).values({ tenantId, userId, role: "trainer", status: "active" });
  }

  async function buildApp(
    sessionUserId: string,
    sessionTenantId: string,
    role: "member" | "trainer",
  ): Promise<FastifyInstance> {
    const built = Fastify();
    // `app` in this suite issues MULTIPLE requests (invite, then list) — use
    // the cycling mock (repeats the session/membership pair per request)
    // rather than the one-shot `createAuthMockDb`, which only models a
    // single authenticated request.
    const authDb = createCyclingAuthMockDb({
      sessionRows: [buildSessionRow({ tenantId: sessionTenantId, userId: sessionUserId })],
      membershipRows: [buildActiveMembershipRow({ tenantId: sessionTenantId, userId: sessionUserId, role })],
    });
    await built.register(authPlugin, { db: authDb });
    await built.register(trainerRoutes, { assignmentRepo, membershipRepo, userRepo, entitlementReader });
    return built;
  }

  it("invite -> 409 for a second trainer -> accept -> list reflects the active client", async () => {
    const trainerTenantId = await seedTenant();
    await seedTrainerBilling(trainerTenantId);
    const trainerId = await seedUser();
    await seedActiveTrainerMembership(trainerTenantId, trainerId);
    const clientEmail = `client-${Date.now()}@example.test`;
    const clientId = await seedUser(clientEmail);

    app = await buildApp(trainerId, trainerTenantId, "trainer");

    const inviteRes = await app.inject({
      method: "POST",
      url: "/trainer/clients/invite",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { email: clientEmail },
    });
    expect(inviteRes.statusCode).toBe(201);

    // A second trainer inviting the SAME client (still non-revoked, only
    // "invited" so far) must be rejected by the partial unique index.
    const otherTrainerTenantId = await seedTenant();
    await seedTrainerBilling(otherTrainerTenantId);
    const otherTrainerId = await seedUser();
    await seedActiveTrainerMembership(otherTrainerTenantId, otherTrainerId);
    const otherApp = await buildApp(otherTrainerId, otherTrainerTenantId, "trainer");
    const conflictRes = await otherApp.inject({
      method: "POST",
      url: "/trainer/clients/invite",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { email: clientEmail },
    });
    expect(conflictRes.statusCode).toBe(409);
    await otherApp.close();

    // Client accepts — their own session can stay in ANY tenant context
    // (accept is looked up by client user id, not tenant); a bare member
    // session in the trainer's tenant is sufficient here to exercise
    // requireAuth() only.
    const clientApp = await buildApp(clientId, trainerTenantId, "member");
    const acceptRes = await clientApp.inject({
      method: "POST",
      url: "/trainer/clients/accept",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.json().status).toBe("active");
    await clientApp.close();

    // The client's membership row in the trainer's tenant is now active too.
    const membershipRow = await membershipRepo.findByTenantAndUser(trainerTenantId, clientId);
    expect(membershipRow?.status).toBe("active");

    const listRes = await app.inject({
      method: "GET",
      url: "/trainer/clients",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual([{ clientUserId: clientId, email: clientEmail, status: "active" }]);
  });
});

describe.skipIf(hasDb)("Trainer invite/accept/list routes (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
