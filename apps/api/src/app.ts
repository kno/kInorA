import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCookie from "@fastify/cookie";
import type { Database } from "./db/client.js";
import { createDbClient } from "./db/client.js";
import { AuthService, AuthError } from "./auth/service.js";
import { authPlugin } from "./auth/plugin.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoute } from "./routes/health.js";
import { socialRoutes } from "./routes/social.js";
import { planRoutes } from "./routes/plan.js";
import { workoutSessionRoutes } from "./routes/workout-session.js";
import { progressRoutes } from "./routes/progress.js";
import { wsRoutes } from "./routes/ws.js";
import { WorkoutPlanRepository } from "./db/repositories/workout-plan.js";
import { PlanSpecRepository } from "./db/repositories/plan-spec.js";
import { PlanDraftRepository } from "./db/repositories/plan-draft.js";
import { AiProviderConfigRepository } from "./db/repositories/ai-provider-config.js";
import { PlanGenerationService } from "./ai/generation-service.js";
import { warnIfAiConfigMissing } from "./ai/openrouter-generator.js";
import { DynamicPlanGenerator } from "./ai/dynamic-generator.js";
import { buildAdapters } from "./ai/adapter-factory.js";
import { adminAiConfigRoutes } from "./routes/admin-ai-config.js";
import { userProfileRoutes } from "./routes/user-profile.js";
import { userMemoryRoutes } from "./routes/user-memories.js";
import { userPreferencesRoutes } from "./routes/user-preferences.js";
import {
  DEFAULT_EMBEDDING_RUNTIME_CONFIG,
  createOpenAIEmbeddingGenerator,
  type EmbeddingRuntimeConfig,
} from "./ai/embedding-port.js";
import {
  VectorMemoryRetriever,
  VectorMemoryWriteCoordinator,
  type VectorMemorySearchPort,
  type VectorMemoryWritePort,
} from "./ai/memory-retriever.js";
import type { PersistVectorMemoryResult } from "./ai/memory-retriever.js";
import { VectorMemoryRepository } from "./db/repositories/vector-memory.js";
import { UserProfileRepository } from "./db/repositories/user-profile.js";
import { UserPreferencesRepository } from "./db/repositories/user-preferences.js";
import { createPlanRouteRepo } from "./plan-route-repo.js";
import { WsRegistry } from "./ws/registry.js";
import type { PlanGenerator } from "./ai/port.js";
import type { SocialAuthService } from "./auth/social.js";
import { WorkoutSessionRepository } from "./db/repositories/workout-session.js";
import { SessionRepository } from "./db/repositories/session.js";
import { MembershipRepository, UserRepository } from "./db/repositories/auth-context.js";
import type { WsRouteRepo } from "./routes/ws.js";
import type { AdminAiConfigRouteRepo } from "./routes/admin-ai-config.js";
import {
  UserMemoryLifecycleService,
  consoleUserMemoryAuditPort,
} from "./user-memory/service.js";
import {
  BillingStateReaderRepository,
  QuotaLedgerRepository,
} from "./db/repositories/billing-quota.js";
import { BillingAdminRepository } from "./db/repositories/billing-admin.js";
import { BillingVisibilityRepository } from "./db/repositories/billing-visibility.js";
import { CheckEntitlement } from "./billing/entitlement.js";
import { CheckAndConsumeQuota } from "./billing/quota-consumption.js";
import { SetMemberAllocation, GetTenantUsage } from "./billing/quota-admin.js";
import { GetBillingVisibility } from "./billing/billing-visibility.js";
import { billingRoutes } from "./routes/billing.js";

export interface BuildAppOptions {
  db?: Database;
  socialAuthService?: SocialAuthService;
  /**
   * Injectable PlanGenerator for tests.
   * Defaults to OpenRouterPlanGenerator in production.
   * Pass a MockPlanGenerator to avoid LLM calls in tests.
   */
  planGenerator?: PlanGenerator;
  /**
   * Injectable WsRegistry for tests.
   * Defaults to a fresh WsRegistry() in production.
   * Pass a pre-constructed instance to observe notifications in tests.
   */
  wsRegistry?: WsRegistry;
}

