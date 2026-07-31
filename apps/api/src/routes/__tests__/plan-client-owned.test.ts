/**
 * Unit coverage for `POST /clients/:clientUserId/plan-specs`
 * (15a-v2-trainer-account-access, Slice 4 — client-owned plan creation).
 *
 * Mirrors the mocked-repo style of `plan.test.ts` and `trainer.test.ts`: a
 * REAL `planRoutes` plugin registered with mocked `repo`/`generationService`/
 * `billing`/`trainerAccess` deps, asserting the route threads a resolved
 * `ownerUserId` through the EXISTING `promoteDraftToSpec` + `startGeneration`
 * signatures without ever reimplementing `resolveAuthorizedOwner`'s
 * authorization logic (that truth table is already fully covered by
 * `trainer/__tests__/route-authz-guard.test.ts` and `owner-access.ts` itself
 * — these tests only prove the ROUTE wires the resolver correctly and never
 * widens/writes on a denial).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes, type PlanRouteRepo } from "../plan.js";
import type { Database } from "../../db/client.js";
import type { PlanSpec } from "@kinora/contracts";
import {
  createAuthMockDb,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const TRAINER_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const MEMBER_ID = "aaaaaaaa-0000-0000-0000-000000000003";
const CLIENT_ID = "aaaaaaaa-0000-0000-0000-000000000004";
const OTHER_CLIENT_ID = "aaaaaaaa-0000-0000-0000-000000000005";

const VALID_TOKEN = "a".repeat(64);
const SESSION_HASH = "b".repeat(64);

const validSpecInput = {
  goal: "strength",
  location: "gym",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  equipment: ["barbell"],
  limitations: [],
};

const persistedSpecRow = {
  id: "spec-uuid-1",
  spec: { ...validSpecInput, confirmed: true, preferenceScores: {
    strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3,
  } } as unknown as PlanSpec,
};

function buildSessionDb(tenantId: string, userId: string, role: "member" | "trainer") {
  const auth = createAuthMockDb({
    sessionRows: [
      {
        tokenHash: SESSION_HASH,
        userId,
        tenantId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    ],
    membershipRows: [buildActiveMembershipRow({ tenantId, userId, role })],
  });
  return auth.db;
}

type PlanRepoMock = { [K in keyof PlanRouteRepo]: ReturnType<typeof vi.fn> };

function buildPlanRepo(overrides: Partial<PlanRepoMock> = {}): PlanRepoMock {
  return {
    upsertDraft: vi.fn(),
    commitDraft: vi.fn(),
    findCurrentDraft: vi.fn().mockResolvedValue(null),
    promoteDraftToSpec: vi.fn().mockResolvedValue(persistedSpecRow),
    findPlanById: vi.fn().mockResolvedValue(undefined),
    findLatestPlanBySpec: vi.fn().mockResolvedValue(undefined),
    findAllPlansByUser: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function buildGenerationService(
  overrides: { startGeneration?: ReturnType<typeof vi.fn>; assertGeneratable?: ReturnType<typeof vi.fn> } = {},
) {
  return {
    startGeneration: overrides.startGeneration ?? vi.fn().mockResolvedValue({ planId: "plan-uuid-1", status: "generating" }),
    assertGeneratable: overrides.assertGeneratable ?? vi.fn(),
  };
}

function buildAssignmentRepo(active: boolean) {
  return {
    findActiveAssignment: vi.fn().mockResolvedValue(
      active
        ? {
            id: "assignment-1",
            tenantId: TENANT_ID,
            trainerUserId: TRAINER_ID,
            clientUserId: CLIENT_ID,
            status: "active",
          }
        : undefined,
    ),
  };
}

function buildEntitlementReader(tier: "free" | "pro" | "trainer") {
  return {
    loadContext: vi.fn().mockResolvedValue({
      membershipStatus: "active",
      billing: { tier, status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      activeOverrideTier: null,
    }),
  };
}

function buildBilling(allowed = true) {
  return {
    checkAndConsume: vi.fn().mockResolvedValue(
      allowed
        ? { allowed: true, tier: "trainer", source: "system", period: "2026-07", replayed: false }
        : { allowed: false, reason: "tenant_quota_exhausted" },
    ),
  };
}

async function buildTestApp(opts: {
  db: Database;
  repo?: PlanRepoMock;
  generationService?: ReturnType<typeof buildGenerationService>;
  billing?: ReturnType<typeof buildBilling>;
  trainerAccess?: { assignmentRepo: ReturnType<typeof buildAssignmentRepo>; entitlementReader: ReturnType<typeof buildEntitlementReader> };
}): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error.name === "AuthError") return reply.code(401).send({ error: error.message });
    return reply.code(500).send({ error: "Internal Server Error", message: error.message });
  });
  await app.register(authPlugin, { db: opts.db });
  await app.register(planRoutes, {
    repo: opts.repo ?? buildPlanRepo(),
    generationService: opts.generationService ?? buildGenerationService(),
    billing: opts.billing,
    trainerAccess: opts.trainerAccess,
  });
  return app;
}

describe("POST /clients/:clientUserId/plan-specs (15a-v2-trainer-account-access, Slice 4)", () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  // --- 4.1: trainer entitled + active assignment → spec created owned by the client ---
  it("creates a plan owned by the client when the trainer is entitled and actively assigned", async () => {
    const repo = buildPlanRepo();
    const generationService = buildGenerationService();
    const entitlementReader = buildEntitlementReader("trainer");
    const assignmentRepo = buildAssignmentRepo(true);

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      generationService,
      billing: buildBilling(true),
      trainerAccess: { assignmentRepo, entitlementReader },
    });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${CLIENT_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validSpecInput,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: persistedSpecRow.id,
      planId: "plan-uuid-1",
      status: "generating",
    });

    // ownerUserId threaded = the CLIENT, not the trainer, into both calls.
    expect(repo.promoteDraftToSpec).toHaveBeenCalledWith(TENANT_ID, CLIENT_ID, expect.any(Object));
    expect(generationService.startGeneration).toHaveBeenCalledWith(
      TENANT_ID,
      CLIENT_ID,
      persistedSpecRow.id,
      expect.any(String),
    );
  });

  // --- 4.2: trainer with no/revoked assignment for :clientUserId → 403, no writes ---
  it("denies (403) a trainer with no active assignment to the requested client — no repo/generation calls", async () => {
    const repo = buildPlanRepo();
    const generationService = buildGenerationService();
    const entitlementReader = buildEntitlementReader("trainer");
    const assignmentRepo = buildAssignmentRepo(false); // no active assignment
    const billing = buildBilling(true);

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      generationService,
      billing,
      trainerAccess: { assignmentRepo, entitlementReader },
    });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${OTHER_CLIENT_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validSpecInput,
    });

    expect(res.statusCode).toBe(403);
    expect(repo.promoteDraftToSpec).not.toHaveBeenCalled();
    expect(generationService.startGeneration).not.toHaveBeenCalled();
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
  });

  it("denies (403) a trainer role without the trainer entitlement, before any repo/generation/quota call", async () => {
    const repo = buildPlanRepo();
    const generationService = buildGenerationService();
    const entitlementReader = buildEntitlementReader("pro"); // entitled tier missing
    const assignmentRepo = buildAssignmentRepo(true);
    const billing = buildBilling(true);

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      generationService,
      billing,
      trainerAccess: { assignmentRepo, entitlementReader },
    });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${CLIENT_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validSpecInput,
    });

    expect(res.statusCode).toBe(403);
    expect(assignmentRepo.findActiveAssignment).not.toHaveBeenCalled();
    expect(repo.promoteDraftToSpec).not.toHaveBeenCalled();
    expect(generationService.startGeneration).not.toHaveBeenCalled();
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
  });

  it("denies (403) a non-trainer role widening to a different owner, before any entitlement/assignment/repo call", async () => {
    const repo = buildPlanRepo();
    const generationService = buildGenerationService();
    const entitlementReader = buildEntitlementReader("trainer");
    const assignmentRepo = buildAssignmentRepo(true);

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, MEMBER_ID, "member"),
      repo,
      generationService,
      trainerAccess: { assignmentRepo, entitlementReader },
    });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${CLIENT_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validSpecInput,
    });

    expect(res.statusCode).toBe(403);
    expect(entitlementReader.loadContext).not.toHaveBeenCalled();
    expect(repo.promoteDraftToSpec).not.toHaveBeenCalled();
  });

  // Self-path preserved: a non-trainer calling their OWN id still works exactly
  // like `POST /plan-specs` — resolveAuthorizedOwner's self path, unchanged.
  it("preserves the self path: a non-trainer member creating a plan for THEIR OWN id succeeds", async () => {
    const repo = buildPlanRepo();
    const generationService = buildGenerationService();

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, MEMBER_ID, "member"),
      repo,
      generationService,
      trainerAccess: {
        assignmentRepo: buildAssignmentRepo(false),
        entitlementReader: buildEntitlementReader("free"),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${MEMBER_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validSpecInput,
    });

    expect(res.statusCode).toBe(201);
    expect(repo.promoteDraftToSpec).toHaveBeenCalledWith(TENANT_ID, MEMBER_ID, expect.any(Object));
  });

  // --- 4.3: quota metered against the TRAINER's own tenant, not the client's ---
  it("meters plan_generation quota against the trainer's OWN tenant + userId, not the client's", async () => {
    const repo = buildPlanRepo();
    const generationService = buildGenerationService();
    const entitlementReader = buildEntitlementReader("trainer");
    const assignmentRepo = buildAssignmentRepo(true);
    const billing = buildBilling(true);

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      generationService,
      billing,
      trainerAccess: { assignmentRepo, entitlementReader },
    });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${CLIENT_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validSpecInput,
    });

    expect(res.statusCode).toBe(201);
    expect(billing.checkAndConsume).toHaveBeenCalledTimes(1);
    const [scope, feature] = billing.checkAndConsume.mock.calls[0]!;
    expect(scope).toEqual({ tenantId: TENANT_ID, userId: TRAINER_ID });
    expect(feature).toBe("plan_generation");
  });

  it("denies (403) with NO spec created when the trainer's tenant quota is exhausted", async () => {
    const repo = buildPlanRepo();
    const generationService = buildGenerationService();
    const entitlementReader = buildEntitlementReader("trainer");
    const assignmentRepo = buildAssignmentRepo(true);
    const billing = buildBilling(false); // denied

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      generationService,
      billing,
      trainerAccess: { assignmentRepo, entitlementReader },
    });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${CLIENT_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validSpecInput,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "tenant_quota_exhausted" });
    expect(repo.promoteDraftToSpec).not.toHaveBeenCalled();
    expect(generationService.startGeneration).not.toHaveBeenCalled();
  });

  // --- Route not registered when trainerAccess is absent ---
  it("does not register the route at all when trainerAccess is not wired", async () => {
    app = await buildTestApp({ db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer") });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${CLIENT_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validSpecInput,
    });

    expect(res.statusCode).toBe(404);
  });

  // --- Bad input still rejected BEFORE quota consumption / write, mirroring /plan-specs ---
  it("returns 409 incomplete_spec for a malformed body, before any quota consumption or write", async () => {
    const repo = buildPlanRepo();
    const billing = buildBilling(true);

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      billing,
      trainerAccess: {
        assignmentRepo: buildAssignmentRepo(true),
        entitlementReader: buildEntitlementReader("trainer"),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${CLIENT_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { goal: "strength" }, // missing required fields
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "incomplete_spec" });
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
    expect(repo.promoteDraftToSpec).not.toHaveBeenCalled();
  });
});
