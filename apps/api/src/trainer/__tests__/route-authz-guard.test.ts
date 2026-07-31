import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { resolveAuthorizedOwner, ForbiddenOwnerAccess } from "../owner-access.js";
import type { EntitlementContext } from "../../billing/entitlement.js";
import type { TrainerClientAssignmentDTO } from "@kinora/contracts";
import { authPlugin } from "../../auth/plugin.js";
import { trainerRoutes } from "../../routes/trainer.js";
import { planRoutes } from "../../routes/plan.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

/**
 * Regression guard (15a-v2-trainer-account-access, task 2.12, extended by
 * task 3.8) — assignment-check omission guard.
 *
 * Intent: no trainer-scoped route may EVER read/write another user's owned
 * data without first routing the requested owner through
 * `resolveAuthorizedOwner` (or, for routes that don't resolve a specific
 * client owner — invite/list — its reused role+entitlement half,
 * `assertTrainerEntitled`; see owner-access.ts). In Slice 2 there was no
 * trainer-scoped route yet; Slice 3 (task 3.8) fills in the two routes it
 * added (`POST /trainer/clients/invite`, `GET /trainer/clients`) and proves,
 * through the REAL registered route plugin (not a reimplementation), that:
 *   1. a non-trainer role is denied (403) BEFORE any repository call, and
 *   2. a trainer role WITHOUT the trainer entitlement is ALSO denied (403)
 *      before any repository call — proving `requireRole` alone is not
 *      sufficient and the entitlement gate genuinely runs.
 *
 * S4 (task 4.5) extends `TRAINER_SCOPED_ROUTES` with
 * `POST /clients/:clientUserId/plan-specs` (`routes/plan.ts`) now that it
 * threads `ownerUserId` through the FULL `resolveAuthorizedOwner` (role + tier
 * + active-assignment) — the same probes as the Slice 3 routes above, plus an
 * assertion that the billing `checkAndConsume` quota gate never fires on a
 * denial either.
 */

const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TRAINER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const MEMBER_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const PLAN_CLIENT_ID = "aaaaaaaa-0000-0000-0000-000000000003";

/** A trainer-scoped route entry: how to call it + repo methods that must not fire on denial. */
interface TrainerScopedRoute {
  method: string;
  path: string;
  request: { method: "GET" | "POST"; url: string; payload?: unknown };
  /** Build the repo mocks for this route, so the test can assert none were reached on denial. */
  buildRepos: (entitlementReader: { loadContext: ReturnType<typeof vi.fn> }) => Record<string, unknown>;
  /** Repo methods (by [repoKey, methodKey]) that must never be called when denied. */
  guardedCalls: Array<[string, string]>;
  /** Register the ACTUAL route plugin under test against `app`, given its repo mocks + entitlement reader. */
  register: (
    app: FastifyInstance,
    repos: Record<string, unknown>,
    entitlementReader: { loadContext: ReturnType<typeof vi.fn> },
  ) => Promise<void>;
}