/**
 * Build the Fastify application with all plugins, routes, and error handlers.
 *
 * Accepts an optional db override for testing with mock or test databases,
 * an optional socialAuthService for social login routes, and an optional
 * planGenerator for injecting a mock in tests (avoids LLM calls).
 *
 * In production, called from index.ts which creates all dependencies.
 * OpenRouterPlanGenerator is constructed lazily — it does NOT require
 * OPENROUTER_API_KEY at construction time (only at generate() call time),
 * so the API starts cleanly even when AI env vars are unset.
 */
export async function buildApp(
  dbOrOptions?: Database | BuildAppOptions,
  socialAuthServiceLegacy?: SocialAuthService
): Promise<FastifyInstance> {
  // Support both the old 2-argument signature (db, socialAuthService) and the
  // new options-bag form (BuildAppOptions) for backward compatibility with
  // existing integration tests that call buildApp(mockDb).
  let database: Database;
  let socialAuthService: SocialAuthService | undefined;
  let planGenerator: PlanGenerator | undefined;
  let wsRegistry: WsRegistry | undefined;

  // Discriminate between the options-bag form (BuildAppOptions) and the legacy
  // 2-argument form (Database, SocialAuthService?).
  //
  // We use a nominal key ("planGenerator") that belongs ONLY to BuildAppOptions —
  // NOT to Database — to avoid fragile negative checks like !("select" in obj)
  // that break when the DB client is wrapped or the options bag grows those keys.
  //
  // Legacy callers: buildApp(mockDb) or buildApp(mockDb, socialSvc) — mockDb is a
  // Database-shaped object that never has "planGenerator".
  // New callers: buildApp({ db, planGenerator }) — always has "planGenerator" key
  // (even when the value is undefined, the key is present via the interface).
  if (
    dbOrOptions !== null &&
    typeof dbOrOptions === "object" &&
    "planGenerator" in dbOrOptions
  ) {
    // Options-bag form
    const opts = dbOrOptions as BuildAppOptions;
    database = opts.db ?? createDbClient().db;
    socialAuthService = opts.socialAuthService;
    planGenerator = opts.planGenerator;
    wsRegistry = opts.wsRegistry;
  } else {
    // Legacy 2-argument form: (db?, socialAuthService?)
    database = (dbOrOptions as Database | undefined) ?? createDbClient().db;
    socialAuthService = socialAuthServiceLegacy;
  }

  const app = Fastify();

  // Validation errors → 422, Auth errors → 401, social auth errors → 400,
  // everything else → 500. Must be set before registering route plugins so
  // child scopes inherit.
  app.setErrorHandler((error: unknown, _request, reply) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Boolean((error as { validation: unknown }).validation)
    ) {
      return reply.code(422).send({ error: "Validation Error" });
    }
    if (error instanceof AuthError) {
      return reply.code(401).send({ error: error.message });
    }
    app.log.error(error as Error);
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  // Auth plugin adds request.authContext decorator + onRequest session extraction.
  await app.register(authPlugin, { db: database });

  // @fastify/cookie parses request.cookies. Needed so wsRoutes can read the
  // kinora_session cookie on the same-origin browser WS upgrade (issue #42):
  // the httpOnly session token authenticates the WS without being exposed to
  // client JS or placed in the WS URL. Registered globally (harmless for other
  // routes; only wsRoutes reads request.cookies today).
  await app.register(fastifyCookie);

  // Health routes
  await app.register(healthRoute);

  // Auth routes (register + login + logout + profile)
  await app.register(authRoutes, { authService: new AuthService(database) });

  // Social login routes (OIDC provider abstraction + Google)
  if (socialAuthService) {
    await app.register(socialRoutes, { socialAuthService });
  }

  // Build generation DI graph.
  // DynamicPlanGenerator reads the active provider config from DB on every generate() call,
  // then delegates to the correct adapter (openrouter, openai, anthropic, google, opencode-go).
  // Falls back to OPENROUTER_API_KEY env var behavior when no DB row exists (retrocompatible).
  // In tests, callers pass planGenerator: new MockPlanGenerator() via BuildAppOptions.
  // Warn once at boot when no AI key is configured (silent in tests that inject a mock).
  if (!planGenerator) {
    warnIfAiConfigMissing();
  }
  const registry = wsRegistry ?? new WsRegistry();
  const configRepo = new AiProviderConfigRepository(database);
  const generator = planGenerator ?? new DynamicPlanGenerator(configRepo, buildAdapters());
  const workoutPlanRepo = new WorkoutPlanRepository(database);
  const workoutSessionRepo = new WorkoutSessionRepository(database);
  const planSpecRepo = new PlanSpecRepository(database);
  const vectorMemoryRepo = new VectorMemoryRepository(database);
  const { retriever: vectorMemoryRetriever, writer: vectorMemoryWriter } =
    createOptionalVectorMemoryServices(vectorMemoryRepo, resolveEmbeddingRuntimeConfig());

  // 11a billing core — entitlement + atomic hybrid quota consume.
  // Repositories live in the infra layer; the pure use cases depend only on
  // their ports. The composition root is the sole place they are wired.
  const billingStateReader = new BillingStateReaderRepository(database);
  const quotaLedgerRepo = new QuotaLedgerRepository(database);
  const checkEntitlement = new CheckEntitlement(billingStateReader);
  const checkAndConsumeQuota = new CheckAndConsumeQuota(checkEntitlement, quotaLedgerRepo);
  // Premium retrieval gate: deny → skip retrieval before embedding/search.
  const memoryEntitlement = {
    check: (scope: { tenantId: string; userId: string }) =>
      checkEntitlement
        .check(scope, "memory_retrieval")
        .then((decision) => ({ allowed: decision.allowed })),
  };

  const planGenerationService = new PlanGenerationService(
    generator,
    planSpecRepo,
    workoutPlanRepo,
    registry,
    vectorMemoryRetriever,
    memoryEntitlement
  );
  const userMemoryService = new UserMemoryLifecycleService(
    vectorMemoryRepo,
    vectorMemoryWriter,
    consoleUserMemoryAuditPort,
    // Premium write gate: check + consume `memory_write` after eligibility +
    // enabled pass and just before embed+store. A denial (Free tier limit 0,
    // expired trial, suspended membership) blocks before any embedding and
    // returns 403; production always wires this, so the write fails closed.
    {
      checkAndConsume: (scope, feature, operationKey) =>
        checkAndConsumeQuota.checkAndConsume(scope, feature, operationKey),
      // #174: release the reserved unit if embed+store fails terminally, so a
      // fact that is never retried does not leak a memory_write unit. The
      // period is threaded from the consumed decision (FIX B) — never
      // re-derived from the current clock.
      refund: (scope, feature, operationKey, period) =>
        checkAndConsumeQuota.refund(scope, feature, operationKey, period).then(() => undefined),
    }
  );

  // Plan wizard + generation routes (draft, promote, confirm, regenerate, fetch).
  // Route port: constructs the draft/spec/plan repos here (composition root) and
  // owns the promote atomicity — promoteDraftToSpec wraps specRepo.create +
  // draftRepo.delete in a single database.transaction, reusing the repos'
  // optional-executor (tx) signatures. The route never sees a transaction.
  const planDraftRepo = new PlanDraftRepository(database);
  const planRouteRepo = createPlanRouteRepo({
    database,
    planSpecRepo,
    planDraftRepo,
    workoutPlanRepo,
  });
  await app.register(planRoutes, {
    repo: planRouteRepo,
    generationService: planGenerationService,
    billing: {
      checkAndConsume: (scope, feature, operationKey) =>
        checkAndConsumeQuota.checkAndConsume(scope, feature, operationKey),
    },
  });

  await app.register(workoutSessionRoutes, {
    repo: workoutSessionRepo,
  });

  // Dashboard progress summary (09c-v1-progress-dashboard-stats, Slice 2).
  // Reuses the same WorkoutSessionRepository instance (getDashboardSummary
  // is one more bounded read method alongside listCompletedSessions).
  await app.register(progressRoutes, {
    repo: workoutSessionRepo,
  });

  // Admin AI config routes — GET/PUT /admin/ai-config (requireAuth + requireAdmin).
  // Route port: findUserById feeds buildRequireAdmin; config ops reuse the same
  // configRepo instance that powers DynamicPlanGenerator. Constructed here so the
  // route stays free of any DB-layer import.
  const adminUserRepo = new UserRepository(database);
  const adminAiConfigRepo: AdminAiConfigRouteRepo = {
    findUserById: (id) => adminUserRepo.findById(id),
    getActiveConfig: () => configRepo.getActive(),
    upsertConfig: (provider, model) => configRepo.upsert(provider, model),
  };
  await app.register(adminAiConfigRoutes, { repo: adminAiConfigRepo });

  // User profile + preferences routes (10a-user-memory-structured, Slice 2).
  // User-scoped tables (keyed by `userId`, no tenant column) — isolation is
  // enforced by the single-column predicate the repos already use. The route
  // ports are built here from the concrete repos + UserRepository (for the
  // lazy-provision email lookup) so the route files stay free of any DB-layer
  // import. `adminUserRepo` is reused for the email lookup.
  const userProfileRepo = new UserProfileRepository(database);
  const userPreferencesRepo = new UserPreferencesRepository(database);
  const userProfileRouteRepo = {
    findUserEmailById: async (id: string) =>
      (await adminUserRepo.findById(id))?.email ?? null,
    findProfileByUserId: (id: string) => userProfileRepo.findByUserId(id),
    createProfileIfMissing: (
      id: string,
      input: Parameters<typeof userProfileRepo.createIfMissing>[1]
    ) => userProfileRepo.createIfMissing(id, input),
    upsertProfile: (id: string, input: Parameters<typeof userProfileRepo.upsert>[1]) =>
      userProfileRepo.upsert(id, input),
  };
  const userPreferencesRouteRepo = {
    findPreferencesByUserId: (id: string) =>
      userPreferencesRepo.findByUserId(id),
    upsertPreferences: (
      id: string,
      input: Parameters<typeof userPreferencesRepo.upsert>[1]
    ) => userPreferencesRepo.upsert(id, input),
  };
  await app.register(userProfileRoutes, { repo: userProfileRouteRepo });
  await app.register(userPreferencesRoutes, {
    repo: userPreferencesRouteRepo,
  });
  await app.register(userMemoryRoutes, { service: userMemoryService });

  // 11a billing routes (Phase 3 quota administration + Phase 4 member
  // visibility). Owner-only endpoints set per-member allocations (audited)
  // and read aggregate/member usage COUNTS; the visibility endpoint is open
  // to ANY active member and returns tenant billing state + the requester's
  // OWN usage only. Drizzle adapters live in the infra layer; the pure use
  // cases depend only on their ports. Tenant + actor identity are read from
  // authContext inside the route, so these can only ever touch the caller's
  // own active tenant, and they never expose member private content.
  const billingAdminRepo = new BillingAdminRepository(database);
  const billingVisibilityRepo = new BillingVisibilityRepository(database);
  await app.register(billingRoutes, {
    setMemberAllocation: new SetMemberAllocation(billingAdminRepo),
    getTenantUsage: new GetTenantUsage(billingAdminRepo),
    getBillingVisibility: new GetBillingVisibility(billingVisibilityRepo),
  });

  // WebSocket plugin + authenticated plan-status route.
  // WsRegistry is shared between this route and PlanGenerationService so
  // notifications from the generation background task reach connected clients.
  // db is passed so wsRoutes can resolve ?token= query-param auth using the
  // same SessionRepository + resolveAuthContextFromToken as the Bearer path.
  // allowedOrigins drives the CSWSH gate on the cookie/browser WS path (#42):
  // sourced from WEB_PUBLIC_ORIGIN (the same web-origin config used for social
  // redirect URIs), with an optional comma-separated WS_ALLOWED_ORIGINS override
  // for multi-origin deployments (e.g. staging + prod).
  await app.register(fastifyWebsocket);
  // Route port: constructs SessionRepository + MembershipRepository from the
  // database here (composition root) so ws.ts stays free of any DB-layer import.
  const wsSessionRepo = new SessionRepository(database);
  const wsMembershipRepo = new MembershipRepository(database);
  const wsRepo: WsRouteRepo = {
    findByTokenHash: (hash) => wsSessionRepo.findByTokenHash(hash),
    findByTenantAndUser: (tenantId, userId) =>
      wsMembershipRepo.findByTenantAndUser(tenantId, userId),
  };
  await app.register(wsRoutes, {
    registry,
    repo: wsRepo,
    allowedOrigins: resolveWsAllowedOrigins(),
  });

  return app;
}

