/**
 * Wiring tests for the inline route-option closures `buildApp()` assigns
 * (issue #369 follow-up).
 *
 * The composition root adapts ~50 repository methods to narrow route ports
 * with one-line closures such as `findUserById: (id) => adminUserRepo.findById(id)`.
 * Nothing type-checks their SEMANTICS: a closure pointed at the wrong
 * repository method, or one that silently drops an argument, still compiles
 * and still satisfies the port interface. `src/__tests__/build-app.test.ts`
 * covers the composition root's own concerns (route surface, error mapping,
 * shutdown); this suite covers the delegation itself.
 *
 * Method: build the REAL `buildApp()` over the shared auth mock DB, replace
 * each concrete repository method with a prototype spy, drive the route with
 * `app.inject()`, then assert BOTH directions of the closure — the exact
 * arguments the spy received, and that the response reflects the value the
 * spy returned. A status-code-only assertion would pass even with the
 * delegation crossed, so every test here pins arguments and/or payload.
 *
 * Prototype spies (rather than a hand-built fake `Database`) are used
 * deliberately: several of these repositories run multi-statement
 * transactions or composed Drizzle builders that a `select`-only mock cannot
 * represent, and the invariant under test lives in the closure, not in the SQL.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MockPlanGenerator } from "../ai/mock-generator.js";
import type { ObservabilityLogger } from "../observability/event-logger.js";
import {
  createAuthMockDb,
  DEFAULT_USER_ID,
  VALID_TOKEN,
} from "../test-support/auth-mocks.js";
import { UserRepository } from "../db/repositories/auth-context.js";
import { AiProviderConfigRepository } from "../db/repositories/ai-provider-config.js";
import { TierOverrideAdminRepository } from "../db/repositories/tier-override-admin.js";
import { AdminTenantsRepository } from "../db/repositories/admin-tenants.js";
import { AdminStatsRepository } from "../db/repositories/admin-stats.js";
import { ObservabilityEventsRepository } from "../db/repositories/observability-events.js";
import { UserProfileRepository } from "../db/repositories/user-profile.js";
import { UserPreferencesRepository } from "../db/repositories/user-preferences.js";
import { ChatEntitlement } from "../billing/chat-entitlement.js";
import { CheckAndConsumeQuota } from "../billing/quota-consumption.js";
import { PlanGenerationService } from "../ai/generation-service.js";

const AUTH_HEADERS = { authorization: `Bearer ${VALID_TOKEN}` };
const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001";

/**
 * Build the real app with every outbound dependency injected, so no LLM,
 * Stripe, embedding or filesystem call can happen during the test.
 */
async function buildWiringTestApp(): Promise<FastifyInstance> {
  const observabilityLogger = { recordEvent: vi.fn() } as unknown as ObservabilityLogger;
  return buildApp({
    db: createAuthMockDb().db,
    planGenerator: new MockPlanGenerator(),
    observabilityLogger,
  });
}

/**
 * Make the admin gate pass. `buildRequireAdmin` reads `is_admin` through the
 * route port's `findUserById`, which every admin route wires to the SAME
 * `UserRepository` instance — one spy therefore serves all of them, and its
 * recorded argument proves the closure forwards the session's user id rather
 * than some other identifier.
 */
function spyOnAdminUserLookup() {
  return vi
    .spyOn(UserRepository.prototype, "findById")
    .mockResolvedValue({
      id: DEFAULT_USER_ID,
      email: "admin@example.com",
      isAdmin: true,
    } as Awaited<ReturnType<UserRepository["findById"]>>);
}

/**
 * Assert that a `now`-style argument is the instant the request was served,
 * bounded by the wall-clock window around `app.inject()`. Needed because
 * `expect.any(Date)` accepts any constant a mis-wired closure might substitute
 * for the caller-supplied instant.
 */
