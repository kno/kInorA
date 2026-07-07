import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes, type PlanRouteRepo } from "../plan.js";
import type { Database } from "../../db/client.js";
import type { PlanSpec } from "@kinora/contracts";
import {
  createAuthMockDb,
  buildActiveMembershipRow,
  MEMBERSHIP_SELECT_INDEX,
  type AuthMockDb,
} from "../../test-support/auth-mocks.js";

// --- Shared test fixtures ---

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";

const specPayload = {
  goal: "strength",
  location: "gym",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  equipment: ["barbell"],
  limitations: [],
  preferenceScores: {
    strength: 0.9,
    hypertrophy: 0.6,
    endurance: 0.2,
    mobility: 0.3,
  },
  confirmed: false,
};

const draftRow = {
  id: "draft-uuid-1",
  tenantId: TENANT_A,
  userId: USER_A,
  step: 3,
  specJson: specPayload,
  updatedAt: new Date("2026-06-27T12:00:00Z"),
};

const planSpecRow = {
  id: "spec-uuid-1",
  spec: { ...specPayload, confirmed: true } as unknown as PlanSpec,
};

// A valid Bearer token — the session lookup mock decides whether it is authentic.
const VALID_TOKEN = "a".repeat(64);
const SESSION_HASH = "b".repeat(64); // mock hash for the token

// --- Auth DB mock builder (auth plugin ONLY) ---
//
// The auth plugin's onRequest hook calls, in order:
//   1. db.select().from(sessions).where(eq(sessions.tokenHash, hash))  → session
//   2. db.select().from(memberships).where(and(tenantId, userId))      → membership
// Route data no longer flows through db — it flows through the injected
// PlanRouteRepo port. So the db mock only models the two auth selects.
// `MEMBERSHIP_SELECT_INDEX` is the ordinal of the membership re-check and its
// ordering assertion stays on this auth mock (never on the route port).

const ACTIVE_MEMBERSHIP_ROW = buildActiveMembershipRow({
  tenantId: TENANT_A,
  userId: USER_A,
});

function sessionSelectChain(
  sessionRows: unknown[],
  membershipRows: unknown[] = [ACTIVE_MEMBERSHIP_ROW]
): ReturnType<typeof vi.fn> & { resolvedByCall: AuthMockDb["resolvedByCall"] } {
  const mock = createAuthMockDb({ sessionRows, membershipRows });
  return Object.assign(mock.select, { resolvedByCall: mock.resolvedByCall }) as
    ReturnType<typeof vi.fn> & { resolvedByCall: AuthMockDb["resolvedByCall"] };
}

/** Build a session-only DB mock (auth plugin needs the session+membership selects). */
function buildSessionDb(tenantId = TENANT_A, userId = USER_A): Database {
  const sessionRows = [
    {
      tokenHash: SESSION_HASH,
      userId,
      tenantId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  ];
  const select = sessionSelectChain(sessionRows);
  return { select } as unknown as Database;
}

/** A DB mock with NO session row → auth resolves null (unauthenticated). */
function buildUnauthDb(): Database {
  const select = sessionSelectChain([]);
  return { select } as unknown as Database;
}

// --- PlanRouteRepo port mock ---
//
// Collapses the former db.transaction promote + draft/spec/plan repos into a
// single injected port. Every method is a vi.fn() so tests assert the calls the
// route makes (e.g. promoteDraftToSpec called once with authContext ids).

type PlanRepoMock = {
  [K in keyof PlanRouteRepo]: ReturnType<typeof vi.fn>;
};

function buildPlanRepo(overrides: Partial<PlanRepoMock> = {}): PlanRepoMock {
  return {
    upsertDraft: vi
      .fn()
      .mockResolvedValue({ step: draftRow.step, specJson: draftRow.specJson }),
    findCurrentDraft: vi.fn().mockResolvedValue(null),
    promoteDraftToSpec: vi.fn().mockResolvedValue(planSpecRow),
    findPlanById: vi.fn().mockResolvedValue(undefined),
    findLatestPlanBySpec: vi.fn().mockResolvedValue(undefined),
    findAllPlansByUser: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// Minimal no-op generation service for wizard-only route tests.
const noopGenerationService = {
  startGeneration: () => Promise.reject(new Error("unexpected call in wizard tests")),
};

// Build a test Fastify app with auth plugin (own db mock) + plan routes (port).
async function buildTestApp(
  db: Database,
  repo: PlanRepoMock = buildPlanRepo()
): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: "Bad Request", details: error.validation });
    }
    if (error.name === "AuthError") {
      return reply.code(401).send({ error: error.message });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  await app.register(authPlugin, { db });
  await app.register(planRoutes, {
    repo,
    generationService: noopGenerationService,
  });

  return app;
}

