/**
 * Tests for the 14a-v1.1 adherence-adaptation confirm route:
 *   POST /plan-specs/:id/adapt   (Slice B1 — Threat Matrix)
 *
 * The route is SERVER-AUTHORITATIVE: the client posts `{}` and never a target
 * frequency. The route re-derives the current adherence recommendation the same
 * way the dashboard does (via `adherenceReader.getDashboardSummary`), rejects a
 * stale/forged accept with 409, and — only for a genuine `low + reduce_frequency`
 * recommendation for THIS spec — consumes one `plan_regeneration` unit, persists
 * the reduced `daysPerWeek`, and starts generation.
 *
 * Ordering guarantee under test: consume-BEFORE-write. A denied/exhausted consume
 * must leave the spec UNCHANGED (no `updateSpecDaysPerWeek`, no generation) — no
 * half-applied state.
 *
 * Strategy mirrors `plan-generation.test.ts`: mock the generation service, the
 * billing gate, the adherence reader, and the plan-route port at the service
 * level (not the DB level) to keep the focus on route logic.
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

// --- Shared fixtures ---

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

// --- Mock service/reader/repo factories ---

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

const lowAdaptation: AdaptationRecommendation = {
  source: "adherence",
  level: "low",
  suggestedChange: { kind: "reduce_frequency", fromDays: 4, toDays: 3 },
  rationaleKey: "adaptation.adherence.reduceFrequency",
  planSpecId: SPEC_ID,
  adherence: { adherence: 0.31, periodWeeks: 4, completedInWindow: 5, plannedInWindow: 16 },
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

function buildRepo(updateSpecDaysPerWeek = vi.fn().mockResolvedValue(1)): PlanRouteRepo {
  return {
    upsertDraft: vi.fn(() => { throw new Error("unexpected call: upsertDraft"); }),
    commitDraft: vi.fn(() => { throw new Error("unexpected call: commitDraft"); }),
    findCurrentDraft: vi.fn(() => { throw new Error("unexpected call: findCurrentDraft"); }),
    promoteDraftToSpec: vi.fn(() => { throw new Error("unexpected call: promoteDraftToSpec"); }),
    findPlanById: vi.fn().mockResolvedValue(undefined),
    findLatestPlanBySpec: vi.fn().mockResolvedValue(undefined),
    findAllPlansByUser: vi.fn().mockResolvedValue([]),
    updateSpecDaysPerWeek,
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
    adherenceReader: opts.adherenceReader ?? buildAdherenceReader(lowAdaptation),
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

// --- Tests ---

describe("POST /plan-specs/:id/adapt", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 401 when unauthenticated (no session)", async () => {
    app = await buildTestApp({ db: buildSessionOnlyDb() });
    const res = await post(app);
    expect(res.statusCode).toBe(401);
  });

  it("202: low + reduce_frequency for this spec → persists toDays, consumes one unit, starts generation", async () => {
    const update = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    const generationService = buildGenerationService();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      repo: buildRepo(update),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ planId: PLAN_ID, status: "generating" });
    // Server-derived toDays (3) persisted for the authenticated tenant/user.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(TENANT_A, USER_A, SPEC_ID, 3);
    // Exactly one plan_regeneration unit consumed.
    expect(billing.checkAndConsume).toHaveBeenCalledTimes(1);
    expect(billing.checkAndConsume.mock.calls[0][1]).toBe("plan_regeneration");
    expect(generationService.startGeneration).toHaveBeenCalledWith(TENANT_A, USER_A, SPEC_ID, "en");
  });

  it("409 no_adaptation when the current recommendation is not low (recovered adherence) — no write, no consume, no generation", async () => {
    const update = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    const generationService = buildGenerationService();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      adherenceReader: buildAdherenceReader({ source: "adherence", level: "ok", planSpecId: SPEC_ID }),
      repo: buildRepo(update),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_adaptation" });
    expect(update).not.toHaveBeenCalled();
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
    expect(generationService.startGeneration).not.toHaveBeenCalled();
  });

  it("409 no_adaptation when the recommendation is low but for a DIFFERENT spec (stale accept)", async () => {
    const update = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      billing,
      adherenceReader: buildAdherenceReader({ ...lowAdaptation, planSpecId: "some-other-spec" }),
      repo: buildRepo(update),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(409);
    expect(update).not.toHaveBeenCalled();
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
  });

  it("403 when quota is exhausted → plan UNCHANGED (no write) and no generation (consume-before-write)", async () => {
    const update = vi.fn().mockResolvedValue(1);
    const billing = buildDenyBilling("tenant_quota_exhausted");
    const generationService = buildGenerationService();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      repo: buildRepo(update),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "tenant_quota_exhausted" });
    // No half-applied state: the consume ran and denied BEFORE any spec write.
    expect(update).not.toHaveBeenCalled();
    expect(generationService.startGeneration).not.toHaveBeenCalled();
  });

  it("404 when the spec belongs to another tenant/user (assertGeneratable rejects) — no write, no consume", async () => {
    const update = vi.fn().mockResolvedValue(0);
    const billing = buildAllowBilling();
    const generationService = buildGenerationService({ validationError: new NotFoundError("not found") });
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      repo: buildRepo(update),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(404);
    expect(update).not.toHaveBeenCalled();
    expect(billing.checkAndConsume).not.toHaveBeenCalled();
  });

  it("ignores a body-injected daysPerWeek / tenantId — server re-derives toDays", async () => {
    const update = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      billing,
      repo: buildRepo(update),
    });

    const res = await post(
      app,
      { "content-type": "application/json" },
      { daysPerWeek: 1, tenantId: "attacker-tenant", toDays: 1 },
    );

    expect(res.statusCode).toBe(202);
    // The server ignores the forged body and persists the RE-DERIVED toDays (3),
    // scoped to the authenticated tenant — never the attacker's tenant or days.
    expect(update).toHaveBeenCalledWith(TENANT_A, USER_A, SPEC_ID, 3);
  });

  // --- Review fix (B1 4R risk+reliability, CRITICAL) ---------------------
  //
  // An `/adapt` accept is a REGENERATION and must cost one `plan_regeneration`
  // unit EACH time, exactly like `/regenerate` (plan.ts:628 appends a fresh
  // `randomUUID()`). The recommendation is re-derived from `latestReadyPlan`,
  // NOT the just-written spec, so it stays confirmable for the entire async
  // generation window — a STABLE default key would let every repeated POST in
  // that window replay the ledger (zero further consume) while still firing a
  // fresh, expensive LLM regeneration: N regenerations for 1 quota unit. The
  // default MUST be a fresh nonce per request so the quota genuinely bounds
  // repeated accepts; a caller-supplied `Idempotency-Key` header (a genuine
  // client retry) is still honored and replays as before.
  it("two distinct accepts consume TWO separate units (no default replay) via fresh idempotency keys", async () => {
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
    // DIFFERENT keys → the real ledger charges TWO units, not one.
    expect(key1).not.toBe(key2);
  });

  it("a Free user's 2nd accept in the same period is denied with 403 and starts NO extra generation (bounds the amplification)", async () => {
    const generationService = buildGenerationService();
    const checkAndConsume = vi
      .fn()
      .mockResolvedValueOnce({ allowed: true, tier: "free", source: "backfill", period: "2026-07" })
      .mockResolvedValueOnce({ allowed: false, reason: "tenant_quota_exhausted" });
    const billing = { checkAndConsume };
    const update = vi.fn().mockResolvedValue(1);
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      repo: buildRepo(update),
    });

    const res1 = await post(app);
    const res2 = await post(app);

    expect(res1.statusCode).toBe(202);
    expect(res2.statusCode).toBe(403);
    expect(res2.json()).toEqual({ error: "tenant_quota_exhausted" });
    // Only the FIRST accept wrote the spec and started generation; the denied
    // 2nd accept touches neither — no free extra regeneration.
    expect(update).toHaveBeenCalledTimes(1);
    expect(generationService.startGeneration).toHaveBeenCalledTimes(1);
  });

  it("honors a client-supplied Idempotency-Key header for a genuine retry (replays the same decision)", async () => {
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

  // --- #244: atomic write + startGeneration via compensating rollback ------
  //
  // consume → write(daysPerWeek) → startGeneration is non-atomic. If
  // startGeneration throws SYNCHRONOUSLY after the daysPerWeek write already
  // committed, the spec would be left at the REDUCED frequency with a consumed
  // quota unit but NO fresh generation. The handler must perform a compensating
  // write restoring the ORIGINAL frequency (`suggestedChange.fromDays`) and then
  // rethrow so the caller still gets the error. The consumed unit is NOT
  // refunded (pre-existing behavior; the billing port exposes no reversal) — the
  // spec self-heals on the next retry.
  it("rolls back the daysPerWeek write when startGeneration fails synchronously, then surfaces the error", async () => {
    const update = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    const generationService = buildGenerationService({ result: new Error("generation boom") });
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      repo: buildRepo(update),
    });

    const res = await post(app);

    // The generation error still propagates to the client (never a silent 202).
    expect(res.statusCode).not.toBe(202);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    // Compensating rollback: first the reduced write (toDays=3), then the
    // restore to the original frequency (fromDays=4).
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, TENANT_A, USER_A, SPEC_ID, 3);
    expect(update).toHaveBeenNthCalledWith(2, TENANT_A, USER_A, SPEC_ID, 4);
    // The unit was consumed exactly once and is not refunded (self-healing on retry).
    expect(billing.checkAndConsume).toHaveBeenCalledTimes(1);
  });

  it("does NOT roll back on the happy path — updateSpecDaysPerWeek called once with toDays, 202", async () => {
    const update = vi.fn().mockResolvedValue(1);
    const billing = buildAllowBilling();
    const generationService = buildGenerationService();
    app = await buildTestApp({
      db: buildSessionOnlyDb(buildSessionRow()),
      generationService,
      billing,
      repo: buildRepo(update),
    });

    const res = await post(app);

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ planId: PLAN_ID, status: "generating" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(TENANT_A, USER_A, SPEC_ID, 3);
  });
});
