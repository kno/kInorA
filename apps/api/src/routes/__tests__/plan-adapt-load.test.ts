/**
 * Tests for the 14b-v1.1 RPE-adaptation LOAD branch of the confirm route:
 *   POST /plan-specs/:id/adapt   (adjust_load)
 *
 * Mirrors `plan-adapt.test.ts` (14a's `reduce_frequency` branch) exactly —
 * same server-authoritative shape, same consume-before-write discipline, same
 * fresh-`randomUUID()`-per-request default idempotency key, same #244
 * compensating-rollback-on-synchronous-throw guarantee — but exercises the
 * `adjust_load` `SuggestedChange` and `updateSpecIntensityBias` instead of
 * `reduce_frequency`/`updateSpecDaysPerWeek`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes, type PlanRouteRepo } from "../plan.js";
import type { Database } from "../../db/client.js";
import type { AdaptationRecommendation, DashboardSummaryDTO } from "@kinora/contracts";
import {
  VALID_TOKEN,
  createCyclingAuthMockDb,
  buildSessionRow as buildSharedSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const SPEC_ID = "spec-uuid-1";
const PLAN_ID = "plan-uuid-1";

function buildSessionRow(tenantId = TENANT_A, userId = USER_A) {
  return buildSharedSessionRow({ tenantId, userId });
}

function buildSessionOnlyDb(
  sessionRow?: unknown,
  membershipRow: unknown = buildActiveMembershipRow({ tenantId: TENANT_A, userId: USER_A }),
): Database {
  return createCyclingAuthMockDb({
    sessionRows: sessionRow ? [sessionRow] : [],
    membershipRows: sessionRow && membershipRow ? [membershipRow] : [],
  });
}

class NotFoundError extends Error {
  statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

function buildGenerationService(opts: { validationError?: Error; result?: { planId: string; status: "generating" } | Error } = {}) {
  return {
    assertGeneratable: vi.fn().mockImplementation(() =>
      opts.validationError ? Promise.reject(opts.validationError) : Promise.resolve(undefined),
    ),
    startGeneration: vi.fn().mockImplementation(() =>
      opts.result instanceof Error
        ? Promise.reject(opts.result)
        : Promise.resolve(opts.result ?? { planId: PLAN_ID, status: "generating" }),
    ),
  };
}

const lowRpeAdaptation: AdaptationRecommendation = {
  source: "rpe",
  level: "low",
  suggestedChange: { kind: "adjust_load", direction: "decrease", from: "maintain", to: "reduce" },
  rationaleKey: "adaptation.rpe.reduceLoad",
  planSpecId: SPEC_ID,
  rpe: { meanRpe: 9, windowSessions: 3, sessionsWithRpe: 3, setsWithRpe: 6 },
};

function buildSummary(adaptation?: AdaptationRecommendation): DashboardSummaryDTO {
  return {
    streak: 0,
    recentDailyCompletion: [],
    weeklyCompleted: 1,
    weeklyPlanned: 4,
    weeklyRollup: [],
    ...(adaptation ? { adaptation } : {}),
  };
}

function buildAdherenceReader(adaptation?: AdaptationRecommendation) {
  return {
    getDashboardSummary: vi.fn().mockResolvedValue(buildSummary(adaptation)),
  };
}

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

function buildDenyBilling(reason = "tenant_quota_exhausted") {
  return {
    checkAndConsume: vi.fn().mockResolvedValue({ allowed: false, reason }),
  };
}

function buildRepo(overrides: Partial<PlanRouteRepo> = {}): PlanRouteRepo {
  return {
    upsertDraft: vi.fn(() => { throw new Error("unexpected call: upsertDraft"); }),
    commitDraft: vi.fn(() => { throw new Error("unexpected call: commitDraft"); }),
    findCurrentDraft: vi.fn(() => { throw new Error("unexpected call: findCurrentDraft"); }),
    promoteDraftToSpec: vi.fn(() => { throw new Error("unexpected call: promoteDraftToSpec"); }),
    findPlanById: vi.fn().mockResolvedValue(undefined),
    findLatestPlanBySpec: vi.fn().mockResolvedValue(undefined),
    findAllPlansByUser: vi.fn().mockResolvedValue([]),
    updateSpecDaysPerWeek: vi.fn().mockResolvedValue(1),
    updateSpecIntensityBias: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
}

async function buildTestApp(opts: {
  db: Database;
  generationService?: ReturnType<typeof buildGenerationService>;
  billing?: { checkAndConsume: ReturnType<typeof vi.fn> };
  adherenceReader?: { getDashboardSummary: ReturnType<typeof vi.fn> };
  repo?: PlanRouteRepo;
}): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: "Bad Request" });
    }
    if (error.name === "AuthError") {
      return reply.code(401).send({ error: error.message });
    }
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(statusCode).send({ error: error.message ?? "Internal Server Error" });
  });

  await app.register(authPlugin, { db: opts.db });
  await app.register(planRoutes, {
    repo: opts.repo ?? buildRepo(),
    generationService: (opts.generationService ?? buildGenerationService()) as never,
    billing: opts.billing as never,
    adherenceReader: opts.adherenceReader ?? buildAdherenceReader(lowRpeAdaptation),
  });

  return app;
}

function post(app: FastifyInstance, headers: Record<string, string> = {}, payload: unknown = {}) {
  return app.inject({
    method: "POST",
    url: `/plan-specs/${SPEC_ID}/adapt`,
    headers: { authorization: `Bearer ${VALID_TOKEN}`, ...headers },
    payload,
  });
}

describe("POST /plan-specs/:id/adapt — adjust_load (14b-v1.1)", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("202: low + adjust_load for this spec → persists intensityBias, consumes one unit, starts generation", async () => {
    const updateSpecIntensityBias = vi.fn().mockResolvedValue(1);
    const updateSpecDaysPerWeek = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    const generationService = buildGenerationService();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      repo: buildRepo({ updateSpecIntensityBias, updateSpecDaysPerWeek }),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ planId: PLAN_ID, status: "generating" });
    expect(updateSpecIntensityBias).toHaveBeenCalledTimes(1);
    expect(updateSpecIntensityBias).toHaveBeenCalledWith(TENANT_A, USER_A, SPEC_ID, "reduce");
    // The frequency write path must NEVER fire for a LOAD accept.
    expect(updateSpecDaysPerWeek).not.toHaveBeenCalled();
    expect(billing.checkAndConsume).toHaveBeenCalledTimes(1);
    expect(billing.checkAndConsume.mock.calls[0][1]).toBe("plan_regeneration");
    expect(generationService.startGeneration).toHaveBeenCalledWith(TENANT_A, USER_A, SPEC_ID, "en");
  });

  it("409 no_adaptation when the current recommendation is not low (RPE back in zone) — no write, no consume", async () => {
    const updateSpecIntensityBias = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      billing,
      adherenceReader: buildAdherenceReader({ source: "rpe", level: "ok", planSpecId: SPEC_ID }),
      repo: buildRepo({ updateSpecIntensityBias }),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_adaptation" });
    expect(updateSpecIntensityBias).not.toHaveBeenCalled();
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
  });

  it("409 no_adaptation when low + adjust_load is for a DIFFERENT spec (stale accept)", async () => {
    const updateSpecIntensityBias = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      billing,
      adherenceReader: buildAdherenceReader({ ...lowRpeAdaptation, planSpecId: "some-other-spec" }),
      repo: buildRepo({ updateSpecIntensityBias }),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(409);
    expect(updateSpecIntensityBias).not.toHaveBeenCalled();
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
  });

  it("403 when quota is exhausted → spec UNCHANGED (no write) and no generation (consume-before-write)", async () => {
    const updateSpecIntensityBias = vi.fn().mockResolvedValue(1);
    const billing = buildDenyBilling("tenant_quota_exhausted");
    const generationService = buildGenerationService();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      repo: buildRepo({ updateSpecIntensityBias }),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "tenant_quota_exhausted" });
    expect(updateSpecIntensityBias).not.toHaveBeenCalled();
    expect(generationService.startGeneration).not.toHaveBeenCalled();
  });

  it("404 when the spec belongs to another tenant/user (assertGeneratable rejects) — no write, no consume", async () => {
    const updateSpecIntensityBias = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    const generationService = buildGenerationService({ validationError: new NotFoundError("not found") });
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      repo: buildRepo({ updateSpecIntensityBias }),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(404);
    expect(updateSpecIntensityBias).not.toHaveBeenCalled();
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
  });

  it("two distinct accepts consume TWO separate units (fresh randomUUID default key, no replay)", async () => {
    const billing = buildAllowBilling();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      billing,
    });

    await post(app);
    await post(app);

    expect(billing.checkAndConsume).toHaveBeenCalledTimes(2);
    const key1 = billing.checkAndConsume.mock.calls[0][2];
    const key2 = billing.checkAndConsume.mock.calls[1][2];
    expect(key1).not.toBe(key2);
  });

  it("honors a client-supplied Idempotency-Key header for a genuine retry", async () => {
    const billing = buildAllowBilling();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      billing,
    });

    await post(app, { "idempotency-key": "client-retry-key-1" });
    await post(app, { "idempotency-key": "client-retry-key-1" });

    expect(billing.checkAndConsume).toHaveBeenCalledTimes(2);
    const key1 = billing.checkAndConsume.mock.calls[0][2];
    const key2 = billing.checkAndConsume.mock.calls[1][2];
    expect(key1).toBe("client-retry-key-1");
    expect(key2).toBe("client-retry-key-1");
  });

  // --- #244-class atomic write + startGeneration via compensating rollback ---
  it("rolls back the intensityBias write when startGeneration fails synchronously, then surfaces the error", async () => {
    const updateSpecIntensityBias = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    const generationService = buildGenerationService({ result: new Error("generation boom") });
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      repo: buildRepo({ updateSpecIntensityBias }),
    });

    const res = await post(app);

    expect(res.statusCode).not.toBe(202);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    // Compensating rollback: first the ladder-stepped write ("reduce"), then
    // the restore to the original bias ("maintain").
    expect(updateSpecIntensityBias).toHaveBeenCalledTimes(2);
    expect(updateSpecIntensityBias).toHaveBeenNthCalledWith(1, TENANT_A, USER_A, SPEC_ID, "reduce");
    expect(updateSpecIntensityBias).toHaveBeenNthCalledWith(2, TENANT_A, USER_A, SPEC_ID, "maintain");
    expect(billing.checkAndConsume).toHaveBeenCalledTimes(1);
  });

  it("409 no_adaptation when the repo has no updateSpecIntensityBias wired (LOAD unsupported) — no crash, no write", async () => {
    const billing = buildAllowBilling();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      billing,
      repo: buildRepo({ updateSpecIntensityBias: undefined }),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_adaptation" });
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
  });
});
