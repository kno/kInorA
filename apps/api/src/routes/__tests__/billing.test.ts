import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { billingRoutes } from "../billing.js";
import {
  SetMemberAllocation,
  GetTenantUsage,
  type QuotaAdminPort,
  type AdminMembershipView,
} from "../../billing/quota-admin.js";
import { GetBillingVisibility, type BillingVisibilityPort } from "../../billing/billing-visibility.js";
import { CreateCheckout } from "../../billing/create-checkout.js";
import { CreatePortalSession } from "../../billing/create-portal-session.js";
import { ListInvoices } from "../../billing/list-invoices.js";
import type {
  CheckoutGateway,
  CreateCheckoutSessionInput,
  InvoiceGateway,
  PortalGateway,
  PromotionCodeValidation,
} from "../../billing/stripe-gateway.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
  buildSuspendedMembershipRow,
} from "../../test-support/auth-mocks.js";

// --- Fixtures ---------------------------------------------------------------

const OWNER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const MEMBER_ID = "cccccccc-0000-0000-0000-000000000002";
const TENANT_A = "bbbbbbbb-0000-0000-0000-000000000001";
const OTHER_TENANT_MEMBER = "dddddddd-0000-0000-0000-000000000003";
const PERIOD = "2026-07";

const OWNER_ACTIVE: AdminMembershipView = { role: "owner", status: "active" };
const MEMBER_ACTIVE: AdminMembershipView = { role: "member", status: "active" };
const MEMBER_SUSPENDED: AdminMembershipView = { role: "member", status: "suspended" };

const TENANT_USAGE = [
  { feature: "plan_generation", period: PERIOD, used: 3, limit: 1_000_000 },
  { feature: "memory_write", period: PERIOD, used: 12, limit: 1_000_000 },
] as const;

const MEMBER_USAGE = [
  { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, used: 2, limit: 5 },
  { userId: MEMBER_ID, feature: "memory_write", period: PERIOD, used: 4, limit: 10 },
] as const;

// --- Fake QuotaAdminPort ----------------------------------------------------
//
// The route wires the REAL use cases (SetMemberAllocation / GetTenantUsage)
// backed by this fake port, so authorization, plan-bounds validation, and the
// atomic allocation+audit call are exercised for real at the HTTP boundary. The
// port exposes ONLY count-returning reads — it has NO method that could surface
// a member's memories, prompts, health, or generated content (privacy boundary
// enforced by the port's type surface).

interface FakePortOptions {
  actor?: AdminMembershipView | null;
  subject?: AdminMembershipView | null;
  tenantTier?: "free" | "pro" | null;
  tenantSeatCount?: number | null;
}

function buildFakePort(opts: FakePortOptions = {}) {
  const port: QuotaAdminPort = {
    loadActorMembership: vi.fn(async () => opts.actor ?? OWNER_ACTIVE),
    loadSubjectMembership: vi.fn(async () =>
      opts.subject === undefined ? MEMBER_ACTIVE : opts.subject,
    ),
    loadTenantTier: vi.fn(async () =>
      opts.tenantTier === null
        ? null
        : { tier: opts.tenantTier ?? "pro", seatCount: opts.tenantSeatCount ?? null },
    ),
    writeMemberAllocation: vi.fn(async () => {}),
    readTenantUsage: vi.fn(async () => TENANT_USAGE.map((r) => ({ ...r }))),
    readMemberUsage: vi.fn(async () => MEMBER_USAGE.map((r) => ({ ...r }))),
  };
  return port;
}

// --- App builder ------------------------------------------------------------

function buildMockDb(membershipRow: unknown) {
  const session = buildSessionRow({
    tokenHash: "hash-of-token",
    tenantId: TENANT_A,
    userId: OWNER_ID,
  });
  return createAuthMockDb({
    sessionRows: [session],
    membershipRows: membershipRow ? [membershipRow] : [],
  }).db;
}

