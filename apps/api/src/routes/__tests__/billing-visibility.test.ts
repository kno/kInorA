import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { billingRoutes } from "../billing.js";
import { SetMemberAllocation, GetTenantUsage, type QuotaAdminPort } from "../../billing/quota-admin.js";
import {
  GetBillingVisibility,
  type BillingVisibilityContext,
  type BillingVisibilityPort,
} from "../../billing/billing-visibility.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
  buildSuspendedMembershipRow,
} from "../../test-support/auth-mocks.js";

// ---------------------------------------------------------------------------
// Scenario: Billing State Visibility — member-facing GET /billing/visibility
// ---------------------------------------------------------------------------
//
// Unlike GET /billing/usage (Slice 3, owner-only, aggregate/per-member counts
// for administration), this endpoint is available to ANY active member of the
// tenant and returns ONLY: the tenant billing state (tier/status/trial/
// override/upgrade prompt), tenant aggregate usage, and the REQUESTING
// member's OWN usage — never another member's individual usage.

const TENANT_A = "bbbbbbbb-0000-0000-0000-000000000001";
const MEMBER_A = "cccccccc-0000-0000-0000-000000000002";
const MEMBER_B = "eeeeeeee-0000-0000-0000-000000000004";
const PERIOD = "2026-07";

const TENANT_USAGE = [{ feature: "plan_generation", period: PERIOD, used: 3, limit: 1_000_000 }] as const;