function entitlementReaderMock(tier: "free" | "pro" | "trainer") {
  return {
    loadContext: vi.fn().mockResolvedValue({
      membershipStatus: "active",
      billing: { tier, status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      activeOverrideTier: null,
    }),
  };
}

const TRAINER_SCOPED_ROUTES: ReadonlyArray<TrainerScopedRoute> = [
  {
    method: "POST",
    path: "/trainer/clients/invite",
    request: { method: "POST", url: "/trainer/clients/invite", payload: { email: "client@example.com" } },
    buildRepos: () => ({
      assignmentRepo: {
        create: vi.fn(),
        findByClientUserId: vi.fn(),
        updateStatus: vi.fn(),
        listByTrainer: vi.fn(),
      },
      membershipRepo: { upsertInvited: vi.fn(), updateStatusByTenantAndUser: vi.fn() },
      userRepo: { findByEmail: vi.fn(), findById: vi.fn() },
    }),
    guardedCalls: [
      ["assignmentRepo", "findByClientUserId"],
      ["assignmentRepo", "create"],
      ["membershipRepo", "upsertInvited"],
      ["userRepo", "findByEmail"],
    ],
    register: (app, repos, entitlementReader) =>
      app.register(trainerRoutes, { ...repos, entitlementReader } as never),
  },
  {
    method: "GET",
    path: "/trainer/clients",
    request: { method: "GET", url: "/trainer/clients" },
    buildRepos: () => ({
      assignmentRepo: {
        create: vi.fn(),
        findByClientUserId: vi.fn(),
        updateStatus: vi.fn(),
        listByTrainer: vi.fn(),
      },
      membershipRepo: { upsertInvited: vi.fn(), updateStatusByTenantAndUser: vi.fn() },
      userRepo: { findByEmail: vi.fn(), findById: vi.fn() },
    }),
    guardedCalls: [["assignmentRepo", "listByTrainer"]],
    register: (app, repos, entitlementReader) =>
      app.register(trainerRoutes, { ...repos, entitlementReader } as never),
  },
  {
    // S4 (task 4.5): `routes/plan.ts`'s client-owned-plan-creation route. It
    // resolves ownership over a SPECIFIC client (unlike invite/list above), so
    // it exercises the FULL `resolveAuthorizedOwner` (role → tier → active
    // assignment), never just its `assertTrainerEntitled` half. The probe
    // calls it with `PLAN_CLIENT_ID` — a DIFFERENT id than the actor's own —
    // so a denial always represents the widening branch, never the self path.
    method: "POST",
    path: "/clients/:clientUserId/plan-specs",
    request: {
      method: "POST",
      url: `/clients/${PLAN_CLIENT_ID}/plan-specs`,
      payload: {
        goal: "strength",
        location: "gym",
        daysPerWeek: 3,
        sessionDurationMinutes: 60,
        equipment: ["barbell"],
        limitations: [],
      },
    },
    buildRepos: () => ({
      repo: {
        upsertDraft: vi.fn(),
        commitDraft: vi.fn(),
        findCurrentDraft: vi.fn().mockResolvedValue(null),
        promoteDraftToSpec: vi.fn(),
        findPlanById: vi.fn(),
        findLatestPlanBySpec: vi.fn(),
        findAllPlansByUser: vi.fn().mockResolvedValue([]),
      },
      generationService: { startGeneration: vi.fn(), assertGeneratable: vi.fn() },
      billing: { checkAndConsume: vi.fn() },
      assignmentRepo: { findActiveAssignment: vi.fn() },
    }),
    guardedCalls: [
      ["repo", "promoteDraftToSpec"],
      ["generationService", "startGeneration"],
      ["billing", "checkAndConsume"],
      ["assignmentRepo", "findActiveAssignment"],
    ],
    register: (app, repos, entitlementReader) =>
      app.register(planRoutes, {
        repo: repos.repo,
        generationService: repos.generationService,
        billing: repos.billing,
        trainerAccess: { assignmentRepo: repos.assignmentRepo, entitlementReader },
      } as never),
  },
];

const TENANT = "tenant-1" as never;
const TRAINER = "trainer-1" as never;
const MEMBER = "member-1" as never;
const OTHER_USER = "other-user-1" as never;
const CLIENT_A = "client-a" as never;
const CLIENT_B = "client-b" as never;

function entitlementReader(ctx: Partial<EntitlementContext>) {
  return {
    loadContext: async () => ({
      membershipStatus: "active" as const,
      billing: null,
      activeOverrideTier: null,
      ...ctx,
    }),
  };
}

function assignmentRepo(row: TrainerClientAssignmentDTO | undefined) {
  return { findActiveAssignment: async () => row };
}

async function buildProbeApp(
  route: TrainerScopedRoute,
  repos: ReturnType<TrainerScopedRoute["buildRepos"]>,
  entitlementReader: { loadContext: ReturnType<typeof vi.fn> },
  role: "member" | "trainer",
  userId: string,
) {
  const app = Fastify();
  const db = createAuthMockDb({
    sessionRows: [buildSessionRow({ tenantId: TENANT_ID, userId })],
    membershipRows: [buildActiveMembershipRow({ tenantId: TENANT_ID, userId, role })],
  }).db;
  await app.register(authPlugin, { db });
  await route.register(app, repos, entitlementReader);
  return app;
}

describe("regression guard: trainer-scoped routes must resolve ownership via resolveAuthorizedOwner", () => {
  it("enumerates the current set of trainer-scoped routes (S3 + S4)", () => {
    expect(TRAINER_SCOPED_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /trainer/clients/invite",
      "GET /trainer/clients",
      "POST /clients/:clientUserId/plan-specs",
    ]);
  });

  it.each(TRAINER_SCOPED_ROUTES)(
    "$method $path denies a non-trainer role (403) before any repository call",
    async (route) => {
      const entitlementReader = entitlementReaderMock("trainer");
      const repos = route.buildRepos(entitlementReader);
      const app = await buildProbeApp(route, repos, entitlementReader, "member", MEMBER_ID);

      const res = await app.inject({
        method: route.request.method,
        url: route.request.url,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: route.request.payload,
      });

      expect(res.statusCode).toBe(403);
      expect(entitlementReader.loadContext).not.toHaveBeenCalled();
      for (const [repoKey, methodKey] of route.guardedCalls) {
        expect((repos[repoKey] as Record<string, ReturnType<typeof vi.fn>>)[methodKey]).not.toHaveBeenCalled();
      }
      await app.close();
    },
  );

  it.each(TRAINER_SCOPED_ROUTES)(
    "$method $path denies a trainer role WITHOUT the trainer entitlement (403) before any repository call",
    async (route) => {
      const entitlementReader = entitlementReaderMock("pro");
      const repos = route.buildRepos(entitlementReader);
      const app = await buildProbeApp(route, repos, entitlementReader, "trainer", TRAINER_ID);

      const res = await app.inject({
        method: route.request.method,
        url: route.request.url,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: route.request.payload,
      });

      expect(res.statusCode).toBe(403);
      // The entitlement gate DID run (proving requireRole alone is not the
      // whole story) but every repo call downstream of it must not fire.
      expect(entitlementReader.loadContext).toHaveBeenCalledTimes(1);
      for (const [repoKey, methodKey] of route.guardedCalls) {
        expect((repos[repoKey] as Record<string, ReturnType<typeof vi.fn>>)[methodKey]).not.toHaveBeenCalled();
      }
      await app.close();
    },
  );

  // --- Resolver invariants the guard exists to police ---

  it("self-only default is provably unchanged: a non-trainer role can never widen", async () => {
    const deps = {
      entitlementReader: entitlementReader({}),
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: MEMBER, role: "member" },
        deps,
        OTHER_USER,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);

    const self = await resolveAuthorizedOwner(
      { tenantId: TENANT, actorUserId: MEMBER, role: "member" },
      deps,
    );
    expect(self).toBe(MEMBER);
  });

  it("a trainer without the trainer entitlement is denied even with the trainer role", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "pro", status: "active", source: "stripe", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo({
        id: "a1",
        tenantId: TENANT,
        trainerUserId: TRAINER,
        clientUserId: CLIENT_A,
        status: "active",
      }),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: TRAINER, role: "trainer" },
        deps,
        CLIENT_A,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("a trainer with role+entitlement but no active assignment for the client is denied", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: TRAINER, role: "trainer" },
        deps,
        CLIENT_A,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("a trainer assigned to client A cannot resolve client B", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: TRAINER, role: "trainer" },
        deps,
        CLIENT_B,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("a trainer with role+entitlement+active assignment resolves the client (positive case)", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo({
        id: "a1",
        tenantId: TENANT,
        trainerUserId: TRAINER,
        clientUserId: CLIENT_A,
        status: "active",
      }),
    };

    const ownerId = await resolveAuthorizedOwner(
      { tenantId: TENANT, actorUserId: TRAINER, role: "trainer" },
      deps,
      CLIENT_A,
    );
    expect(ownerId).toBe(CLIENT_A);
  });
});
