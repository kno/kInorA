import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes } from "../plan.js";
import type { Database } from "../../db/client.js";

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
  tenantId: TENANT_A,
  userId: USER_A,
  specJson: { ...specPayload, confirmed: true },
  confirmed: true,
  createdAt: new Date("2026-06-27T12:00:00Z"),
};

// A valid Bearer token — the session lookup mock decides whether it is authentic.
const VALID_TOKEN = "a".repeat(64);
const SESSION_HASH = "b".repeat(64); // mock hash for the token

// --- Mock DB builder ---
//
// The auth plugin's onRequest hook calls:
//   db.select().from(sessions).where(eq(sessions.tokenHash, hash))
// to find the session. All mock DBs must cover this first select.
//
// Plan route mocks need additional select/insert/delete calls.
// We pass them as chained mockReturnValue sequences on the same `select` mock.

function sessionSelectChain(
  sessionRows: unknown[],
  additionalRows: unknown[][] = []
) {
  const allRows = [sessionRows, ...additionalRows];
  let callCount = 0;

  const selectMock = vi.fn().mockImplementation(() => {
    const rows = allRows[callCount] ?? [];
    callCount++;
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    };
  });

  return selectMock;
}

function buildMockDb(opts: {
  sessionRows?: unknown[];
  draftOnSelect?: unknown[];    // rows for findCurrent (GET and promote paths)
  draftOnInsert?: unknown[];    // rows for upsert (POST /drafts path)
  specOnInsert?: unknown[];     // rows for create plan_spec (promote path)
  promoteOnly?: boolean;        // when true, skip upsert chain; first insert is planSpec.create
} = {}): Database {
  const sessionRows = opts.sessionRows ?? [
    {
      tokenHash: SESSION_HASH,
      userId: USER_A,
      tenantId: TENANT_A,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  ];

  const select = sessionSelectChain(
    sessionRows,
    opts.draftOnSelect ? [opts.draftOnSelect] : []
  );

  // Build insert mock dynamically based on which operations are expected.
  // promote path: only planSpec.create (no upsert)
  // upsert path: only draftRepo.upsert (no planSpec.create in the same call)
  const upsertReturning = vi.fn().mockResolvedValue(opts.draftOnInsert ?? [draftRow]);
  const upsertOnConflict = vi.fn().mockReturnValue({ returning: upsertReturning });
  const upsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: upsertOnConflict });

  const specReturning = vi.fn().mockResolvedValue(opts.specOnInsert ?? [planSpecRow]);
  const specValues = vi.fn().mockReturnValue({ returning: specReturning });

  let insertMock: ReturnType<typeof vi.fn>;
  if (opts.promoteOnly) {
    // Only planSpec.create is called
    insertMock = vi.fn().mockReturnValue({ values: specValues });
  } else {
    // Default: first insert is upsert, second is planSpec.create
    insertMock = vi
      .fn()
      .mockReturnValueOnce({ values: upsertValues })
      .mockReturnValueOnce({ values: specValues });
  }

  const deleteMock = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });

  return { select, insert: insertMock, delete: deleteMock } as unknown as Database;
}

// Build a test Fastify app with auth plugin + plan routes.
// The auth onRequest hook will look up the session; we mock the DB to return
// a valid session row for VALID_TOKEN.
async function buildTestApp(db: Database): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error.name === "AuthError") {
      return reply.code(401).send({ error: error.message });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  // authPlugin decorates request.authContext via onRequest hook
  await app.register(authPlugin, { db });
  await app.register(planRoutes, { db });

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
      // Empty session rows so the auth plugin finds no valid session
      app = await buildTestApp(buildMockDb({ sessionRows: [] }));

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        payload: { step: 1, spec: specPayload },
      });

      expect(response.statusCode).toBe(401);
    });

    it("upserts draft and returns {step, spec} when authenticated", async () => {
      app = await buildTestApp(buildMockDb({ draftOnInsert: [draftRow] }));

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

    it("second call for same user returns updated draft (single-active)", async () => {
      const updatedDraft = { ...draftRow, step: 4 };
      app = await buildTestApp(buildMockDb({ draftOnInsert: [updatedDraft] }));

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
      app = await buildTestApp(buildMockDb({ sessionRows: [] }));

      const response = await app.inject({
        method: "GET",
        url: "/plan-specs/drafts/current",
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 204 when no draft exists", async () => {
      // First select: session lookup; second select: no draft found
      app = await buildTestApp(buildMockDb({ draftOnSelect: [] }));

      const response = await app.inject({
        method: "GET",
        url: "/plan-specs/drafts/current",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(204);
    });

    it("returns {step, spec} when a draft exists", async () => {
      app = await buildTestApp(buildMockDb({ draftOnSelect: [draftRow] }));

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
      app = await buildTestApp(buildMockDb({ sessionRows: [] }));

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 409 when no draft exists", async () => {
      // No draft rows returned for findCurrent
      app = await buildTestApp(buildMockDb({ draftOnSelect: [] }));

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
    });

    it("returns 409 when draft has incomplete spec (missing required fields)", async () => {
      const incompleteDraft = {
        ...draftRow,
        specJson: { goal: "strength" }, // missing location, daysPerWeek, etc.
      };
      app = await buildTestApp(buildMockDb({ draftOnSelect: [incompleteDraft] }));

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
    });

    it("returns 201 {id, spec} when draft is complete and deletes the draft", async () => {
      const completeDraft = {
        ...draftRow,
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
      };
      const db = buildMockDb({
        draftOnSelect: [completeDraft],
        specOnInsert: [planSpecRow],
        promoteOnly: true,  // promote path: only planSpec.create insert is called
      });
      app = await buildTestApp(db);

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

    it("cross-tenant: user from tenant B cannot promote tenant A draft (no draft found = 409)", async () => {
      // Simulate tenant B session that finds no draft (tenant-scoped WHERE clause)
      const tenantBSession = [
        {
          tokenHash: SESSION_HASH,
          userId: USER_A, // same user but different tenant context
          tenantId: TENANT_B,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      ];
      // No draft rows for tenant B
      app = await buildTestApp(
        buildMockDb({ sessionRows: tenantBSession, draftOnSelect: [], promoteOnly: true })
      );

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
    });
  });
});