/**
 * Build the WS Origin allowlist from environment configuration.
 *
 * Priority: an explicit comma-separated `WS_ALLOWED_ORIGINS` list wins; otherwise
 * fall back to the single `WEB_PUBLIC_ORIGIN` (the app's canonical web origin).
 * Returns an empty list when neither is set — the CSWSH gate then fails closed
 * for browsers (no Origin is allowed → browsers poll), while non-browser
 * (no-Origin) Bearer/?token= clients continue to work.
 */
export function resolveWsAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const explicit = env.WS_ALLOWED_ORIGINS;
  if (explicit && explicit.trim() !== "") {
    return explicit
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o !== "");
  }
  const webOrigin = env.WEB_PUBLIC_ORIGIN;
  return webOrigin && webOrigin.trim() !== "" ? [webOrigin.trim()] : [];
}

export function resolveEmbeddingRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): EmbeddingRuntimeConfig {
  return {
    provider: env.VECTOR_MEMORY_EMBEDDING_PROVIDER ?? DEFAULT_EMBEDDING_RUNTIME_CONFIG.provider,
    model: env.VECTOR_MEMORY_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_RUNTIME_CONFIG.model,
    version:
      env.VECTOR_MEMORY_EMBEDDING_VERSION ??
      env.VECTOR_MEMORY_EMBEDDING_MODEL ??
      DEFAULT_EMBEDDING_RUNTIME_CONFIG.version,
    dimension: Number(
      env.VECTOR_MEMORY_EMBEDDING_DIMENSION ?? DEFAULT_EMBEDDING_RUNTIME_CONFIG.dimension
    ),
    timeoutMs: Number(
      env.VECTOR_MEMORY_EMBEDDING_TIMEOUT_MS ?? DEFAULT_EMBEDDING_RUNTIME_CONFIG.timeoutMs
    ),
    maxAttempts: Number(
      env.VECTOR_MEMORY_EMBEDDING_MAX_ATTEMPTS ?? DEFAULT_EMBEDDING_RUNTIME_CONFIG.maxAttempts
    ),
  };
}

export function createOptionalVectorMemoryServices(
  repo: VectorMemorySearchPort & VectorMemoryWritePort,
  runtimeConfig: EmbeddingRuntimeConfig,
): {
  retriever?: VectorMemoryRetriever;
  writer: Pick<VectorMemoryWriteCoordinator, "saveConfirmedMemory">;
} {
  try {
    const embeddingGenerator = createOpenAIEmbeddingGenerator(runtimeConfig);
    return {
      retriever: new VectorMemoryRetriever(embeddingGenerator, repo),
      writer: new VectorMemoryWriteCoordinator(embeddingGenerator, repo),
    };
  } catch (error) {
    // Embeddings are optional. Invalid provider configuration must not block the API.
    console.warn("[app] vector memory disabled", {
      reason: "misconfigured",
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return {
      writer: {
        async saveConfirmedMemory(): Promise<PersistVectorMemoryResult> {
          return { kind: "failed", reason: "misconfigured" };
        },
      },
    };
  }
}
