/**
 * Tests for generation-related plan routes:
 *   POST /plan-specs/:id/confirm      — 6.2.x
 *   POST /plan-specs/:id/regenerate   — 6.3.x
 *   GET  /workout-plans/:id           — 6.4.x
 *   GET  /plan-specs/:id/workout-plan — 6.4.x
 *
 * Strategy: mock PlanGenerationService and WorkoutPlanRepository at the service
 * level (not the DB level) to keep tests focused on route logic: auth, tenant
 * scoping, response shape, and status codes. Avoids re-wiring complex DB mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes, type PlanRouteRepo } from "../plan.js";
import type { Database } from "../../db/client.js";
import type { WorkoutPlanRecord } from "../../db/repositories/workout-plan.js";
import type { WorkoutProgram } from "@kinora/contracts";
import {
  VALID_TOKEN,
  createCyclingAuthMockDb,
  buildSessionRow as buildSharedSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

// --- Shared fixtures ---

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";
const SPEC_ID = "spec-uuid-1";
const PLAN_ID = "plan-uuid-1";

const mockProgram: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Upper Body",
      exercises: [{ name: "Squat", sets: 4, reps: "8-12", restSeconds: 90 }],
    },
  ],
  limitationWarnings: [],
};

const mockPlanRecord: WorkoutPlanRecord = {
  id: PLAN_ID,
  tenantId: TENANT_A,
  userId: USER_A,
  planSpecId: SPEC_ID,
  status: "ready",
  programJson: mockProgram,
  errorMessage: null,
  createdAt: new Date("2026-06-29T12:00:00Z"),
  updatedAt: new Date("2026-06-29T12:01:00Z"),
};

// --- Mock builder helpers ---

// This suite uses tenant/user IDs distinct from the shared defaults.
function buildSessionRow(tenantId = TENANT_A, userId = USER_A) {
  return buildSharedSessionRow({ tenantId, userId });
}

/**
 * Build a minimal mock DB that handles the two ordered auth selects (session
 * lookup then tenant-scoped membership re-check) via the shared cycling mock.
 * Route-level DB calls (repos) are injected via service mocks, not DB mocks, so
 * each authenticated request issues exactly these two selects; the membership
 * row is returned EXPLICITLY, never blended into the session row.
 */
function buildSessionOnlyDb(
  sessionRow?: unknown,
  membershipRow: unknown = buildActiveMembershipRow({
    tenantId: TENANT_A,
    userId: USER_A,
  })
): Database {
  return createCyclingAuthMockDb({
    sessionRows: sessionRow ? [sessionRow] : [],
    membershipRows: sessionRow && membershipRow ? [membershipRow] : [],
  });
}

// --- Mock service/repo factories ---

/**
 * Error class for 404 (spec not found / cross-tenant).
 * Mirrors what the production service throws.
 */
class NotFoundError extends Error {
  statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Error class for 422 (invalid spec shape).
 * Mirrors what the production service throws.
 */
class UnprocessableError extends Error {
  statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = "UnprocessableError";
  }
}

function buildMockGenerationService(
  result: { planId: string; status: "generating" } | Error,
  /** Reject to model assertGeneratable finding an invalid/nonexistent spec. */
  validationError?: Error,
) {
  return {
    assertGeneratable: vi.fn().mockImplementation(() => {
      if (validationError) return Promise.reject(validationError);
      return Promise.resolve(undefined);
    }),
    startGeneration: vi.fn().mockImplementation(() => {
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    }),
  };
}

function buildMockPlanRepo(opts: {
  findById?: WorkoutPlanRecord | undefined;
  findLatestByPlanSpec?: WorkoutPlanRecord | undefined;
} = {}) {
  return {
    findById: vi.fn().mockResolvedValue(opts.findById),
    findLatestByPlanSpec: vi.fn().mockResolvedValue(opts.findLatestByPlanSpec),
    findAllByUser: vi.fn().mockResolvedValue([]),
    createGenerating: vi.fn(),
    markReady: vi.fn(),
    markFailed: vi.fn(),
  };
}

// --- App builder ---

function buildAllowBilling() {
  return {
    checkAndConsume: vi.fn().mockResolvedValue({
      allowed: true,
      tier: "free",
      source: "backfill",
      period: "2026-07",
    }),
  };
}

function buildDenyBilling(reason: string) {
  return {
    checkAndConsume: vi.fn().mockResolvedValue({ allowed: false, reason }),
  };
}