function expectInstantWithin(value: unknown, before: number, after: number): void {
  expect(value).toBeInstanceOf(Date);
  const time = (value as Date).getTime();
  expect(time).toBeGreaterThanOrEqual(before);
  expect(time).toBeLessThanOrEqual(after);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildApp route-port wiring: admin AI config", () => {
  it("wires getActiveConfig to AiProviderConfigRepository.getActive", async () => {
    const findById = spyOnAdminUserLookup();
    const getActive = vi
      .spyOn(AiProviderConfigRepository.prototype, "getActive")
      .mockResolvedValue({
        provider: "anthropic",
        model: "claude-sonnet-4",
        updatedAt: new Date("2026-01-02T03:04:05.000Z"),
      } as Awaited<ReturnType<AiProviderConfigRepository["getActive"]>>);
    const app = await buildWiringTestApp();
    // buildApp may read the active config while composing the generator; only
    // the calls made by the request under test are relevant here.
    getActive.mockClear();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/admin/ai-config",
        headers: AUTH_HEADERS,
      });

      expect(findById).toHaveBeenCalledWith(DEFAULT_USER_ID);
      expect(getActive).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        provider: "anthropic",
        model: "claude-sonnet-4",
        updatedAt: "2026-01-02T03:04:05.000Z",
      });
    } finally {
      await app.close();
    }
  });

  it("wires upsertConfig to AiProviderConfigRepository.upsert with provider then model", async () => {
    spyOnAdminUserLookup();
    const upsert = vi
      .spyOn(AiProviderConfigRepository.prototype, "upsert")
      .mockResolvedValue({
        provider: "google",
        model: "gemini-2.5-pro",
        updatedAt: new Date("2026-02-03T00:00:00.000Z"),
      } as Awaited<ReturnType<AiProviderConfigRepository["upsert"]>>);
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/admin/ai-config",
        headers: AUTH_HEADERS,
        payload: { provider: "google", model: "gemini-2.5-pro" },
      });

      // Positional, same-typed arguments: a swap would be invisible without
      // asserting the order explicitly.
      expect(upsert).toHaveBeenCalledWith("google", "gemini-2.5-pro");
      expect(response.statusCode).toBe(200);
      expect(response.json().model).toBe("gemini-2.5-pro");
    } finally {
      await app.close();
    }
  });
});

describe("buildApp route-port wiring: admin tier override", () => {
  it("wires loadTenant, loadActiveOverride and grantTierOverride to TierOverrideAdminRepository", async () => {
    const findById = spyOnAdminUserLookup();
    const loadTenant = vi
      .spyOn(TierOverrideAdminRepository.prototype, "loadTenant")
      .mockResolvedValue({ id: TENANT_ID });
    const loadActiveOverride = vi
      .spyOn(TierOverrideAdminRepository.prototype, "loadActiveOverride")
      .mockResolvedValue(null);
    const grantTierOverride = vi
      .spyOn(TierOverrideAdminRepository.prototype, "grantTierOverride")
      .mockResolvedValue({
        id: "override-1",
        startsAt: new Date("2026-03-01T00:00:00.000Z"),
        endsAt: new Date("2026-04-01T00:00:00.000Z"),
      } as Awaited<ReturnType<TierOverrideAdminRepository["grantTierOverride"]>>);
    const app = await buildWiringTestApp();

    try {
      const before = Date.now();
      const response = await app.inject({
        method: "POST",
        url: `/admin/tenants/${TENANT_ID}/tier-override`,
        headers: AUTH_HEADERS,
        payload: {
          tier: "gym",
          reason: "pilot agreement",
          startsAt: "2026-03-01T00:00:00.000Z",
          endsAt: "2026-04-01T00:00:00.000Z",
        },
      });
      const after = Date.now();

      expect(findById).toHaveBeenCalledWith(DEFAULT_USER_ID);
      expect(loadTenant).toHaveBeenCalledWith(TENANT_ID);
      // Two-argument closure: both the tenant id AND the evaluation instant
      // must arrive, otherwise the overlap guard silently widens. `expect.any(Date)`
      // would not catch a closure that dropped `now` and substituted its own
      // constant, so the instant is bounded by the request window.
      expect(loadActiveOverride).toHaveBeenCalledWith(TENANT_ID, expect.any(Date));
      expectInstantWithin(loadActiveOverride.mock.calls[0]?.[1], before, after);
      expect(grantTierOverride).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        actorUserId: DEFAULT_USER_ID,
        tier: "gym",
        reason: "pilot agreement",
        startsAt: new Date("2026-03-01T00:00:00.000Z"),
        endsAt: new Date("2026-04-01T00:00:00.000Z"),
        operationKey: undefined,
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().id).toBe("override-1");
    } finally {
      await app.close();
    }
  });

  it("wires revokeTierOverride to TierOverrideAdminRepository with the active override id", async () => {
    spyOnAdminUserLookup();
    const loadActiveOverride = vi
      .spyOn(TierOverrideAdminRepository.prototype, "loadActiveOverride")
      .mockResolvedValue({ id: "override-9" });
    const revokeTierOverride = vi
      .spyOn(TierOverrideAdminRepository.prototype, "revokeTierOverride")
      .mockResolvedValue({ id: "override-9", endsAt: new Date("2026-05-06T07:08:09.000Z") });
    const app = await buildWiringTestApp();

    try {
      const before = Date.now();
      const response = await app.inject({
        method: "POST",
        url: `/admin/tenants/${TENANT_ID}/tier-override/revoke`,
        headers: AUTH_HEADERS,
        payload: {},
      });
      const after = Date.now();

      expect(loadActiveOverride).toHaveBeenCalledWith(TENANT_ID, expect.any(Date));
      expectInstantWithin(loadActiveOverride.mock.calls[0]?.[1], before, after);
      expect(revokeTierOverride).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        overrideId: "override-9",
        actorUserId: DEFAULT_USER_ID,
        now: expect.any(Date),
      });
      expectInstantWithin(revokeTierOverride.mock.calls[0]?.[0]?.now, before, after);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: "override-9",
        tenantId: TENANT_ID,
        endsAt: "2026-05-06T07:08:09.000Z",
      });
    } finally {
      await app.close();
    }
  });
});

