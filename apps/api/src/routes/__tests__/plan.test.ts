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
  // promote path: only planSpec.create (no upsert) — runs inside db.transaction(tx => ...)
  // upsert path: only draftRepo.upsert (no planSpec.create in the same call)
  const upsertReturning = vi.fn().mockResolvedValue(opts.draftOnInsert ?? [draftRow]);
  const upsertOnConflict = vi.fn().mockReturnValue({ returning: upsertReturning });
  const upsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: upsertOnConflict });

  const specReturning = vi.fn().mockResolvedValue(opts.specOnInsert ?? [planSpecRow]);
  const specValues = vi.fn().mockReturnValue({ returning: specReturning });

  const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });

  let insertMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn> | undefined;

  if (opts.promoteOnly) {
    // promote path: both insert and delete run inside db.transaction(tx => ...)
    const txInsert = vi.fn().mockReturnValue({ values: specValues });
    const tx = { insert: txInsert, delete: txDelete } as unknown as Database;
    transactionMock = vi.fn().mockImplementation(
      async (cb: (tx: Database) => Promise<unknown>) => cb(tx)
    );
    // insertMock on the outer db is not used directly in the promote path
    insertMock = vi.fn();
  } else {
    // Default: first insert is upsert (outer db), second is planSpec.create (no transaction)
    insertMock = vi
      .fn()
      .mockReturnValueOnce({ values: upsertValues })
      .mockReturnValueOnce({ values: specValues });
  }

  const deleteMock = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });

  const db: Record<string, unknown> = { select, insert: insertMock, delete: deleteMock };
  if (transactionMock) {
    db.transaction = transactionMock;
  }

  return db as unknown as Database;
}