const FREE_ACTIVE_CONTEXT: BillingVisibilityContext = {
  membershipStatus: "active",
  billing: {
    tier: "free",
    status: "active",
    source: "backfill",
    trialStartedAt: null,
    trialEndsAt: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  activeOverrideTier: null,
  activeOverrideEndsAt: null,
};

const TRIALING_CONTEXT: BillingVisibilityContext = {
  membershipStatus: "active",
  billing: {
    tier: "pro",
    status: "trialing",
    source: "system",
    trialStartedAt: new Date("2026-06-28T00:00:00.000Z"),
    trialEndsAt: new Date("2026-07-28T00:00:00.000Z"),
    updatedAt: new Date("2026-06-28T00:00:00.000Z"),
  },
  activeOverrideTier: null,
  activeOverrideEndsAt: null,
};

interface FakePortOptions {
  context?: BillingVisibilityContext;
  usageByUser?: Record<string, Array<{ feature: string; period: string; used: number; limit: number }>>;
}

function buildFakePort(opts: FakePortOptions = {}) {
  const port: BillingVisibilityPort = {
    loadContext: vi.fn(async () => opts.context ?? FREE_ACTIVE_CONTEXT),
    readTenantUsage: vi.fn(async () => TENANT_USAGE.map((r) => ({ ...r }))),
    readOwnMemberUsage: vi.fn(async (_tenantId: string, userId: string) => {
      const rows = opts.usageByUser?.[userId] ?? [];
      return rows.map((r) => ({ ...r, userId }));
    }),
  };
  return port;
}

// Unused-but-required options for the shared billingRoutes plugin (only the
// visibility endpoint is under test here — Slice 3's endpoints have their own
// suite in billing.test.ts).
function buildUnusedAdminPort(): QuotaAdminPort {
  return {
    loadActorMembership: vi.fn(async () => null),
    loadSubjectMembership: vi.fn(async () => null),
    loadTenantTier: vi.fn(async () => null),
    writeMemberAllocation: vi.fn(async () => {}),
    readTenantUsage: vi.fn(async () => []),
    readMemberUsage: vi.fn(async () => []),
  };
}

function buildMockDb(membershipRow: unknown, userId: string) {
  const session = buildSessionRow({ tokenHash: "hash-of-token", tenantId: TENANT_A, userId });
  return createAuthMockDb({
    sessionRows: [session],
    membershipRows: membershipRow ? [membershipRow] : [],
  }).db;
}

async function buildTestApp(
  visibilityPort: BillingVisibilityPort,
  authMembershipRow: unknown,
  userId: string,
): Promise<FastifyInstance> {
  const db = buildMockDb(authMembershipRow, userId) as never;
  const adminPort = buildUnusedAdminPort();

  const app = Fastify();
  await app.register(authPlugin, { db });
  await app.register(billingRoutes, {
    setMemberAllocation: new SetMemberAllocation(adminPort),
    getTenantUsage: new GetTenantUsage(adminPort),
    getBillingVisibility: new GetBillingVisibility(visibilityPort),
  });

  return app;
}

const auth = { authorization: `Bearer ${VALID_TOKEN}` };

describe("GET /billing/visibility — Billing State Visibility", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("an active member sees their tier/trial/own usage (200)", async () => {
    const port = buildFakePort({
      context: FREE_ACTIVE_CONTEXT,
      usageByUser: { [MEMBER_A]: [{ feature: "plan_generation", period: PERIOD, used: 1, limit: 1 }] },
    });
    app = await buildTestApp(
      port,
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: MEMBER_A, role: "member" }),
      MEMBER_A,
    );

    const res = await app.inject({
      method: "GET",
      url: `/billing/visibility?period=${PERIOD}`,
      headers: auth,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      billing: { tenantId: string; tier: string; status: string };
      tenantUsage: unknown[];
      memberUsage: Array<{ userId: string }>;
    };
    expect(body.billing.tier).toBe("free");
    expect(body.billing.status).toBe("active");
    expect(body.tenantUsage).toEqual(TENANT_USAGE.map((r) => ({ ...r })));
    expect(body.memberUsage).toEqual([
      { userId: MEMBER_A, feature: "plan_generation", period: PERIOD, used: 1, limit: 1 },
    ]);
  });

  it("a second member never sees the first member's individual usage through this endpoint", async () => {
    const port = buildFakePort({
      context: FREE_ACTIVE_CONTEXT,
      usageByUser: {
        [MEMBER_A]: [{ feature: "plan_generation", period: PERIOD, used: 1, limit: 1 }],
        [MEMBER_B]: [{ feature: "plan_generation", period: PERIOD, used: 0, limit: 1 }],
      },
    });

    // Request as MEMBER_A.
    app = await buildTestApp(
      port,
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: MEMBER_A, role: "member" }),
      MEMBER_A,
    );
    const resA = await app.inject({ method: "GET", url: `/billing/visibility?period=${PERIOD}`, headers: auth });
    const bodyA = resA.json() as { memberUsage: Array<{ userId: string }> };
    expect(bodyA.memberUsage.every((row) => row.userId === MEMBER_A)).toBe(true);
    await app.close();

    // Request as MEMBER_B, on a fresh app instance (separate session).
    app = await buildTestApp(
      port,
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: MEMBER_B, role: "member" }),
      MEMBER_B,
    );
    const resB = await app.inject({ method: "GET", url: `/billing/visibility?period=${PERIOD}`, headers: auth });
    const bodyB = resB.json() as { memberUsage: Array<{ userId: string }> };
    expect(bodyB.memberUsage.every((row) => row.userId === MEMBER_B)).toBe(true);

    // The port was ALWAYS asked for each requester's OWN userId only.
    expect(port.readOwnMemberUsage).toHaveBeenCalledWith(TENANT_A, MEMBER_A, PERIOD);
    expect(port.readOwnMemberUsage).toHaveBeenCalledWith(TENANT_A, MEMBER_B, PERIOD);
  });

  it("a suspended member is denied before the handler runs (401, auth re-check)", async () => {
    const port = buildFakePort();
    app = await buildTestApp(
      port,
      buildSuspendedMembershipRow({ tenantId: TENANT_A, userId: MEMBER_A, role: "member" }),
      MEMBER_A,
    );

    const res = await app.inject({ method: "GET", url: `/billing/visibility?period=${PERIOD}`, headers: auth });

    expect(res.statusCode).toBe(401);
    expect(port.loadContext).not.toHaveBeenCalled();
  });

  it("shows trial badge fields (tier pro, trialEndsAt) while a trial is active", async () => {
    // FIX 1 (review correction): the route calls `execute(scope, period)` with
    // no injectable `now`, so it always resolves against the REAL wall clock.
    // TRIALING_CONTEXT.trialEndsAt is the fixed date 2026-07-28 — without
    // freezing the clock, this assertion silently breaks on/after that date
    // (resolveEffectiveTier would then see `now >= trialEndsAt` and resolve to
    // Free). Freeze "now" to a fixed instant BEFORE trialEndsAt so the trial
    // is deterministically still active, regardless of when the suite runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    try {
      const port = buildFakePort({ context: TRIALING_CONTEXT, usageByUser: {} });
      app = await buildTestApp(
        port,
        buildActiveMembershipRow({ tenantId: TENANT_A, userId: MEMBER_A, role: "member" }),
        MEMBER_A,
      );

      const res = await app.inject({ method: "GET", url: `/billing/visibility?period=${PERIOD}`, headers: auth });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { billing: { tier: string; status: string; trialEndsAt: string | null } };
      expect(body.billing.tier).toBe("pro");
      expect(body.billing.status).toBe("trialing");
      expect(body.billing.trialEndsAt).toBe("2026-07-28T00:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a backfilled Free tenant returns a deterministic Free state with an upgrade prompt", async () => {
    const port = buildFakePort({ context: FREE_ACTIVE_CONTEXT, usageByUser: {} });
    app = await buildTestApp(
      port,
      buildActiveMembershipRow({ tenantId: TENANT_A, userId: MEMBER_A, role: "member" }),
      MEMBER_A,
    );

    const res = await app.inject({ method: "GET", url: `/billing/visibility?period=${PERIOD}`, headers: auth });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      billing: { tier: string; status: string; source: string };
      denialReason?: string;
      upgradePromptPath?: string;
    };
    expect(body.billing).toEqual(
      expect.objectContaining({ tier: "free", status: "active", source: "backfill" }),
    );
    // Free tier has 0 memory_write limit — premium is blocked, so the visibility
    // read surfaces the SAME denial reason and an upgrade prompt destination.
    expect(body.denialReason).toBe("premium_required");
    expect(body.upgradePromptPath).toBe("/billing");
  });

  it("rejects a request with no session → 401", async () => {
    const port = buildFakePort();
    const app0 = Fastify();
    await app0.register(authPlugin, { db: createAuthMockDb({ sessionRows: [] }).db as never });
    await app0.register(billingRoutes, {
      setMemberAllocation: new SetMemberAllocation(buildUnusedAdminPort()),
      getTenantUsage: new GetTenantUsage(buildUnusedAdminPort()),
      getBillingVisibility: new GetBillingVisibility(port),
    });
    app = app0;

    const res = await app.inject({ method: "GET", url: `/billing/visibility?period=${PERIOD}` });

    expect(res.statusCode).toBe(401);
    expect(port.loadContext).not.toHaveBeenCalled();
  });
});