describe("buildApp route-port wiring: admin tenants directory", () => {
  it("wires searchTenants to AdminTenantsRepository with the planned query", async () => {
    const findById = spyOnAdminUserLookup();
    const searchTenants = vi
      .spyOn(AdminTenantsRepository.prototype, "searchTenants")
      .mockResolvedValue([{ id: TENANT_ID, name: "Acme Gym" }]);
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/admin/tenants?query=acme&limit=7",
        headers: AUTH_HEADERS,
      });

      expect(findById).toHaveBeenCalledWith(DEFAULT_USER_ID);
      // The whole planned query object must survive the closure: dropping
      // `limit` or `matchId` would uncap the scan / lose the exact-id match.
      expect(searchTenants).toHaveBeenCalledWith({ term: "acme", matchId: null, limit: 7 });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ tenants: [{ id: TENANT_ID, name: "Acme Gym" }] });
    } finally {
      await app.close();
    }
  });

  it("wires loadProvisioningState to AdminTenantsRepository with the path tenant id", async () => {
    spyOnAdminUserLookup();
    const loadProvisioningState = vi
      .spyOn(AdminTenantsRepository.prototype, "loadProvisioningState")
      .mockResolvedValue({
        tenant: { id: TENANT_ID, name: "Acme Gym" },
        billing: null,
        activeOverride: {
          id: "override-3",
          tier: "trainer",
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: new Date("2026-06-01T00:00:00.000Z"),
        },
      });
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: `/admin/tenants/${TENANT_ID}/tier-override`,
        headers: AUTH_HEADERS,
      });

      expect(loadProvisioningState).toHaveBeenCalledWith(TENANT_ID);
      expect(response.statusCode).toBe(200);
      expect(response.json().tenant).toEqual({ id: TENANT_ID, name: "Acme Gym" });
      expect(response.json().activeOverride.id).toBe("override-3");
    } finally {
      await app.close();
    }
  });
});

describe("buildApp route-port wiring: admin logs and stats", () => {
  it("wires queryEvents to ObservabilityEventsRepository with the validated filters", async () => {
    const findById = spyOnAdminUserLookup();
    const queryEvents = vi
      .spyOn(ObservabilityEventsRepository.prototype, "queryEvents")
      .mockResolvedValue({
        events: [
          {
            id: "event-1",
            tenantId: TENANT_ID,
            actorUserId: DEFAULT_USER_ID,
            level: "warn",
            event: "billing.quota",
            outcome: null,
            metadata: {},
            createdAt: new Date("2026-07-08T09:10:11.000Z"),
          },
        ],
        nextCursor: "cursor-2",
      });
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: `/admin/logs?tenantId=${TENANT_ID}&level=warn&event=billing.quota&limit=25`,
        headers: AUTH_HEADERS,
      });

      expect(findById).toHaveBeenCalledWith(DEFAULT_USER_ID);
      // Every filter must reach the repository; a closure that forwarded only
      // the limit would return an unfiltered page with a plausible 200.
      expect(queryEvents).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        level: "warn",
        event: "billing.quota",
        limit: 25,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().nextCursor).toBe("cursor-2");
      expect(response.json().events[0].id).toBe("event-1");
    } finally {
      await app.close();
    }
  });

  it("wires getPlatformStats to AdminStatsRepository and returns its aggregates", async () => {
    const findById = spyOnAdminUserLookup();
    const stats = {
      tenants: { total: 12, signups7d: 2, signups30d: 5 },
      users: { total: 30, signups7d: 4, signups30d: 9 },
      memberships: { activeByRole: { owner: 12, member: 15, trainer: 3 } },
      billing: {
        effectiveTier: { free: 8, pro: 2, trainer: 1, gym: 1 },
        activeStripeSubscriptions: 3,
        trials: 1,
        activeOverridesByTier: { free: 0, pro: 0, trainer: 1, gym: 1 },
      },
      usage: {
        thisPeriod: "2026-08",
        byFeature: { plan_generation: 40, chat_message: 120, voice_minute: 7 },
      },
      observability: { errors24h: 2, events24h: 88 },
      retention: {
        windowWeeks: 4,
        abandonedSessionThresholdHours: 6,
        abandonedSessions: 1,
        cohorts: [],
        totals: {
          signups: 5,
          createdPlan: 4,
          completedFirstWorkout: 3,
          completedSecondWorkoutWithin7d: 2,
          activeWeek2: 1,
          activeWeek4: 1,
          trainerSponsoredSignups: 0,
        },
      },
    };
    const getPlatformStats = vi
      .spyOn(AdminStatsRepository.prototype, "getPlatformStats")
      .mockResolvedValue(stats as Awaited<ReturnType<AdminStatsRepository["getPlatformStats"]>>);
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/admin/stats",
        headers: AUTH_HEADERS,
      });

      expect(findById).toHaveBeenCalledWith(DEFAULT_USER_ID);
      expect(getPlatformStats).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(200);
      expect(response.json().tenants.total).toBe(12);
      expect(response.json().observability.events24h).toBe(88);
    } finally {
      await app.close();
    }
  });
});

