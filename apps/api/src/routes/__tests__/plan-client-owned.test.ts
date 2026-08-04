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

  // --- Branding authoring (15b-v2 S3) — trainer sets branding at plan-creation ---

  it("persists trainer-authored branding on the confirmed spec", async () => {
    const branding = { trainerName: "Coach Ana", title: "Summer Cut", accentColor: "#1E90FF" };
    const repo = buildPlanRepo();
    const generationService = buildGenerationService();
    const billing = buildBilling(true);

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      generationService,
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
      payload: { ...validSpecInput, branding },
    });

    expect(res.statusCode).toBe(201);
    expect(repo.promoteDraftToSpec).toHaveBeenCalledWith(
      TENANT_ID,
      CLIENT_ID,
      expect.objectContaining({ branding }),
    );
  });

  it("returns 400 invalid_branding for an invalid accentColor, before any quota consumption or write", async () => {
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
      payload: { ...validSpecInput, branding: { accentColor: "blue" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_branding" });
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
    expect(repo.promoteDraftToSpec).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_branding for a trainerName/title over 60 chars", async () => {
    const repo = buildPlanRepo();

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      billing: buildBilling(true),
      trainerAccess: {
        assignmentRepo: buildAssignmentRepo(true),
        entitlementReader: buildEntitlementReader("trainer"),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${CLIENT_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { ...validSpecInput, branding: { trainerName: "a".repeat(61) } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_branding" });
    expect(repo.promoteDraftToSpec).not.toHaveBeenCalled();
  });

  it("creates a plan with no branding field when absent — base (unbranded) plan unaffected", async () => {
    const repo = buildPlanRepo();
    const generationService = buildGenerationService();

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      generationService,
      billing: buildBilling(true),
      trainerAccess: {
        assignmentRepo: buildAssignmentRepo(true),
        entitlementReader: buildEntitlementReader("trainer"),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/clients/${CLIENT_ID}/plan-specs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validSpecInput,
    });

    expect(res.statusCode).toBe(201);
    const [, , persistedSpec] = repo.promoteDraftToSpec.mock.calls[0]!;
    expect(persistedSpec).not.toHaveProperty("branding");
  });
});

/**
 * `GET /clients/:clientUserId/workout-plans/:id` (#341 — trainer-scoped plan
 * detail READ).
 *
 * These tests exercise the AUTHORIZATION MATRIX explicitly: this route is the
 * only widened plan read, so every row of the matrix (assigned trainer,
 * unassigned trainer, non-trainer, cross-tenant, self) is asserted here rather
 * than inferred from `resolveAuthorizedOwner`'s own unit tests. The assignment
 * repo used below is STRICT — it matches on `(tenantId, trainerUserId,
 * clientUserId)` — so a denial cannot pass just because a permissive mock
 * returned a row for any argument.
 */

const PLAN_ID = "plan-uuid-1";

const clientPlanRow = {
  id: PLAN_ID,
  status: "ready",
  programJson: { weeklySessions: [] },
  planSpecId: "spec-uuid-1",
  name: "Client plan",
  // Internal columns that must NEVER reach the client DTO.
  tenantId: TENANT_ID,
  userId: CLIENT_ID,
  errorMessage: null,
};

/**
 * Assignment repo that resolves ONLY for the exact
 * `(TENANT_ID, TRAINER_ID, assignedClientId)` triple — every other combination
 * (other tenant, other trainer, other client) resolves to `undefined`, i.e. a
 * denial.
 */
function buildStrictAssignmentRepo(assignedClientId: string) {
  return {
    findActiveAssignment: vi.fn(
      async (tenantId: string, trainerUserId: string, clientUserId: string) =>
        tenantId === TENANT_ID &&
        trainerUserId === TRAINER_ID &&
        clientUserId === assignedClientId
          ? {
              id: "assignment-1",
              tenantId: TENANT_ID,
              trainerUserId: TRAINER_ID,
              clientUserId: assignedClientId,
              status: "active",
            }
          : undefined,
    ),
  };
}

/**
 * Plan repo whose `findPlanById` honors the SAME `(tenantId, userId, id)`
 * filter the real repository applies — so a widened-to-the-wrong-owner or
 * cross-tenant read resolves to `undefined` here exactly as it would in the DB.
 */
function buildOwnerScopedPlanRepo(owner: { tenantId: string; userId: string }) {
  return buildPlanRepo({
    findPlanById: vi.fn(async (tenantId: string, userId: string, id: string) =>
      tenantId === owner.tenantId && userId === owner.userId && id === PLAN_ID
        ? clientPlanRow
        : undefined,
    ),
  });
}

describe("GET /clients/:clientUserId/workout-plans/:id (#341)", () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns 200 with the client's plan for an entitled, actively assigned trainer", async () => {
    const repo = buildOwnerScopedPlanRepo({ tenantId: TENANT_ID, userId: CLIENT_ID });

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      trainerAccess: {
        assignmentRepo: buildStrictAssignmentRepo(CLIENT_ID),
        entitlementReader: buildEntitlementReader("trainer"),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/clients/${CLIENT_ID}/workout-plans/${PLAN_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: PLAN_ID,
      status: "ready",
      program: { weeklySessions: [] },
      specId: "spec-uuid-1",
      name: "Client plan",
    });
    // The resolved owner is the CLIENT; the tenant is the session's, never
    // caller-supplied. Internal columns are not echoed back.
    expect(repo.findPlanById).toHaveBeenCalledWith(TENANT_ID, CLIENT_ID, PLAN_ID);
    expect(res.json()).not.toHaveProperty("userId");
    expect(res.json()).not.toHaveProperty("tenantId");
  });

  it("denies (403) an entitled trainer with no active assignment to the requested client — no plan read at all", async () => {
    const repo = buildOwnerScopedPlanRepo({ tenantId: TENANT_ID, userId: OTHER_CLIENT_ID });

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      trainerAccess: {
        assignmentRepo: buildStrictAssignmentRepo(CLIENT_ID), // assigned to a DIFFERENT client
        entitlementReader: buildEntitlementReader("trainer"),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/clients/${OTHER_CLIENT_ID}/workout-plans/${PLAN_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repo.findPlanById).not.toHaveBeenCalled();
  });

  it("denies (403) a trainer role without the trainer entitlement, before any assignment or plan read", async () => {
    const repo = buildOwnerScopedPlanRepo({ tenantId: TENANT_ID, userId: CLIENT_ID });
    const assignmentRepo = buildStrictAssignmentRepo(CLIENT_ID);

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      trainerAccess: { assignmentRepo, entitlementReader: buildEntitlementReader("pro") },
    });

    const res = await app.inject({
      method: "GET",
      url: `/clients/${CLIENT_ID}/workout-plans/${PLAN_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(assignmentRepo.findActiveAssignment).not.toHaveBeenCalled();
    expect(repo.findPlanById).not.toHaveBeenCalled();
  });

  it("denies (403) a plain member reading another same-tenant user's plan, before any entitlement/assignment/plan read", async () => {
    const repo = buildOwnerScopedPlanRepo({ tenantId: TENANT_ID, userId: CLIENT_ID });
    const entitlementReader = buildEntitlementReader("trainer");
    const assignmentRepo = buildStrictAssignmentRepo(CLIENT_ID);

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, MEMBER_ID, "member"),
      repo,
      trainerAccess: { assignmentRepo, entitlementReader },
    });

    const res = await app.inject({
      method: "GET",
      url: `/clients/${CLIENT_ID}/workout-plans/${PLAN_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(entitlementReader.loadContext).not.toHaveBeenCalled();
    expect(assignmentRepo.findActiveAssignment).not.toHaveBeenCalled();
    expect(repo.findPlanById).not.toHaveBeenCalled();
  });

  it("denies (403) a trainer whose session is scoped to a different tenant than the assignment", async () => {
    const otherTenantId = "aaaaaaaa-0000-0000-0000-0000000000ff";
    const repo = buildOwnerScopedPlanRepo({ tenantId: TENANT_ID, userId: CLIENT_ID });

    app = await buildTestApp({
      db: buildSessionDb(otherTenantId, TRAINER_ID, "trainer"),
      repo,
      trainerAccess: {
        assignmentRepo: buildStrictAssignmentRepo(CLIENT_ID), // active only in TENANT_ID
        entitlementReader: buildEntitlementReader("trainer"),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/clients/${CLIENT_ID}/workout-plans/${PLAN_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repo.findPlanById).not.toHaveBeenCalled();
  });

  it("returns 404 when the plan id belongs to a different owner than :clientUserId — the two must agree", async () => {
    // The trainer is legitimately assigned to CLIENT_ID, but PLAN_ID is owned
    // by OTHER_CLIENT_ID: the (tenantId, ownerUserId) filter does not match, so
    // the read yields nothing instead of leaking another owner's plan.
    const repo = buildOwnerScopedPlanRepo({ tenantId: TENANT_ID, userId: OTHER_CLIENT_ID });

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      trainerAccess: {
        assignmentRepo: buildStrictAssignmentRepo(CLIENT_ID),
        entitlementReader: buildEntitlementReader("trainer"),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/clients/${CLIENT_ID}/workout-plans/${PLAN_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
    expect(repo.findPlanById).toHaveBeenCalledWith(TENANT_ID, CLIENT_ID, PLAN_ID);
  });

  it("returns 404 for an unknown plan id an assigned trainer requests", async () => {
    const repo = buildOwnerScopedPlanRepo({ tenantId: TENANT_ID, userId: CLIENT_ID });

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      trainerAccess: {
        assignmentRepo: buildStrictAssignmentRepo(CLIENT_ID),
        entitlementReader: buildEntitlementReader("trainer"),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/clients/${CLIENT_ID}/workout-plans/unknown-plan-id`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("preserves the self path: a non-trainer member reading THEIR OWN plan through this route succeeds", async () => {
    const repo = buildOwnerScopedPlanRepo({ tenantId: TENANT_ID, userId: MEMBER_ID });
    const entitlementReader = buildEntitlementReader("free");
    const assignmentRepo = buildStrictAssignmentRepo(CLIENT_ID);

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, MEMBER_ID, "member"),
      repo,
      trainerAccess: { assignmentRepo, entitlementReader },
    });

    const res = await app.inject({
      method: "GET",
      url: `/clients/${MEMBER_ID}/workout-plans/${PLAN_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.findPlanById).toHaveBeenCalledWith(TENANT_ID, MEMBER_ID, PLAN_ID);
    // The self path never touches the widening checks.
    expect(entitlementReader.loadContext).not.toHaveBeenCalled();
    expect(assignmentRepo.findActiveAssignment).not.toHaveBeenCalled();
  });

  it("leaves the unwidened GET /workout-plans/:id isolation intact — a trainer still 404s on the client's plan there", async () => {
    const repo = buildOwnerScopedPlanRepo({ tenantId: TENANT_ID, userId: CLIENT_ID });

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      trainerAccess: {
        assignmentRepo: buildStrictAssignmentRepo(CLIENT_ID),
        entitlementReader: buildEntitlementReader("trainer"),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workout-plans/${PLAN_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(404);
    // Scoped to the CALLER, never widened.
    expect(repo.findPlanById).toHaveBeenCalledWith(TENANT_ID, TRAINER_ID, PLAN_ID);
  });

  it("returns 401 without a session, before any authorization work", async () => {
    const repo = buildOwnerScopedPlanRepo({ tenantId: TENANT_ID, userId: CLIENT_ID });

    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer"),
      repo,
      trainerAccess: {
        assignmentRepo: buildStrictAssignmentRepo(CLIENT_ID),
        entitlementReader: buildEntitlementReader("trainer"),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/clients/${CLIENT_ID}/workout-plans/${PLAN_ID}`,
    });

    expect(res.statusCode).toBe(401);
    expect(repo.findPlanById).not.toHaveBeenCalled();
  });

  it("does not register the read route at all when trainerAccess is not wired", async () => {
    app = await buildTestApp({ db: buildSessionDb(TENANT_ID, TRAINER_ID, "trainer") });

    const res = await app.inject({
      method: "GET",
      url: `/clients/${CLIENT_ID}/workout-plans/${PLAN_ID}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