async function buildTestApp(
  port: QuotaAdminPort,
  authMembershipRow: unknown = buildActiveMembershipRow({
    tenantId: TENANT_A,
    userId: OWNER_ID,
    role: "owner",
  }),
  logger?: SpyLogger,
  createCheckout: CreateCheckout = buildUnusedCheckout(),
): Promise<FastifyInstance> {
  const db = buildMockDb(authMembershipRow) as never;

  const app = logger ? Fastify({ loggerInstance: logger as never }) : Fastify();
  app.setErrorHandler((error: unknown, _req, reply) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Boolean((error as { validation: unknown }).validation)
    ) {
      return reply.code(422).send({ error: "Validation Error" });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  await app.register(authPlugin, { db });
  await app.register(billingRoutes, {
    setMemberAllocation: new SetMemberAllocation(port),
    getTenantUsage: new GetTenantUsage(port),
    // Not exercised by this suite — GET /billing/visibility has its own suite
    // in billing-visibility.test.ts. Provided only to satisfy the shared
    // billingRoutes plugin's required options.
    getBillingVisibility: new GetBillingVisibility(buildUnusedVisibilityPort()),
    createCheckout,
    // Slice 4 portal/invoice use cases: unused by THIS suite (covered by
    // billing-portal.test.ts). Provided only to satisfy the shared plugin.
    createPortalSession: buildUnusedPortalSession(),
    listInvoices: buildUnusedListInvoices(),
    // Slice 4 4R FIX 1 owner-only check: reuses the SAME QuotaAdminPort fake
    // already passed in (it already has loadActorMembership) — no new fake.
    checkBillingOwnership: port,
  });

  return app;
}

function buildUnusedPortalSession(): CreatePortalSession {
  const gateway: PortalGateway = {
    createPortalSession: vi.fn(async () => ({ url: "https://billing.stripe.test/unused" })),
  };
  return new CreatePortalSession({ findStripeCustomerId: vi.fn(async () => null) }, gateway);
}

function buildUnusedListInvoices(): ListInvoices {
  const gateway: InvoiceGateway = { listInvoices: vi.fn(async () => []) };
  return new ListInvoices({ findStripeCustomerId: vi.fn(async () => null) }, gateway);
}

// --- Checkout fakes (11b Slice 3) -------------------------------------------

interface CheckoutFake {
  gateway: CheckoutGateway;
  createSpy: ReturnType<typeof vi.fn>;
  validateSpy: ReturnType<typeof vi.fn>;
  useCase: CreateCheckout;
}

const CHECKOUT_PRICING = { priceMonthly: "price_monthly_cfg", priceAnnual: "price_annual_cfg" };

function buildCheckout(
  validation: PromotionCodeValidation = { valid: true, promotionCodeId: "promo_ok" },
): CheckoutFake {
  const createSpy = vi.fn(
    async (input: CreateCheckoutSessionInput) => ({ url: `https://checkout.stripe.test/s?p=${input.priceId}` }),
  );
  const validateSpy = vi.fn(async (): Promise<PromotionCodeValidation> => validation);
  const gateway: CheckoutGateway = {
    createCheckoutSession: createSpy as CheckoutGateway["createCheckoutSession"],
    validatePromotionCode: validateSpy as CheckoutGateway["validatePromotionCode"],
  };
  return { gateway, createSpy, validateSpy, useCase: new CreateCheckout(gateway, CHECKOUT_PRICING) };
}

function buildUnusedCheckout(): CreateCheckout {
  return buildCheckout().useCase;
}

// A minimal pino-compatible spy logger. Fastify v5 accepts a pre-built logger
// via `loggerInstance`; `request.log` is a child of it. `child()` returns the
// same object so warn/error calls made on the per-request logger accumulate on
// one set of spies we can assert against.
type SpyLogger = {
  level: string;
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  silent: ReturnType<typeof vi.fn>;
  child: () => SpyLogger;
};

function createSpyLogger(): SpyLogger {
  const logger: SpyLogger = {
    level: "info",
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    child: () => logger,
  };
  return logger;
}

function buildUnusedVisibilityPort(): BillingVisibilityPort {
  return {
    loadContext: vi.fn(async () => ({
      membershipStatus: null,
      billing: null,
      activeOverrideTier: null,
      activeOverrideEndsAt: null,
    })),
    readTenantUsage: vi.fn(async () => []),
    readOwnMemberUsage: vi.fn(async () => []),
  };
}

const auth = { authorization: `Bearer ${VALID_TOKEN}` };

// ---------------------------------------------------------------------------
// Scenario: Member Quota Administration — Authorized trainer changes allocation
// ---------------------------------------------------------------------------

describe("PUT /billing/allocations — Member Quota Administration", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("owner (trainer) sets an active member's allocation within bounds → 200 and writes it", async () => {
    const port = buildFakePort({ actor: OWNER_ACTIVE, subject: MEMBER_ACTIVE, tenantTier: "pro" });
    app = await buildTestApp(port);

    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, limit: 5 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { allocation: { userId: string; feature: string; period: string; limit: number } };
    expect(body.allocation).toEqual({
      userId: MEMBER_ID,
      feature: "plan_generation",
      period: PERIOD,
      limit: 5,
    });
    expect(port.writeMemberAllocation).toHaveBeenCalledTimes(1);
  });

  it("passes the acting owner as the auditor to the atomic write (audit record)", async () => {
    const port = buildFakePort({ actor: OWNER_ACTIVE, subject: MEMBER_ACTIVE, tenantTier: "pro" });
    app = await buildTestApp(port);

    await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: MEMBER_ID, feature: "memory_write", period: PERIOD, limit: 8 },
    });

    // The atomic port write bundles the member_allocation_set audit row; the
    // acting owner MUST be recorded as the audit actor and the target member as
    // the subject — both scoped to the actor's authContext tenant only.
    expect(port.writeMemberAllocation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_A,
        actorUserId: OWNER_ID,
        subjectUserId: MEMBER_ID,
        feature: "memory_write",
        period: PERIOD,
        limit: 8,
      }),
    );
  });

  it("rejects a non-owner member editing an allocation → 403 unauthorized_quota_admin, no write", async () => {
    const port = buildFakePort({ actor: MEMBER_ACTIVE, subject: MEMBER_ACTIVE });
    // Auth resolves (active member), but the use case denies on role.
    app = await buildTestApp(
      port,
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: OWNER_ID, role: "member" }),
    );

    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, limit: 5 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "unauthorized_quota_admin" });
    expect(port.writeMemberAllocation).not.toHaveBeenCalled();
  });

  it("rejects a request with no session → 401 (fail closed)", async () => {
    const port = buildFakePort();
    const app0 = Fastify();
    await app0.register(authPlugin, {
      db: createAuthMockDb({ sessionRows: [] }).db as never,
    });
    await app0.register(billingRoutes, {
      setMemberAllocation: new SetMemberAllocation(port),
      getTenantUsage: new GetTenantUsage(port),
      getBillingVisibility: new GetBillingVisibility(buildUnusedVisibilityPort()),
      createCheckout: buildUnusedCheckout(),
      createPortalSession: buildUnusedPortalSession(),
      listInvoices: buildUnusedListInvoices(),
      checkBillingOwnership: port,
    });
    app = app0;

    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      payload: { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, limit: 5 },
    });

    expect(res.statusCode).toBe(401);
    expect(port.writeMemberAllocation).not.toHaveBeenCalled();
  });

  it("rejects an allocation above the tenant plan cap → 422 allocation_out_of_bounds", async () => {
    const port = buildFakePort({ actor: OWNER_ACTIVE, subject: MEMBER_ACTIVE, tenantTier: "free" });
    app = await buildTestApp(port);

    // Free plan_generation cap is 1; asking for 5 is out of bounds.
    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, limit: 5 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "allocation_out_of_bounds" });
    expect(port.writeMemberAllocation).not.toHaveBeenCalled();
  });

  it("rejects a malformed body → 422 invalid_allocation_request", async () => {
    const port = buildFakePort();
    app = await buildTestApp(port);

    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: MEMBER_ID, feature: "not_a_feature", period: PERIOD, limit: -1 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_allocation_request" });
    expect(port.writeMemberAllocation).not.toHaveBeenCalled();
  });

  it.each(["2026-13", "2026-00"])(
    "rejects an impossible month in the period (%s) → 422 at the route, never writing (#173)",
    async (badPeriod) => {
      const port = buildFakePort({ actor: OWNER_ACTIVE, subject: MEMBER_ACTIVE, tenantTier: "pro" });
      app = await buildTestApp(port);

      const res = await app.inject({
        method: "PUT",
        url: "/billing/allocations",
        headers: auth,
        payload: { userId: MEMBER_ID, feature: "plan_generation", period: badPeriod, limit: 1 },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: "invalid_allocation_request" });
      expect(port.writeMemberAllocation).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// Scenario: Period bounds are enforced at the use-case layer too (#173)
// ---------------------------------------------------------------------------

describe("SetMemberAllocation — period bounds (use case)", () => {
  it.each(["2026-13", "2026-00"])(
    "rejects an impossible month (%s) → allocation_out_of_bounds, never writing",
    async (badPeriod) => {
      const port = buildFakePort({ actor: OWNER_ACTIVE, subject: MEMBER_ACTIVE, tenantTier: "pro" });
      const useCase = new SetMemberAllocation(port);

      const result = await useCase.execute({
        tenantId: TENANT_A,
        actorUserId: OWNER_ID,
        subjectUserId: MEMBER_ID,
        feature: "plan_generation",
        period: badPeriod,
        limit: 1,
      });

      expect(result).toEqual({ ok: false, reason: "allocation_out_of_bounds" });
      expect(port.writeMemberAllocation).not.toHaveBeenCalled();
    },
  );

  it("still accepts a valid YYYY-MM period", async () => {
    const port = buildFakePort({ actor: OWNER_ACTIVE, subject: MEMBER_ACTIVE, tenantTier: "pro" });
    const useCase = new SetMemberAllocation(port);

    const result = await useCase.execute({
      tenantId: TENANT_A,
      actorUserId: OWNER_ID,
      subjectUserId: MEMBER_ID,
      feature: "plan_generation",
      period: "2026-12",
      limit: 1,
    });

    expect(result).toMatchObject({ ok: true });
    expect(port.writeMemberAllocation).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario: Quota Privacy Boundary — aggregate/member counts only, no content
// ---------------------------------------------------------------------------

describe("GET /billing/usage — Quota Privacy Boundary", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("owner sees tenant aggregate + per-member usage as COUNTS only", async () => {
    const port = buildFakePort({ actor: OWNER_ACTIVE });
    app = await buildTestApp(port);

    const res = await app.inject({
      method: "GET",
      url: `/billing/usage?period=${PERIOD}`,
      headers: auth,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tenantUsage: Array<Record<string, unknown>>;
      memberUsage: Array<Record<string, unknown>>;
    };

    // Response shape is exactly the count DTOs — no content fields.
    expect(body.tenantUsage[0]).toEqual({
      feature: "plan_generation",
      period: PERIOD,
      used: 3,
      limit: 1_000_000,
    });
    expect(Object.keys(body.memberUsage[0]).sort()).toEqual(
      ["feature", "limit", "period", "used", "userId"].sort(),
    );

    // No private-content KEY may EVER appear on any row. (We check keys, not a
    // raw substring of values: `memory_write` is a legitimate feature enum value,
    // not private content — the boundary is about content fields, not the word.)
    const forbiddenKeys = [
      "factText",
      "text",
      "prompt",
      "prompts",
      "health",
      "content",
      "program",
      "programJson",
      "embedding",
      "vector",
      "memoryText",
    ];
    const allowedTenantKeys = ["feature", "period", "used", "limit"];
    const allowedMemberKeys = ["userId", "feature", "period", "used", "limit"];
    for (const row of body.tenantUsage) {
      expect(Object.keys(row).sort()).toEqual([...allowedTenantKeys].sort());
      for (const key of forbiddenKeys) expect(row).not.toHaveProperty(key);
    }
    for (const row of body.memberUsage) {
      expect(Object.keys(row).sort()).toEqual([...allowedMemberKeys].sort());
      for (const key of forbiddenKeys) expect(row).not.toHaveProperty(key);
    }
  });

  it("denies a non-owner member from reading tenant usage → 403", async () => {
    const port = buildFakePort({ actor: MEMBER_ACTIVE });
    app = await buildTestApp(
      port,
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: OWNER_ID, role: "member" }),
    );

    const res = await app.inject({
      method: "GET",
      url: `/billing/usage?period=${PERIOD}`,
      headers: auth,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "unauthorized_quota_admin" });
    expect(port.readMemberUsage).not.toHaveBeenCalled();
  });

  it("only ever asks the port for count reads — never for member content", () => {
    const port = buildFakePort();
    // The port's type surface is the contract: it exposes only count reads.
    const methodNames = Object.keys(port);
    expect(methodNames.sort()).toEqual(
      [
        "loadActorMembership",
        "loadSubjectMembership",
        "loadTenantTier",
        "readMemberUsage",
        "readTenantUsage",
        "writeMemberAllocation",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario: Membership suspension blocks consumption / management
// ---------------------------------------------------------------------------

describe("Membership suspension blocks management", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("a suspended actor never reaches the route (auth re-check) → 401", async () => {
    const port = buildFakePort();
    app = await buildTestApp(
      port,
      buildSuspendedMembershipRow({ tenantId: TENANT_A, userId: OWNER_ID, role: "owner" }),
    );

    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, limit: 1 },
    });

    expect(res.statusCode).toBe(401);
    expect(port.writeMemberAllocation).not.toHaveBeenCalled();
  });

  it("the use case fails closed for a suspended actor (defense in depth)", async () => {
    const port = buildFakePort({ actor: MEMBER_SUSPENDED });
    const useCase = new SetMemberAllocation(port);

    const result = await useCase.execute({
      tenantId: TENANT_A,
      actorUserId: OWNER_ID,
      subjectUserId: MEMBER_ID,
      feature: "plan_generation",
      period: PERIOD,
      limit: 1,
    });

    expect(result).toEqual({ ok: false, reason: "unauthorized_quota_admin" });
    expect(port.writeMemberAllocation).not.toHaveBeenCalled();
  });

  it("an owner MAY still set a suspended member's allocation (management follows policy) but it grants no consumption", async () => {
    // Setting the allocation does not resurrect a suspended member's ability to
    // consume — that is enforced separately by CheckEntitlement (inactive_membership).
    const port = buildFakePort({
      actor: OWNER_ACTIVE,
      subject: { role: "member", status: "suspended" },
      tenantTier: "pro",
    });
    const useCase = new SetMemberAllocation(port);

    const result = await useCase.execute({
      tenantId: TENANT_A,
      actorUserId: OWNER_ID,
      subjectUserId: MEMBER_ID,
      feature: "plan_generation",
      period: PERIOD,
      limit: 3,
    });

    expect(result).toEqual({
      ok: true,
      allocation: { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, limit: 3 },
    });
    expect(port.writeMemberAllocation).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario: Cross-tenant billing denied
// ---------------------------------------------------------------------------

describe("Cross-tenant billing denied", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("tenant scope always comes from authContext — a body tenantId is ignored", async () => {
    const port = buildFakePort({ actor: OWNER_ACTIVE, subject: MEMBER_ACTIVE, tenantTier: "pro" });
    app = await buildTestApp(port);

    await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      // Attempt to smuggle a foreign tenant id in the body — it must be ignored.
      payload: {
        userId: MEMBER_ID,
        feature: "plan_generation",
        period: PERIOD,
        limit: 3,
        tenantId: "ffffffff-0000-0000-0000-000000000009",
      },
    });

    // The write is scoped to the session tenant (TENANT_A), never the body value.
    expect(port.writeMemberAllocation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
    );
  });

  it("denies setting an allocation for a user who is NOT a member of the actor's tenant → 403", async () => {
    // The subject has no membership in the actor's tenant (loadSubjectMembership
    // returns null): this is the cross-tenant case — deny, emit no other-tenant data.
    const port = buildFakePort({ actor: OWNER_ACTIVE, subject: null, tenantTier: "pro" });
    app = await buildTestApp(port);

    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: OTHER_TENANT_MEMBER, feature: "plan_generation", period: PERIOD, limit: 3 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "unauthorized_quota_admin" });
    expect(port.writeMemberAllocation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Scenario: Denied quota-admin attempts are observable (#175)
//
// Only SUCCESSFUL quota-admin mutations write a billing_audit_events row. A
// denied attempt (unauthorized non-owner, cross-tenant subject probe,
// out-of-bounds allocation) must ALSO be observable — but via a structured
// server-side log (the request logger), NOT a new audit DB row: writing a row
// per denied probe is DoS-able (an attacker could spam denials to bloat the
// table). The log carries actor + attempted subject + reason and never any
// secret. The correct 403/422 is still returned and the success-path audit is
// unchanged.
// ---------------------------------------------------------------------------

describe("Denied quota-admin attempts are observable (#175)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  const DENIAL_EVENT = "billing.quota_admin.denied";

  it("logs a structured denial (actor + subject + reason) for a non-owner allocation attempt, still 403", async () => {
    const log = createSpyLogger();
    const port = buildFakePort({ actor: MEMBER_ACTIVE, subject: MEMBER_ACTIVE });
    app = await buildTestApp(
      port,
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: OWNER_ID, role: "member" }),
      log,
    );

    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, limit: 5 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "unauthorized_quota_admin" });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: DENIAL_EVENT,
        route: "PUT /billing/allocations",
        tenantId: TENANT_A,
        actorUserId: OWNER_ID,
        subjectUserId: MEMBER_ID,
        reason: "unauthorized_quota_admin",
      }),
      expect.any(String),
    );
  });

  it("logs a structured denial for a cross-tenant subject probe, still 403", async () => {
    const log = createSpyLogger();
    const port = buildFakePort({ actor: OWNER_ACTIVE, subject: null, tenantTier: "pro" });
    app = await buildTestApp(port, undefined, log);

    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: OTHER_TENANT_MEMBER, feature: "plan_generation", period: PERIOD, limit: 3 },
    });

    expect(res.statusCode).toBe(403);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: DENIAL_EVENT,
        actorUserId: OWNER_ID,
        subjectUserId: OTHER_TENANT_MEMBER,
        reason: "unauthorized_quota_admin",
      }),
      expect.any(String),
    );
  });

  it("logs a structured denial for an out-of-bounds allocation, still 422", async () => {
    const log = createSpyLogger();
    const port = buildFakePort({ actor: OWNER_ACTIVE, subject: MEMBER_ACTIVE, tenantTier: "free" });
    app = await buildTestApp(port, undefined, log);

    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, limit: 5 },
    });

    expect(res.statusCode).toBe(422);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: DENIAL_EVENT,
        reason: "allocation_out_of_bounds",
        subjectUserId: MEMBER_ID,
      }),
      expect.any(String),
    );
  });

  it("logs a structured denial for a non-owner usage read, still 403", async () => {
    const log = createSpyLogger();
    const port = buildFakePort({ actor: MEMBER_ACTIVE });
    app = await buildTestApp(
      port,
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: OWNER_ID, role: "member" }),
      log,
    );

    const res = await app.inject({
      method: "GET",
      url: `/billing/usage?period=${PERIOD}`,
      headers: auth,
    });

    expect(res.statusCode).toBe(403);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: DENIAL_EVENT,
        route: "GET /billing/usage",
        actorUserId: OWNER_ID,
        reason: "unauthorized_quota_admin",
      }),
      expect.any(String),
    );
  });

  it("does NOT log a denial on the success path (200)", async () => {
    const log = createSpyLogger();
    const port = buildFakePort({ actor: OWNER_ACTIVE, subject: MEMBER_ACTIVE, tenantTier: "pro" });
    app = await buildTestApp(port, undefined, log);

    const res = await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, limit: 5 },
    });

    expect(res.statusCode).toBe(200);
    const denialCalls = log.warn.mock.calls.filter(
      ([obj]) => (obj as { event?: string })?.event === DENIAL_EVENT,
    );
    expect(denialCalls).toHaveLength(0);
  });

  it("never puts the session token into the denial log payload", async () => {
    const log = createSpyLogger();
    const port = buildFakePort({ actor: MEMBER_ACTIVE, subject: MEMBER_ACTIVE });
    app = await buildTestApp(
      port,
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: OWNER_ID, role: "member" }),
      log,
    );

    await app.inject({
      method: "PUT",
      url: "/billing/allocations",
      headers: auth,
      payload: { userId: MEMBER_ID, feature: "plan_generation", period: PERIOD, limit: 5 },
    });

    const denialCalls = log.warn.mock.calls.filter(
      ([obj]) => (obj as { event?: string })?.event === DENIAL_EVENT,
    );
    expect(denialCalls.length).toBeGreaterThan(0);
    // The structured denial payload carries only ids + reason, never a secret.
    const serialized = JSON.stringify(denialCalls);
    expect(serialized).not.toContain(VALID_TOKEN);
    expect(serialized.toLowerCase()).not.toContain("authorization");
  });
});