describe("buildApp route-port wiring: user profile", () => {
  it("wires findUserEmailById to UserRepository and createProfileIfMissing to UserProfileRepository", async () => {
    // Lazy-provisioning branch: no stored row, so the route derives a default
    // name from the email the `findUserEmailById` closure projects out of the
    // user record, then creates the row.
    const findById = vi
      .spyOn(UserRepository.prototype, "findById")
      .mockResolvedValue({
        id: DEFAULT_USER_ID,
        email: "ada.lovelace@example.com",
        isAdmin: false,
      } as Awaited<ReturnType<UserRepository["findById"]>>);
    const provisionedRow = {
      userId: DEFAULT_USER_ID,
      name: "ada.lovelace",
      goal: null,
      experienceLevel: null,
      selfDescribedSex: null,
      heightCm: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const findByUserId = vi
      .spyOn(UserProfileRepository.prototype, "findByUserId")
      .mockResolvedValueOnce(null)
      .mockResolvedValue(
        provisionedRow as Awaited<ReturnType<UserProfileRepository["findByUserId"]>>,
      );
    const createIfMissing = vi
      .spyOn(UserProfileRepository.prototype, "createIfMissing")
      .mockResolvedValue(undefined);
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/user-profile",
        headers: AUTH_HEADERS,
      });

      expect(findByUserId).toHaveBeenCalledWith(DEFAULT_USER_ID);
      expect(findById).toHaveBeenCalledWith(DEFAULT_USER_ID);
      // The default name proves `findUserEmailById` projected `email` off the
      // record the user repository returned, rather than any other column.
      expect(createIfMissing).toHaveBeenCalledWith(DEFAULT_USER_ID, {
        name: "ada.lovelace",
        goal: null,
        experienceLevel: null,
        selfDescribedSex: null,
        heightCm: null,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe("ada.lovelace");
    } finally {
      await app.close();
    }
  });

  it("wires upsertProfile to UserProfileRepository with the session user id and merged state", async () => {
    const storedRow = {
      userId: DEFAULT_USER_ID,
      name: "Ada",
      goal: "strength",
      experienceLevel: "advanced",
      selfDescribedSex: null,
      heightCm: 170,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.spyOn(UserProfileRepository.prototype, "findByUserId").mockResolvedValue(
      storedRow as Awaited<ReturnType<UserProfileRepository["findByUserId"]>>,
    );
    const upsert = vi
      .spyOn(UserProfileRepository.prototype, "upsert")
      .mockResolvedValue({
        ...storedRow,
        name: "Ada Lovelace",
        goal: "hypertrophy",
      } as Awaited<ReturnType<UserProfileRepository["upsert"]>>);
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/user-profile",
        headers: AUTH_HEADERS,
        payload: { name: "Ada Lovelace", goal: "hypertrophy" },
      });

      // Both arguments matter: the id is the isolation predicate and the input
      // is the full target state the partial merge produced.
      expect(upsert).toHaveBeenCalledWith(DEFAULT_USER_ID, {
        name: "Ada Lovelace",
        goal: "hypertrophy",
        experienceLevel: "advanced",
        selfDescribedSex: null,
        heightCm: 170,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().goal).toBe("hypertrophy");
    } finally {
      await app.close();
    }
  });
});