async function buildTestApp(opts: {
  db: Database;
  generationService?: ReturnType<typeof buildMockGenerationService>;
  planRepo?: ReturnType<typeof buildMockPlanRepo>;
  billing?: { checkAndConsume: ReturnType<typeof vi.fn> };
}): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      return reply.code(422).send({ error: "Validation Error" });
    }
    if (error.name === "AuthError") {
      return reply.code(401).send({ error: error.message });
    }
    // Re-surface application errors with their status code
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(statusCode).send({ error: error.message ?? "Internal Server Error" });
  });

  await app.register(authPlugin, { db: opts.db });

  // Fix 2: generationService is required — pass a no-op if caller omits it
  // (only happens for tests that only test non-generation routes).
  const svc = opts.generationService ?? {
    assertGeneratable: vi.fn().mockResolvedValue(undefined),
    startGeneration: vi.fn().mockRejectedValue(new Error("unexpected call")),
  };

  // Build the PlanRouteRepo port from the mock repos. The port's findPlanById /
  // findLatestPlanBySpec / findAllPlansByUser REUSE the same vi.fn() spies from
  // planRepo so existing `expect(planRepo.findById).toHaveBeenCalledWith(...)`
  // assertions still hold.
  //
  // The generation routes exercised here (confirm/regenerate + the plan GETs)
  // NEVER touch the wizard draft port (upsertDraft/findCurrentDraft/
  // promoteDraftToSpec). Those methods are therefore FAIL-FAST stubs: if a route
  // change accidentally introduces a dependency on the draft flow, the test
  // surfaces it loudly instead of silently returning a canned value.
  const planRepoMock = opts.planRepo ?? buildMockPlanRepo();
  const repo: PlanRouteRepo = {
    upsertDraft: vi.fn(() => {
      throw new Error("unexpected call: upsertDraft");
    }),
    findCurrentDraft: vi.fn(() => {
      throw new Error("unexpected call: findCurrentDraft");
    }),
    promoteDraftToSpec: vi.fn(() => {
      throw new Error("unexpected call: promoteDraftToSpec");
    }),
    findPlanById: planRepoMock.findById,
    findLatestPlanBySpec: planRepoMock.findLatestByPlanSpec,
    findAllPlansByUser: planRepoMock.findAllByUser,
  };

  await app.register(planRoutes, {
    repo,
    generationService: svc as never,
    billing: opts.billing as never,
  });

  return app;
}

// --- Tests ---