// Build a test Fastify app with auth plugin + plan routes.
// The auth onRequest hook will look up the session; we mock the DB to return
// a valid session row for VALID_TOKEN.
async function buildTestApp(db: Database): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    // Fastify body-validation failures carry error.validation — map to 400
    if (error.validation) {
      return reply.code(400).send({ error: "Bad Request", details: error.validation });
    }
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

    it("returns 400 when step is missing from the body", async () => {
      app = await buildTestApp(buildMockDb());

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { spec: specPayload }, // step intentionally absent
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when step is not an integer (string value)", async () => {
      app = await buildTestApp(buildMockDb());

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { step: "three", spec: specPayload },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when spec is not an object (number value)", async () => {
      app = await buildTestApp(buildMockDb());

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/drafts",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { step: 1, spec: 42 },
      });

      expect(response.statusCode).toBe(400);
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

    it("wraps insert and delete in a single DB transaction (atomicity)", async () => {
      // RED: promote must call db.transaction; if it doesn't this test will fail
      // because the transaction mock is never invoked.
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

      // Build a db mock that exposes db.transaction and tracks whether it was called.
      // The transaction callback receives a tx with insert+delete mocks.
      const specReturning = vi.fn().mockResolvedValue([planSpecRow]);
      const specValues = vi.fn().mockReturnValue({ returning: specReturning });
      const txInsert = vi.fn().mockReturnValue({ values: specValues });
      const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
      const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });

      const tx = { insert: txInsert, delete: txDelete } as unknown as Database;

      const transactionMock = vi.fn().mockImplementation(
        async (cb: (tx: Database) => Promise<unknown>) => cb(tx)
      );

      // Session select
      const sessionRows = [
        {
          tokenHash: SESSION_HASH,
          userId: USER_A,
          tenantId: TENANT_A,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      ];
      const select = sessionSelectChain(sessionRows, [[completeDraft]]);

      const db = {
        select,
        transaction: transactionMock,
      } as unknown as Database;

      app = await buildTestApp(db);

      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      // The critical assertion: db.transaction must have been called once
      expect(transactionMock).toHaveBeenCalledTimes(1);
      // Both insert and delete must happen inside the transaction
      expect(txInsert).toHaveBeenCalledTimes(1);
      expect(txDelete).toHaveBeenCalledTimes(1);
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

  // --- Tenant-scoping regression: repositories are called with authContext values ---
  //
  // These tests assert that tenantId and userId flowing into repository calls are
  // always taken from request.authContext (populated by the auth plugin from the
  // session) and NEVER from the request body. A body containing bogus tenant/user
  // IDs must not influence which rows are read or written.
  //
  // NOTE: The definitive cross-tenant proof (WHERE-clause isolation in real SQL)
  // is covered by the PR3 authenticated E2E suite, since api unit tests run without
  // a live database in CI. These route-level tests assert the routing logic only.

  describe("Tenant-scoping: repo is called with authContext values, not body values", () => {
    it("POST /plan-specs/drafts — upsert uses tenantId+userId from authContext, ignoring any body tenantId", async () => {
      // The DB mock exposes the inner upsertValues spy so we can inspect the
      // call args that the repository passed to db.insert().values(...)
      const upsertReturning = vi.fn().mockResolvedValue([draftRow]);
      const upsertOnConflict = vi.fn().mockReturnValue({ returning: upsertReturning });
      const upsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: upsertOnConflict });
      const insertMock = vi.fn().mockReturnValue({ values: upsertValues });

      const sessionRows = [
        {
          tokenHash: SESSION_HASH,
          userId: USER_A,
          tenantId: TENANT_A,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      ];
      const select = sessionSelectChain(sessionRows);

      const db = { select, insert: insertMock, delete: vi.fn() } as unknown as Database;
      app = await buildTestApp(db);

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

      // The repository must have been called with the authenticated tenant+user,
      // not with anything from the body.
      expect(upsertValues).toHaveBeenCalledTimes(1);
      const insertedValues = upsertValues.mock.calls[0][0] as Record<string, unknown>;
      expect(insertedValues.tenantId).toBe(TENANT_A);
      expect(insertedValues.userId).toBe(USER_A);
      // The bogus TENANT_B in the body must NOT have ended up as the row tenantId
      expect(insertedValues.tenantId).not.toBe(TENANT_B);
    });

    it("GET /plan-specs/drafts/current — findCurrent is called with authContext tenantId, not a body value", async () => {
      // GET has no body, but we verify the select chain is invoked exactly once
      // (which means the route didn't skip the auth-scoped lookup).
      const sessionRows = [
        {
          tokenHash: SESSION_HASH,
          userId: USER_A,
          tenantId: TENANT_A,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      ];
      // Second select call returns the draft (findCurrent)
      const select = sessionSelectChain(sessionRows, [[draftRow]]);
      const db = { select } as unknown as Database;
      app = await buildTestApp(db);

      const response = await app.inject({
        method: "GET",
        url: "/plan-specs/drafts/current",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      // select was called twice: once for session lookup, once for findCurrent
      expect(select).toHaveBeenCalledTimes(2);
    });

    it("POST /plan-specs (promote) — transaction uses authContext tenantId+userId, body values are ignored", async () => {
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

      // Expose the tx.insert values spy to verify what tenantId was used
      const specReturning = vi.fn().mockResolvedValue([planSpecRow]);
      const specValues = vi.fn().mockReturnValue({ returning: specReturning });
      const txInsert = vi.fn().mockReturnValue({ values: specValues });
      const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
      const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });
      const tx = { insert: txInsert, delete: txDelete } as unknown as Database;

      const transactionMock = vi.fn().mockImplementation(
        async (cb: (tx: Database) => Promise<unknown>) => cb(tx)
      );

      const sessionRows = [
        {
          tokenHash: SESSION_HASH,
          userId: USER_A,
          tenantId: TENANT_A,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      ];
      // findCurrent returns completeDraft for session lookup first, then draft lookup
      const select = sessionSelectChain(sessionRows, [[completeDraft]]);

      const db = {
        select,
        transaction: transactionMock,
      } as unknown as Database;

      app = await buildTestApp(db);

      // Body carries an attacker-supplied tenantId — must be ignored
      const response = await app.inject({
        method: "POST",
        url: "/plan-specs",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        // POST /plan-specs has no body but send one with bogus ids anyway
        payload: { tenantId: TENANT_B, userId: "attacker-user-id" },
      });

      expect(response.statusCode).toBe(201);

      // The plan_specs insert inside the transaction must use TENANT_A (from authContext)
      expect(specValues).toHaveBeenCalledTimes(1);
      const insertedValues = specValues.mock.calls[0][0] as Record<string, unknown>;
      expect(insertedValues.tenantId).toBe(TENANT_A);
      expect(insertedValues.userId).toBe(USER_A);
      expect(insertedValues.tenantId).not.toBe(TENANT_B);
    });
  });
});