describe("buildApp route-port wiring: voice and billing ports on the plan routes", () => {
  it("wires findTtsEnabled to the ttsEnabled column of the caller's preferences row", async () => {
    // The Pro gate runs before the preference read; stub it so this test is
    // about the `findTtsEnabled` closure only.
    vi.spyOn(ChatEntitlement.prototype, "check").mockResolvedValue({ allowed: true });
    const findByUserId = vi
      .spyOn(UserPreferencesRepository.prototype, "findByUserId")
      .mockResolvedValue({
        userId: DEFAULT_USER_ID,
        defaultLocation: null,
        defaultDuration: null,
        defaultEquipment: null,
        ttsEnabled: false,
      } as Awaited<ReturnType<UserPreferencesRepository["findByUserId"]>>);
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/speech",
        headers: AUTH_HEADERS,
        payload: { text: "Read this out loud." },
      });

      // 204 is only reachable when the closure projected `ttsEnabled === false`
      // off the row it read for the SESSION's user id: a closure that returned
      // the whole row, or read some other column, would fall through to the
      // synthesizer and answer 200/502 instead.
      expect(findByUserId).toHaveBeenCalledWith(DEFAULT_USER_ID);
      expect(response.statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it("wires the plan route's billing port to CheckAndConsumeQuota with scope, feature and operation key", async () => {
    vi.spyOn(PlanGenerationService.prototype, "assertGeneratable").mockResolvedValue(undefined);
    const checkAndConsume = vi
      .spyOn(CheckAndConsumeQuota.prototype, "checkAndConsume")
      .mockResolvedValue({ allowed: false, reason: "quota_exceeded" } as Awaited<
        ReturnType<CheckAndConsumeQuota["checkAndConsume"]>
      >);
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/plan-specs/spec-42/confirm",
        headers: { ...AUTH_HEADERS, "idempotency-key": "key-abc" },
      });

      // All three arguments must survive the closure: dropping the feature
      // would meter the wrong counter, dropping the key would break retry
      // idempotency, and neither is visible in the status code alone.
      expect(checkAndConsume).toHaveBeenCalledWith(
        { tenantId: expect.any(String), userId: DEFAULT_USER_ID },
        "plan_generation",
        "key-abc",
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "quota_exceeded" });
    } finally {
      await app.close();
    }
  });
});

describe("buildApp route-port wiring: user preferences", () => {
  it("wires findPreferencesByUserId to UserPreferencesRepository", async () => {
    const findByUserId = vi
      .spyOn(UserPreferencesRepository.prototype, "findByUserId")
      .mockResolvedValue({
        userId: DEFAULT_USER_ID,
        defaultLocation: "home",
        defaultDuration: 45,
        defaultEquipment: ["dumbbell"],
        ttsEnabled: false,
      } as Awaited<ReturnType<UserPreferencesRepository["findByUserId"]>>);
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/user-preferences",
        headers: AUTH_HEADERS,
      });

      expect(findByUserId).toHaveBeenCalledWith(DEFAULT_USER_ID);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        userId: DEFAULT_USER_ID,
        defaultLocation: "home",
        defaultDuration: 45,
        defaultEquipment: ["dumbbell"],
        ttsEnabled: false,
      });
    } finally {
      await app.close();
    }
  });

  it("wires upsertPreferences to UserPreferencesRepository with only the sent fields", async () => {
    const upsert = vi
      .spyOn(UserPreferencesRepository.prototype, "upsert")
      .mockResolvedValue({
        userId: DEFAULT_USER_ID,
        defaultLocation: null,
        defaultDuration: 30,
        defaultEquipment: null,
        ttsEnabled: null,
      } as Awaited<ReturnType<UserPreferencesRepository["upsert"]>>);
    const app = await buildWiringTestApp();

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/user-preferences",
        headers: AUTH_HEADERS,
        payload: { defaultDuration: 30 },
      });

      // The partial-merge contract depends on the closure forwarding the input
      // object untouched: an added or dropped key would overwrite stored
      // preferences the client never mentioned.
      expect(upsert).toHaveBeenCalledWith(DEFAULT_USER_ID, { defaultDuration: 30 });
      expect(response.statusCode).toBe(200);
      expect(response.json().defaultDuration).toBe(30);
    } finally {
      await app.close();
    }
  });
});