// ---------------------------------------------------------------------------
// Scenario: POST /billing/checkout — Stripe checkout (11b Slice 3, TRIANGLE)
//
// Payments hot path. The tenant is resolved ONLY from authContext and stamped
// as the Stripe client_reference_id / subscription metadata (a spoofed tenant
// in the body is ignored); the config-driven Price is selected by cycle; an
// invalid coupon is rejected server-side (422, no session); no secret/price/
// coupon is ever written to the logs; and NO live Stripe key is needed (the
// gateway is a FakeStripeGateway).
// ---------------------------------------------------------------------------

describe("POST /billing/checkout — Stripe checkout (11b Slice 3)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("opens a monthly checkout with the config Price and returns the hosted URL", async () => {
    const checkout = buildCheckout();
    app = await buildTestApp(buildFakePort(), undefined, undefined, checkout.useCase);

    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      headers: auth,
      payload: { cycle: "monthly" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: "https://checkout.stripe.test/s?p=price_monthly_cfg" });
    expect(checkout.createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cycle: "monthly", priceId: "price_monthly_cfg" }),
    );
  });

  it("selects the ANNUAL config Price for an annual checkout", async () => {
    const checkout = buildCheckout();
    app = await buildTestApp(buildFakePort(), undefined, undefined, checkout.useCase);

    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      headers: auth,
      payload: { cycle: "annual" },
    });

    expect(res.statusCode).toBe(200);
    expect(checkout.createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cycle: "annual", priceId: "price_annual_cfg" }),
    );
  });

  it("IGNORES a spoofed tenantId in the body — the checkout tenant comes only from authContext (cross-tenant prevented)", async () => {
    const checkout = buildCheckout();
    app = await buildTestApp(buildFakePort(), undefined, undefined, checkout.useCase);

    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      headers: auth,
      // Attempt to bill/upgrade a foreign tenant — must be ignored.
      payload: { cycle: "monthly", tenantId: "ffffffff-0000-0000-0000-000000000009" },
    });

    expect(res.statusCode).toBe(200);
    // The session is stamped with the SESSION tenant (TENANT_A), never the body value.
    expect(checkout.createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
    );
    const passed = checkout.createSpy.mock.calls[0]![0] as CreateCheckoutSessionInput;
    expect(passed.tenantId).not.toBe("ffffffff-0000-0000-0000-000000000009");
  });

  it("rejects an unauthenticated checkout attempt → 401, no session created", async () => {
    const checkout = buildCheckout();
    app = await buildTestApp(buildFakePort(), undefined, undefined, checkout.useCase);

    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: { cycle: "monthly" },
    });

    expect(res.statusCode).toBe(401);
    expect(checkout.createSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid billing cycle → 422, no session created", async () => {
    const checkout = buildCheckout();
    app = await buildTestApp(buildFakePort(), undefined, undefined, checkout.useCase);

    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      headers: auth,
      payload: { cycle: "weekly" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_billing_cycle" });
    expect(checkout.createSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid coupon server-side → 422 invalid_promotion_code, NO session created", async () => {
    const checkout = buildCheckout({ valid: false, promotionCodeId: null });
    app = await buildTestApp(buildFakePort(), undefined, undefined, checkout.useCase);

    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      headers: auth,
      payload: { cycle: "monthly", promotionCode: "BOGUS" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_promotion_code" });
    expect(checkout.validateSpy).toHaveBeenCalledWith("BOGUS");
    expect(checkout.createSpy).not.toHaveBeenCalled();
  });

  it("our checkout code emits NO application log line carrying the coupon code or session token (secret hygiene)", async () => {
    const log = createSpyLogger();
    const checkout = buildCheckout();
    app = await buildTestApp(buildFakePort(), undefined, log, checkout.useCase);

    await app.inject({
      method: "POST",
      url: "/billing/checkout",
      headers: auth,
      payload: { cycle: "annual", promotionCode: "SECRET-COUPON-XYZ" },
    });

    // Exclude Fastify's framework-level automatic request/response logging (its
    // "incoming request"/"request completed" lines carry the raw req object,
    // including the body — a framework/pino-redaction concern, not this route's).
    // Assert that OUR code adds no application log line leaking the coupon or
    // the session token: the checkout path deliberately logs nothing itself.
    const appLogCalls = [
      ...log.warn.mock.calls,
      ...log.info.mock.calls,
      ...log.error.mock.calls,
      ...log.debug.mock.calls,
    ].filter(([first]) => {
      const obj = first as Record<string, unknown> | undefined;
      return !obj || (!("req" in obj) && !("res" in obj));
    });

    const serialized = JSON.stringify(appLogCalls);
    expect(serialized).not.toContain("SECRET-COUPON-XYZ");
    expect(serialized).not.toContain(VALID_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// Scenario: GET /billing/pricing sources the displayed amounts from Stripe (#195)
//
// The route delegates to the injected `getBillingPricing` use case (which
// sources amounts from the real Stripe Price objects), NOT the env-only
// `buildBillingPricing`. Here we inject a stub returning a distinctive DTO and
// prove the endpoint returns exactly it — so a display/charge drift is
// impossible: what the endpoint shows is what the source (Stripe) reports.
// ---------------------------------------------------------------------------

describe("GET /billing/pricing — sourced from Stripe (#195)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  // A distinctive DTO that is NOT the env/config default (999/799/20), so a pass
  // proves the value came from the injected source and not the pure fallback.
  const SOURCED_PRICING = {
    currency: "eur",
    monthly: { cycle: "monthly" as const, amountPerMonth: 1299, amountPerInterval: 1299 },
    annual: { cycle: "annual" as const, amountPerMonth: 799, amountPerInterval: 9588 },
    annualSavePercent: 38,
  };

  async function buildPricingApp(getBillingPricing: {
    execute: ReturnType<typeof vi.fn>;
  }): Promise<FastifyInstance> {
    const port = buildFakePort();
    const db = buildMockDb(
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: OWNER_ID, role: "owner" }),
    ) as never;
    const instance = Fastify();
    await instance.register(authPlugin, { db });
    await instance.register(billingRoutes, {
      setMemberAllocation: new SetMemberAllocation(port),
      getTenantUsage: new GetTenantUsage(port),
      getBillingVisibility: new GetBillingVisibility(buildUnusedVisibilityPort()),
      createCheckout: buildUnusedCheckout(),
      createPortalSession: buildUnusedPortalSession(),
      listInvoices: buildUnusedListInvoices(),
      checkBillingOwnership: port,
      getBillingPricing,
    });
    return instance;
  }

  it("returns the amounts from the injected (Stripe-sourced) pricing use case", async () => {
    const execute = vi.fn(async () => SOURCED_PRICING);
    app = await buildPricingApp({ execute });

    const res = await app.inject({ method: "GET", url: "/billing/pricing", headers: auth });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(SOURCED_PRICING);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("requires authentication → 401, never invoking the pricing source", async () => {
    const execute = vi.fn(async () => SOURCED_PRICING);
    app = await buildPricingApp({ execute });

    const res = await app.inject({ method: "GET", url: "/billing/pricing" });

    expect(res.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
});