// --- Tests ---

describe("Plan routes", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // --- POST /plan-specs/drafts ---

  describe("POST /plan-specs/drafts", () => {
    it("returns 401 when no authorization header is provided", async () => {
      app = await buildTestApp(buildUnauthDb());

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        payload: { step: 1, spec: specPayload },
      });

      expect(response.statusCode).toBe(401);
    });

    it("upserts draft and returns {step, spec} when authenticated", async () => {
      const repo = buildPlanRepo({
        upsertDraft: vi
          .fn()
          .mockResolvedValue({ step: draftRow.step, specJson: draftRow.specJson }),
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { step: 3, spec: specPayload },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.step).toBe(3);
      expect(body.spec).toBeDefined();
    });

    it("returns 400 when step is missing from the body", async () => {
      app = await buildTestApp(buildSessionDb());

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { spec: specPayload }, // step intentionally absent
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when step is not an integer (string value)", async () => {
      app = await buildTestApp(buildSessionDb());

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { step: "three", spec: specPayload },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when spec is not an object (number value)", async () => {
      app = await buildTestApp(buildSessionDb());

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { step: 1, spec: 42 },
      });

      expect(response.statusCode).toBe(400);
    });

    it("second call for same user returns updated draft (single-active)", async () => {
      const repo = buildPlanRepo({
        upsertDraft: vi
          .fn()
          .mockResolvedValue({ step: 4, specJson: draftRow.specJson }),
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { step: 4, spec: specPayload },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.step).toBe(4);
    });
  });

  // --- GET /plan-specs/drafts/current ---

  describe("GET /plan-specs/drafts/current", () => {
    it("returns 401 when not authenticated", async () => {
      app = await buildTestApp(buildUnauthDb());

      const response = await app.inject({
        method: "GET",
        url: "/plan-specs/drafts/current",
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 204 when no draft exists", async () => {
      const repo = buildPlanRepo({ findCurrentDraft: vi.fn().mockResolvedValue(null) });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "GET",
        url: "/plan-specs/drafts/current",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(204);
    });

    it("returns {step, spec} when a draft exists", async () => {
      const repo = buildPlanRepo({
        findCurrentDraft: vi
          .fn()
          .mockResolvedValue({ step: draftRow.step, specJson: draftRow.specJson }),
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "GET",
        url: "/plan-specs/drafts/current",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.step).toBe(3);
      expect(body.spec).toBeDefined();
    });
  });

  // --- POST /plan-specs (promote draft) ---

  describe("POST /plan-specs", () => {
    it("returns 401 when not authenticated", async () => {
      app = await buildTestApp(buildUnauthDb());

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 409 when no draft exists", async () => {
      const repo = buildPlanRepo({ findCurrentDraft: vi.fn().mockResolvedValue(null) });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
    });

    it("returns 409 when draft has incomplete spec (missing required fields)", async () => {
      const repo = buildPlanRepo({
        findCurrentDraft: vi
          .fn()
          .mockResolvedValue({ step: 3, specJson: { goal: "strength" } }),
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("incomplete_spec");
    });

    // Bug regression: a realistic wizard draft (input fields only, NO preferenceScores,
    // NO confirmed) must promote successfully to 201 — the server derives the scores.
    it("returns 201 when draft is a realistic partial wizard spec (no preferenceScores, no confirmed)", async () => {
      const repo = buildPlanRepo({
        findCurrentDraft: vi.fn().mockResolvedValue({
          step: 3,
          specJson: {
            goal: "strength",
            daysPerWeek: 3,
            sessionDurationMinutes: 60,
            location: "gym",
            equipment: ["barbell"],
            limitations: [{ text: "knee pain", isWarning: true }],
            // NOTE: no preferenceScores, no confirmed — real wizard output
          },
        }),
        promoteDraftToSpec: vi.fn().mockResolvedValue(planSpecRow),
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.spec).toBeDefined();
    });

    it("returns 409 incomplete_spec when draft is missing a required input field (no goal)", async () => {
      const repo = buildPlanRepo({
        findCurrentDraft: vi.fn().mockResolvedValue({
          step: 3,
          specJson: {
            // goal intentionally absent
            daysPerWeek: 3,
            sessionDurationMinutes: 60,
            location: "gym",
            equipment: [],
            limitations: [],
          },
        }),
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("incomplete_spec");
    });

    it("returns 201 {id, spec} when draft is complete and promotes via the port", async () => {
      const repo = buildPlanRepo({
        findCurrentDraft: vi.fn().mockResolvedValue({
          step: 3,
          specJson: {
            ...specPayload,
            confirmed: true,
            preferenceScores: {
              strength: 0.9,
              hypertrophy: 0.6,
              endurance: 0.2,
              mobility: 0.3,
            },
          },
        }),
        promoteDraftToSpec: vi.fn().mockResolvedValue(planSpecRow),
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.spec).toBeDefined();
    });

    // #93: the wizard captures an optional plan name into the draft JSON. On
    // promote the route rebuilds the confirmed spec from the input fields; the
    // name MUST survive into the confirmed spec (it is the durable carrier to the
    // later generation request, where the draft is already deleted). Regression
    // for the gap where the name was silently dropped by the input Pick.
    it("preserves a user-entered plan name from the draft into the confirmed spec (#93)", async () => {
      const promoteDraftToSpec = vi.fn().mockResolvedValue(planSpecRow);
      const repo = buildPlanRepo({
        findCurrentDraft: vi.fn().mockResolvedValue({
          step: 6,
          specJson: {
            goal: "strength",
            daysPerWeek: 3,
            sessionDurationMinutes: 60,
            location: "gym",
            equipment: ["barbell"],
            limitations: [],
            name: "Summer Cut",
          },
        }),
        promoteDraftToSpec,
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      expect(promoteDraftToSpec).toHaveBeenCalledTimes(1);
      const [, , specArg] = promoteDraftToSpec.mock.calls[0];
      expect(specArg.name).toBe("Summer Cut");
      expect(specArg.confirmed).toBe(true);
    });

    it("normalizes a blank/absent plan name to null in the confirmed spec (#93)", async () => {
      const promoteDraftToSpec = vi.fn().mockResolvedValue(planSpecRow);
      const repo = buildPlanRepo({
        findCurrentDraft: vi.fn().mockResolvedValue({
          step: 6,
          specJson: {
            goal: "strength",
            daysPerWeek: 3,
            sessionDurationMinutes: 60,
            location: "gym",
            equipment: ["barbell"],
            limitations: [],
            name: "   ",
          },
        }),
        promoteDraftToSpec,
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const [, , specArg] = promoteDraftToSpec.mock.calls[0];
      // Whitespace-only → null so the read-side default stays dynamic; never "".
      expect(specArg.name).toBeNull();
    });

    // #93 BLOCKER: workout_plans.name is VARCHAR(120). Without a boundary length
    // guard an over-long name passes validation and blows up the DB INSERT as a
    // 500. The route must reject it as a clean 4xx BEFORE the write. Negative
    // control: this test fails (gets 500/201) if the length bound is removed.
    it("rejects a plan name longer than 120 chars with a 4xx, not a 500 (#93)", async () => {
      const promoteDraftToSpec = vi.fn().mockResolvedValue(planSpecRow);
      const repo = buildPlanRepo({
        findCurrentDraft: vi.fn().mockResolvedValue({
          step: 6,
          specJson: {
            goal: "strength",
            daysPerWeek: 3,
            sessionDurationMinutes: 60,
            location: "gym",
            equipment: ["barbell"],
            limitations: [],
            name: "a".repeat(121),
          },
        }),
        promoteDraftToSpec,
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      // Reachable 422 branch — the specific plan_name_too_long error (not the
      // generic 409, and never a 500), and the write never runs.
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: "plan_name_too_long" });
      expect(promoteDraftToSpec).not.toHaveBeenCalled();
    });

    it("accepts a plan name of exactly 120 chars (#93 boundary)", async () => {
      const promoteDraftToSpec = vi.fn().mockResolvedValue(planSpecRow);
      const name120 = "a".repeat(120);
      const repo = buildPlanRepo({
        findCurrentDraft: vi.fn().mockResolvedValue({
          step: 6,
          specJson: {
            goal: "strength",
            daysPerWeek: 3,
            sessionDurationMinutes: 60,
            location: "gym",
            equipment: ["barbell"],
            limitations: [],
            name: name120,
          },
        }),
        promoteDraftToSpec,
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      expect(promoteDraftToSpec).toHaveBeenCalledTimes(1);
      const [, , specArg] = promoteDraftToSpec.mock.calls[0];
      expect(specArg.name).toBe(name120);
    });

    // Atomicity is now encapsulated behind the port. The route must delegate to
    // repo.promoteDraftToSpec exactly once — the app.ts adapter owns the single
    // db.transaction wrapping specRepo.create + draftRepo.delete. This replaces
    // the old db.transaction / txInsert / txDelete spy assertions.
    it("promotes atomically via a single repo.promoteDraftToSpec call", async () => {
      const promoteDraftToSpec = vi.fn().mockResolvedValue(planSpecRow);
      const repo = buildPlanRepo({
        findCurrentDraft: vi.fn().mockResolvedValue({
          step: 3,
          specJson: {
            ...specPayload,
            confirmed: true,
            preferenceScores: {
              strength: 0.9,
              hypertrophy: 0.6,
              endurance: 0.2,
              mobility: 0.3,
            },
          },
        }),
        promoteDraftToSpec,
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      // The single port call is the atomicity boundary.
      expect(promoteDraftToSpec).toHaveBeenCalledTimes(1);
      // It is invoked with the authContext tenant/user and the server-derived spec.
      const [tenantArg, userArg, specArg] = promoteDraftToSpec.mock.calls[0];
      expect(tenantArg).toBe(TENANT_A);
      expect(userArg).toBe(USER_A);
      expect(specArg.confirmed).toBe(true);
      expect(specArg.preferenceScores).toBeDefined();
    });

    it("cross-tenant: user from tenant B cannot promote tenant A draft (no draft found = 409)", async () => {
      // Tenant B session; the port (tenant-scoped) finds no draft.
      const repo = buildPlanRepo({ findCurrentDraft: vi.fn().mockResolvedValue(null) });
      app = await buildTestApp(buildSessionDb(TENANT_B, USER_A), repo);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
    });
  });

  // --- Tenant-scoping regression: repo is called with authContext values ---
  //
  // These tests assert that tenantId and userId flowing into port calls are always
  // taken from request.authContext (populated by the auth plugin from the session)
  // and NEVER from the request body. A body containing bogus tenant/user IDs must
  // not influence which rows are read or written.

  describe("Tenant-scoping: repo is called with authContext values, not body values", () => {
    it("POST /plan-specs/drafts — upsertDraft uses tenantId+userId from authContext, ignoring any body tenantId", async () => {
      const upsertDraft = vi
        .fn()
        .mockResolvedValue({ step: 2, specJson: draftRow.specJson });
      const repo = buildPlanRepo({ upsertDraft });
      app = await buildTestApp(buildSessionDb(), repo);

      // Send a body with a bogus tenantId field — routes must never read this
      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {
          step: 2,
          spec: { ...specPayload, tenantId: TENANT_B }, // attacker-supplied tenantId inside spec
        },
      });

      expect(response.statusCode).toBe(200);

      // The port must have been called with the authenticated tenant+user.
      expect(upsertDraft).toHaveBeenCalledTimes(1);
      const [tenantArg, userArg] = upsertDraft.mock.calls[0];
      expect(tenantArg).toBe(TENANT_A);
      expect(userArg).toBe(USER_A);
      expect(tenantArg).not.toBe(TENANT_B);
    });

    it("GET /plan-specs/drafts/current — findCurrentDraft is called with authContext tenantId, not a body value", async () => {
      const findCurrentDraft = vi
        .fn()
        .mockResolvedValue({ step: draftRow.step, specJson: draftRow.specJson });
      const repo = buildPlanRepo({ findCurrentDraft });
      const db = buildSessionDb();
      app = await buildTestApp(db, repo);

      const response = await app.inject({
        method: "GET",
        url: "/plan-specs/drafts/current",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      // The port lookup is scoped to the authContext tenant+user.
      expect(findCurrentDraft).toHaveBeenCalledWith(TENANT_A, USER_A);
      // Raw-select ordering assertion (kept intentionally on the AUTH db mock):
      // the auth pipeline runs session (0) then the tenant-scoped membership
      // re-check (MEMBERSHIP_SELECT_INDEX) via db.select. This ordering coverage
      // stays on the auth mock, not the route port.
      const select = db.select as unknown as { resolvedByCall: unknown[][] };
      expect(select.resolvedByCall[MEMBERSHIP_SELECT_INDEX]).toEqual([
        ACTIVE_MEMBERSHIP_ROW,
      ]);
    });

    it("POST /plan-specs (promote) — promoteDraftToSpec uses authContext tenantId+userId, body values are ignored", async () => {
      const promoteDraftToSpec = vi.fn().mockResolvedValue(planSpecRow);
      const repo = buildPlanRepo({
        findCurrentDraft: vi.fn().mockResolvedValue({
          step: 3,
          specJson: {
            ...specPayload,
            confirmed: true,
            preferenceScores: {
              strength: 0.9,
              hypertrophy: 0.6,
              endurance: 0.2,
              mobility: 0.3,
            },
          },
        }),
        promoteDraftToSpec,
      });
      app = await buildTestApp(buildSessionDb(), repo);

      // Body carries an attacker-supplied tenantId — must be ignored
      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { tenantId: TENANT_B, userId: "attacker-user-id" },
      });

      expect(response.statusCode).toBe(201);

      // The promote must use TENANT_A + USER_A (from authContext), never the body.
      expect(promoteDraftToSpec).toHaveBeenCalledTimes(1);
      const [tenantArg, userArg] = promoteDraftToSpec.mock.calls[0];
      expect(tenantArg).toBe(TENANT_A);
      expect(userArg).toBe(USER_A);
      expect(tenantArg).not.toBe(TENANT_B);
    });
  });

  // --- GET /workout-plans (list) ---

  describe("GET /workout-plans", () => {
    it("returns 401 when no authorization header is provided (SC-01)", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(buildUnauthDb(), repo);

      const response = await app.inject({
        method: "GET",
        url: "/workout-plans",
      });

      expect(response.statusCode).toBe(401);
      expect(repo.findAllPlansByUser).not.toHaveBeenCalled();
    });

    it("returns 200 with empty array when user has no plans (SC-02)", async () => {
      const repo = buildPlanRepo({ findAllPlansByUser: vi.fn().mockResolvedValue([]) });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "GET",
        url: "/workout-plans",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    });

    it("returns 200 array of { id, status, createdAt } summaries ordered newest-first (SC-03)", async () => {
      const summaries = [
        { id: "plan-newer", status: "ready", createdAt: new Date("2026-06-29T10:00:00Z") },
        { id: "plan-older", status: "generating", createdAt: new Date("2026-06-28T09:00:00Z") },
      ];
      const repo = buildPlanRepo({
        findAllPlansByUser: vi.fn().mockResolvedValue(summaries),
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "GET",
        url: "/workout-plans",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Array<{ id: string; status: string; createdAt: string }>;
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe("plan-newer");
      expect(body[0].status).toBe("ready");
      expect(body[0].createdAt).toBeDefined();
      expect(body[1].id).toBe("plan-older");
    });

    it("maps the resolved plan name into each list item (#93)", async () => {
      const summaries = [
        { id: "plan-newer", status: "ready", createdAt: new Date("2026-06-29T10:00:00Z"), name: "Summer Cut" },
        { id: "plan-older", status: "generating", createdAt: new Date("2026-06-28T09:00:00Z"), name: "Plan 2026-06-28" },
      ];
      const repo = buildPlanRepo({
        findAllPlansByUser: vi.fn().mockResolvedValue(summaries),
      });
      app = await buildTestApp(buildSessionDb(), repo);

      const response = await app.inject({
        method: "GET",
        url: "/workout-plans",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Array<{ id: string; name?: string }>;
      expect(body[0].name).toBe("Summer Cut");
      expect(body[1].name).toBe("Plan 2026-06-28");
    });

    it("calls findAllPlansByUser with tenantId+userId from authContext (SC-04, tenant+user scoping)", async () => {
      const repo = buildPlanRepo({ findAllPlansByUser: vi.fn().mockResolvedValue([]) });
      app = await buildTestApp(buildSessionDb(TENANT_A, USER_A), repo);

      await app.inject({
        method: "GET",
        url: "/workout-plans",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(repo.findAllPlansByUser).toHaveBeenCalledWith(TENANT_A, USER_A);
    });

    it("cross-tenant isolation: tenant B user cannot see tenant A plans — repo is called with tenant B context (SC-05)", async () => {
      const repo = buildPlanRepo({ findAllPlansByUser: vi.fn().mockResolvedValue([]) });
      app = await buildTestApp(buildSessionDb(TENANT_B, USER_A), repo);

      const response = await app.inject({
        method: "GET",
        url: "/workout-plans",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      expect(repo.findAllPlansByUser).toHaveBeenCalledWith(TENANT_B, USER_A);
      const body = response.json();
      expect(body).toHaveLength(0);
    });
  });

  // --- GET /workout-plans/:id ---

  describe("GET /workout-plans/:id", () => {
    const PLAN_ID = "plan-uuid-1";
    const SPEC_ID = "spec-uuid-1";
    const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

    const readyPlanRecord = {
      id: PLAN_ID,
      tenantId: TENANT_A,
      userId: USER_A,
      planSpecId: SPEC_ID,
      status: "ready" as const,
      programJson: {
        weeklySessions: [
          {
            day: 1,
            title: "Upper Body",
            exercises: [{ name: "Squat", sets: 4, reps: "8-12", restSeconds: 90 }],
          },
        ],
        limitationWarnings: [],
      },
      errorMessage: null,
      createdAt: new Date("2026-06-29T12:00:00Z"),
      updatedAt: new Date("2026-06-29T12:01:00Z"),
    };

    it("returns 401 when not authenticated (SC-06)", async () => {
      const repo = buildPlanRepo();
      app = await buildTestApp(buildUnauthDb(), repo);

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
      });

      expect(response.statusCode).toBe(401);
      expect(repo.findPlanById).not.toHaveBeenCalled();
    });

    it("returns 200 with DTO shape when plan is ready (SC-07)", async () => {
      const repo = buildPlanRepo({
        findPlanById: vi.fn().mockResolvedValue(readyPlanRecord),
      });
      app = await buildTestApp(buildSessionDb(TENANT_A, USER_A), repo);

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(PLAN_ID);
      expect(body.status).toBe("ready");
      expect(body.specId).toBe(SPEC_ID);
      expect(body.program).toBeDefined();
      // Must NOT leak internal DB columns
      expect(body.programJson).toBeUndefined();
      expect(body.tenantId).toBeUndefined();
      expect(body.userId).toBeUndefined();
      expect(body.errorMessage).toBeUndefined();
    });

    it("returns 200 with program undefined when plan is generating (SC-08)", async () => {
      const generatingPlan = {
        ...readyPlanRecord,
        status: "generating" as const,
        programJson: null,
      };
      const repo = buildPlanRepo({
        findPlanById: vi.fn().mockResolvedValue(generatingPlan),
      });
      app = await buildTestApp(buildSessionDb(TENANT_A, USER_A), repo);

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe("generating");
      expect(body.program).toBeUndefined();
    });

    it("returns 404 when plan does not exist (SC-09)", async () => {
      const repo = buildPlanRepo({
        findPlanById: vi.fn().mockResolvedValue(undefined),
      });
      app = await buildTestApp(buildSessionDb(TENANT_A, USER_A), repo);

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it("same-tenant cross-user: repo called with userId and returns 404 (SC-10 — Fix 1 CRITICAL)", async () => {
      // USER_B authenticates and tries to access USER_A's plan in TENANT_A.
      // The route must pass USER_B's userId to findPlanById.
      const findPlanById = vi.fn().mockResolvedValue(undefined);
      const repo = buildPlanRepo({ findPlanById });
      app = await buildTestApp(buildSessionDb(TENANT_A, USER_B), repo);

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(findPlanById).toHaveBeenCalledWith(TENANT_A, USER_B, PLAN_ID);
      expect(response.statusCode).toBe(404);
    });

    it("calls findPlanById with tenantId+userId from authContext (tenant + user scoped)", async () => {
      const findPlanById = vi.fn().mockResolvedValue(readyPlanRecord);
      const repo = buildPlanRepo({ findPlanById });
      app = await buildTestApp(buildSessionDb(TENANT_A, USER_A), repo);

      await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(findPlanById).toHaveBeenCalledWith(TENANT_A, USER_A, PLAN_ID);
    });

    it("maps the resolved plan name into the detail response (#93)", async () => {
      const repo = buildPlanRepo({
        findPlanById: vi
          .fn()
          .mockResolvedValue({ ...readyPlanRecord, name: "Summer Cut" }),
      });
      app = await buildTestApp(buildSessionDb(TENANT_A, USER_A), repo);

      const response = await app.inject({
        method: "GET",
        url: `/workout-plans/${PLAN_ID}`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe("Summer Cut");
    });
  });

  // --- GET /plan-specs/:id/workout-plan ---

  describe("GET /plan-specs/:id/workout-plan", () => {
    const SPEC_ID = "spec-uuid-1";
    const PLAN_ID = "plan-uuid-1";

    const readyPlanRecord = {
      id: PLAN_ID,
      tenantId: TENANT_A,
      userId: USER_A,
      planSpecId: SPEC_ID,
      status: "ready" as const,
      name: "Summer Cut",
      programJson: {
        weeklySessions: [
          {
            day: 1,
            title: "Upper Body",
            exercises: [{ name: "Squat", sets: 4, reps: "8-12", restSeconds: 90 }],
          },
        ],
        limitationWarnings: [],
      },
      errorMessage: null,
      createdAt: new Date("2026-06-29T12:00:00Z"),
      updatedAt: new Date("2026-06-29T12:01:00Z"),
    };

    it("maps the resolved plan name into the spec-detail response (#93)", async () => {
      const repo = buildPlanRepo({
        findLatestPlanBySpec: vi.fn().mockResolvedValue(readyPlanRecord),
      });
      app = await buildTestApp(buildSessionDb(TENANT_A, USER_A), repo);

      const response = await app.inject({
        method: "GET",
        url: `/plan-specs/${SPEC_ID}/workout-plan`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(PLAN_ID);
      expect(body.name).toBe("Summer Cut");
      expect(body.specId).toBe(SPEC_ID);
    });

    it("returns 404 when no plan exists for the spec", async () => {
      const repo = buildPlanRepo({
        findLatestPlanBySpec: vi.fn().mockResolvedValue(undefined),
      });
      app = await buildTestApp(buildSessionDb(TENANT_A, USER_A), repo);

      const response = await app.inject({
        method: "GET",
        url: `/plan-specs/${SPEC_ID}/workout-plan`,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