describe("Plan generation routes", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ─── POST /plan-specs/:id/confirm (6.2.x) ─────────────────────────────────

  describe("POST /plan-specs/:id/confirm", () => {
    it("returns 200 with { planId, status: 'generating' } on happy path", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const generationService = buildMockGenerationService({ planId: PLAN_ID, status: "generating" });
      app = await buildTestApp({ db, generationService });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.planId).toBe(PLAN_ID);
      expect(body.status).toBe("generating");
    });

    it("returns 401 when not authenticated", async () => {
      const db = buildSessionOnlyDb(); // no session rows
      app = await buildTestApp({ db });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 422 when spec fails shape validation (service throws UnprocessableError)", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      // Fix 7: service throws a proper 422-class error for invalid spec shape
      const err = new UnprocessableError("PlanSpec.preferenceScores must be an object");
      const generationService = buildMockGenerationService(err);
      app = await buildTestApp({ db, generationService });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(422);
    });

    it("returns 404 when spec not found or cross-tenant (service throws NotFoundError)", async () => {
      // Fix 7: service throws a proper 404-class error when findConfirmedById returns undefined
      const db = buildSessionOnlyDb(buildSessionRow(TENANT_B, USER_A));
      const err = new NotFoundError("PlanSpec not found or unconfirmed");
      const generationService = buildMockGenerationService(err);
      app = await buildTestApp({ db, generationService });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it("calls startGeneration with tenantId and userId from authContext", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const generationService = buildMockGenerationService({ planId: PLAN_ID, status: "generating" });
      app = await buildTestApp({ db, generationService });

      await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(generationService.startGeneration).toHaveBeenCalledWith(
        TENANT_A,
        USER_A,
        SPEC_ID
      );
    });
  });

  // ─── POST /plan-specs/:id/regenerate (6.3.x) ──────────────────────────────

  describe("POST /plan-specs/:id/regenerate", () => {
    it("returns 202 with { planId, status: 'generating' } on happy path", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const generationService = buildMockGenerationService({ planId: PLAN_ID, status: "generating" });
      app = await buildTestApp({ db, generationService });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/regenerate`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.planId).toBe(PLAN_ID);
      expect(body.status).toBe("generating");
    });

    it("returns 401 when not authenticated", async () => {
      const db = buildSessionOnlyDb();
      app = await buildTestApp({ db });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/regenerate`,
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 422 when spec fails shape validation (service throws UnprocessableError)", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const err = new UnprocessableError("PlanSpec.preferenceScores must be an object");
      const generationService = buildMockGenerationService(err);
      app = await buildTestApp({ db, generationService });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/regenerate`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(422);
    });

    it("returns 404 when spec not found or cross-tenant (service throws NotFoundError)", async () => {
      const db = buildSessionOnlyDb(buildSessionRow(TENANT_B, USER_A));
      const err = new NotFoundError("PlanSpec not found or unconfirmed");
      const generationService = buildMockGenerationService(err);
      app = await buildTestApp({ db, generationService });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/regenerate`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it("reuses startGeneration (same service method as confirm)", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const generationService = buildMockGenerationService({ planId: PLAN_ID, status: "generating" });
      app = await buildTestApp({ db, generationService });

      await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/regenerate`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(generationService.startGeneration).toHaveBeenCalledWith(
        TENANT_A,
        USER_A,
        SPEC_ID
      );
    });
  });

  // ─── GET /workout-plans/:id (6.4.x) ────────────────────────────────────────

  describe("GET /workout-plans/:id", () => {
    it("returns 200 with plan record when found", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const planRepo = buildMockPlanRepo({ findById: mockPlanRecord });
      app = await buildTestApp({ db, planRepo });

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(PLAN_ID);
      expect(body.status).toBe("ready");
      // DTO contract: the client reads `program` + `specId`. The handler MUST map
      // the raw DB row (programJson/planSpecId) to these names, or the web shows
      // a "ready" plan with no content. It must NOT leak internal columns.
      expect(body.program).toEqual(mockProgram);
      expect(body.specId).toBeDefined();
      expect(body.programJson).toBeUndefined();
      expect(body.tenantId).toBeUndefined();
      expect(body.userId).toBeUndefined();
    });

    it("returns 401 when not authenticated", async () => {
      const db = buildSessionOnlyDb();
      app = await buildTestApp({ db });

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 404 when plan not found (plan does not exist)", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const planRepo = buildMockPlanRepo({ findById: undefined });
      app = await buildTestApp({ db, planRepo });

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it("calls findById with tenantId+userId from authContext (tenant + user scoped)", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const planRepo = buildMockPlanRepo({ findById: mockPlanRecord });
      app = await buildTestApp({ db, planRepo });

      await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      // After Fix 1: route passes (tenantId, userId, id) — 3 args required
      expect(planRepo.findById).toHaveBeenCalledWith(TENANT_A, USER_A, PLAN_ID);
    });

    // Cross-tenant isolation: repo is called with TENANT_B context and returns 404
    it("cross-tenant: findById is called with TENANT_B context and returns 404", async () => {
      const db = buildSessionOnlyDb(buildSessionRow(TENANT_B, USER_A));
      const planRepo = buildMockPlanRepo({ findById: undefined });
      app = await buildTestApp({ db, planRepo });

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      // (a) Repo was called with TENANT_B's tenantId + USER_A userId
      expect(planRepo.findById).toHaveBeenCalledWith(TENANT_B, USER_A, PLAN_ID);
      // (b) Response is 404 — cross-tenant rows are invisible
      expect(response.statusCode).toBe(404);
    });

    // Same-tenant cross-user isolation (Fix 1 — CRITICAL security test)
    it("same-tenant cross-user: findById is called with USER_B context and returns 404", async () => {
      // USER_B in TENANT_A tries to access USER_A's plan — must return 404
      const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";
      const db = buildSessionOnlyDb(buildSessionRow(TENANT_A, USER_B));
      const planRepo = buildMockPlanRepo({ findById: undefined });
      app = await buildTestApp({ db, planRepo });

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      // (a) Repo was called with TENANT_A + USER_B — userId isolation enforced at repo level
      expect(planRepo.findById).toHaveBeenCalledWith(TENANT_A, USER_B, PLAN_ID);
      // (b) Response is 404 — same-tenant cross-user plan is not accessible
      expect(response.statusCode).toBe(404);
    });
  });

  // ─── GET /plan-specs/:id/workout-plan (6.4.x) ─────────────────────────────

  describe("GET /plan-specs/:id/workout-plan", () => {
    it("returns 200 with the latest plan for the spec", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const planRepo = buildMockPlanRepo({ findLatestByPlanSpec: mockPlanRecord });
      app = await buildTestApp({ db, planRepo });

      const response = await app.inject({
        method: "GET",
        url: `/plan-specs/${SPEC_ID}/workout-plan`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(PLAN_ID);
      expect(body.status).toBe("ready");
      // Same DTO contract as GET /workout-plans/:id.
      expect(body.program).toEqual(mockProgram);
      expect(body.specId).toBeDefined();
      expect(body.programJson).toBeUndefined();
    });

    it("returns 401 when not authenticated", async () => {
      const db = buildSessionOnlyDb();
      app = await buildTestApp({ db });

      const response = await app.inject({
        method: "GET",
        url: `/plan-specs/${SPEC_ID}/workout-plan`,
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 404 when no plan exists for spec", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const planRepo = buildMockPlanRepo({ findLatestByPlanSpec: undefined });
      app = await buildTestApp({ db, planRepo });

      const response = await app.inject({
        method: "GET",
        url: `/plan-specs/${SPEC_ID}/workout-plan`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it("calls findLatestByPlanSpec with tenantId+userId from authContext (tenant + user scoped)", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const planRepo = buildMockPlanRepo({ findLatestByPlanSpec: mockPlanRecord });
      app = await buildTestApp({ db, planRepo });

      await app.inject({
        method: "GET",
        url: `/plan-specs/${SPEC_ID}/workout-plan`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      // After Fix 2: route passes (tenantId, userId, planSpecId) — 3 args required
      expect(planRepo.findLatestByPlanSpec).toHaveBeenCalledWith(TENANT_A, USER_A, SPEC_ID);
    });

    // Cross-tenant isolation: repo is called with TENANT_B context and returns 404
    it("cross-tenant: findLatestByPlanSpec is called with TENANT_B context and returns 404", async () => {
      const db = buildSessionOnlyDb(buildSessionRow(TENANT_B, USER_A));
      const planRepo = buildMockPlanRepo({ findLatestByPlanSpec: undefined });
      app = await buildTestApp({ db, planRepo });

      const response = await app.inject({
        method: "GET",
        url: `/plan-specs/${SPEC_ID}/workout-plan`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      // (a) Repo called with TENANT_B + USER_A
      expect(planRepo.findLatestByPlanSpec).toHaveBeenCalledWith(TENANT_B, USER_A, SPEC_ID);
      // (b) Response is 404
      expect(response.statusCode).toBe(404);
    });

    // Same-tenant cross-user isolation (Fix 2 — HIGH security test)
    it("same-tenant cross-user: findLatestByPlanSpec is called with USER_B context and returns 404", async () => {
      const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";
      const db = buildSessionOnlyDb(buildSessionRow(TENANT_A, USER_B));
      const planRepo = buildMockPlanRepo({ findLatestByPlanSpec: undefined });
      app = await buildTestApp({ db, planRepo });

      const response = await app.inject({
        method: "GET",
        url: `/plan-specs/${SPEC_ID}/workout-plan`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      // (a) Repo called with TENANT_A + USER_B — userId isolation enforced at repo level
      expect(planRepo.findLatestByPlanSpec).toHaveBeenCalledWith(TENANT_A, USER_B, SPEC_ID);
      // (b) Response is 404 — same-tenant cross-user spec is not accessible
      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Generation metering gate (11a Phase 2) ───────────────────────────────

  describe("Generation metering gate", () => {
    it("consumes the plan_generation feature before generation on confirm and allows it", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const generationService = buildMockGenerationService({ planId: PLAN_ID, status: "generating" });
      const billing = buildAllowBilling();
      app = await buildTestApp({ db, generationService, billing });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      expect(billing.checkAndConsume).toHaveBeenCalledTimes(1);
      const [scope, feature] = billing.checkAndConsume.mock.calls[0];
      expect(scope).toEqual({ tenantId: TENANT_A, userId: USER_A });
      expect(feature).toBe("plan_generation");
      expect(generationService.startGeneration).toHaveBeenCalled();
    });

    it("denies confirm with 403 and reason when the tenant quota is exhausted, without starting generation", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const generationService = buildMockGenerationService({ planId: PLAN_ID, status: "generating" });
      const billing = buildDenyBilling("tenant_quota_exhausted");
      app = await buildTestApp({ db, generationService, billing });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe("tenant_quota_exhausted");
      // Fail-closed: no expensive generation work is started on denial.
      expect(generationService.startGeneration).not.toHaveBeenCalled();
    });

    it("consumes plan_regeneration (not plan_generation) on regenerate", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const generationService = buildMockGenerationService({ planId: PLAN_ID, status: "generating" });
      const billing = buildAllowBilling();
      app = await buildTestApp({ db, generationService, billing });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/regenerate`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(202);
      expect(billing.checkAndConsume.mock.calls[0][1]).toBe("plan_regeneration");
    });

    it("denies regenerate with 403 and does not start generation when denied", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const generationService = buildMockGenerationService({ planId: PLAN_ID, status: "generating" });
      const billing = buildDenyBilling("premium_required");
      app = await buildTestApp({ db, generationService, billing });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/regenerate`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe("premium_required");
      expect(generationService.startGeneration).not.toHaveBeenCalled();
    });

    it("passes a non-empty operation key derived from the spec id to the gate on confirm", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const generationService = buildMockGenerationService({ planId: PLAN_ID, status: "generating" });
      const billing = buildAllowBilling();
      app = await buildTestApp({ db, generationService, billing });

      await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      const operationKey = billing.checkAndConsume.mock.calls[0][2] as string;
      expect(typeof operationKey).toBe("string");
      expect(operationKey.trim()).not.toBe("");
      expect(operationKey).toContain(SPEC_ID);
    });

    // WARNING B (review correction): quota must never be consumed for a
    // spec that fails validation — otherwise a bad :id burns the sole
    // Free-tier monthly unit with no plan ever generated.
    it("confirm: returns 404 for a nonexistent/cross-tenant spec WITHOUT consuming quota", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const notFound = Object.assign(new Error("PlanSpec not found or unconfirmed"), { statusCode: 404 });
      const generationService = buildMockGenerationService(
        { planId: PLAN_ID, status: "generating" },
        notFound,
      );
      const billing = buildAllowBilling();
      app = await buildTestApp({ db, generationService, billing });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(404);
      expect(billing.checkAndConsume).not.toHaveBeenCalled();
      expect(generationService.startGeneration).not.toHaveBeenCalled();
    });

    it("confirm: returns 422 for an invalid spec shape WITHOUT consuming quota", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const invalid = Object.assign(new Error("PlanSpec.preferenceScores must be an object"), {
        statusCode: 422,
      });
      const generationService = buildMockGenerationService(
        { planId: PLAN_ID, status: "generating" },
        invalid,
      );
      const billing = buildAllowBilling();
      app = await buildTestApp({ db, generationService, billing });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(422);
      expect(billing.checkAndConsume).not.toHaveBeenCalled();
      expect(generationService.startGeneration).not.toHaveBeenCalled();
    });

    it("confirm: a subsequent valid confirm still succeeds and consumes exactly once after a prior invalid attempt", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const notFound = Object.assign(new Error("PlanSpec not found"), { statusCode: 404 });
      const invalidAttempt = buildMockGenerationService(
        { planId: PLAN_ID, status: "generating" },
        notFound,
      );
      const billing = buildAllowBilling();
      app = await buildTestApp({ db, generationService: invalidAttempt, billing });

      const badResponse = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(badResponse.statusCode).toBe(404);
      expect(billing.checkAndConsume).not.toHaveBeenCalled();
      await app.close();

      // A fresh valid attempt against the SAME billing gate still succeeds —
      // the failed attempt above did not spend the unit.
      const validAttempt = buildMockGenerationService({ planId: PLAN_ID, status: "generating" });
      app = await buildTestApp({ db, generationService: validAttempt, billing });

      const okResponse = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(okResponse.statusCode).toBe(200);
      expect(billing.checkAndConsume).toHaveBeenCalledTimes(1);
    });

    it("regenerate: returns 422 for an invalid spec WITHOUT consuming quota", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const invalid = Object.assign(new Error("invalid spec"), { statusCode: 422 });
      const generationService = buildMockGenerationService(
        { planId: PLAN_ID, status: "generating" },
        invalid,
      );
      const billing = buildAllowBilling();
      app = await buildTestApp({ db, generationService, billing });

      const response = await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/regenerate`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(422);
      expect(billing.checkAndConsume).not.toHaveBeenCalled();
      expect(generationService.startGeneration).not.toHaveBeenCalled();
    });

    it("calls assertGeneratable before checkAndConsume on confirm (validation precedes consumption)", async () => {
      const db = buildSessionOnlyDb(buildSessionRow());
      const callOrder: string[] = [];
      const generationService = {
        assertGeneratable: vi.fn().mockImplementation(async () => {
          callOrder.push("assertGeneratable");
        }),
        startGeneration: vi.fn().mockResolvedValue({ planId: PLAN_ID, status: "generating" }),
      };
      const billing = {
        checkAndConsume: vi.fn().mockImplementation(async () => {
          callOrder.push("checkAndConsume");
          return { allowed: true, tier: "free", source: "backfill", period: "2026-07" };
        }),
      };
      app = await buildTestApp({ db, generationService, billing });

      await app.inject({
        method: "POST",
        url: `/plan-specs/${SPEC_ID}/confirm`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(callOrder).toEqual(["assertGeneratable", "checkAndConsume"]);
    });
  });
});
