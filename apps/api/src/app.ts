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
import { ChatEntitlement } from "./billing/chat-entitlement.js";
import {
  PlanSpecExtractionAdapter,
  buildExtractionModelFactory,
} from "./ai/extraction-adapter.js";
import type { PlanSpecExtractor } from "./ai/extraction-port.js";
import { CheckAndConsumeQuota } from "./billing/quota-consumption.js";
import { SetMemberAllocation, GetTenantUsage } from "./billing/quota-admin.js";
import { GetBillingVisibility } from "./billing/billing-visibility.js";
import { billingRoutes, stripeWebhookRoutes } from "./routes/billing.js";
import { ProcessStripeWebhook } from "./billing/process-webhook.js";
import type {
  CheckoutGateway,
  InvoiceGateway,
  PortalGateway,
  PriceGateway,
  StripeGateway,
} from "./billing/stripe-gateway.js";
import { CreateCheckout, type CheckoutPriceConfig } from "./billing/create-checkout.js";
import { ResolveBillingPricing } from "./billing/billing-pricing.js";
import {
  CreatePortalSession,
  type BillingCustomerReaderPort,
} from "./billing/create-portal-session.js";
import { ListInvoices } from "./billing/list-invoices.js";
import { validateBillingPricingConfig } from "./billing/pricing-config.js";
import { StripeEventStoreRepository } from "./db/repositories/stripe-events.js";
import { BillingCustomerRepository } from "./db/repositories/billing-customer.js";
import {
  UnconfiguredStripeGateway,
  UnconfiguredCheckoutGateway,
  UnconfiguredPortalInvoiceGateway,
  UnconfiguredPriceGateway,
  createStripeGatewayFromEnv,
} from "./db/repositories/stripe-gateway.js";

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
   * Injectable PlanSpecExtractor for the chat endpoint (12, S2b).
   * Defaults to the real LangChain-backed `PlanSpecExtractionAdapter` in
   * production (provider config read per turn). Pass a `MockPlanSpecExtractor`
   * (or any fake) to avoid LLM calls in tests.
   */
  chatExtractor?: PlanSpecExtractor;
  /**
   * Injectable WsRegistry for tests.
   * Defaults to a fresh WsRegistry() in production.
   * Pass a pre-constructed instance to observe notifications in tests.
   */
  wsRegistry?: WsRegistry;
  /**
   * Injectable StripeGateway for tests (11b Slice 2). Defaults to the real
   * SDK-backed gateway built from env in production; when Stripe env is unset
   * the webhook fails closed (every event → 400). Tests pass a FakeStripeGateway.
   */
  stripeGateway?: StripeGateway;
  /**
   * Injectable checkout/coupon gateway for tests (11b Slice 3). Defaults to the
   * same real SDK-backed adapter as {@link stripeGateway} in production; when
   * Stripe env is unset, checkout fails closed (→ 5xx). Tests pass a fake.
   */
  checkoutGateway?: CheckoutGateway;
  /** Injectable config-driven Stripe Price ids for tests (11b Slice 3). */
  checkoutPricing?: CheckoutPriceConfig;
  /**
   * Injectable Customer Portal gateway for tests (11b Slice 4). Defaults to the
   * same real SDK-backed adapter as {@link stripeGateway}; when Stripe env is
   * unset, portal fails closed (→ 5xx). Tests pass a fake.
   */
  portalGateway?: PortalGateway;
  /**
   * Injectable invoice-listing gateway for tests (11b Slice 4). Defaults to the
   * same real SDK-backed adapter as {@link stripeGateway}; when Stripe env is
   * unset, invoice listing fails closed for a subscribed customer (→ 5xx).
   */
  invoiceGateway?: InvoiceGateway;
  /**
   * Injectable reader that resolves a tenant's Stripe customer id from OUR DB
   * (11b Slice 4). Defaults to {@link BillingCustomerRepository}. Tests pass a fake.
   */
  billingCustomerReader?: BillingCustomerReaderPort;
  /**
   * Injectable Price-lookup gateway for tests (#195). Defaults to the same real
   * SDK-backed adapter as {@link stripeGateway}; when Stripe env is unset the
   * pricing use case falls back to the config/env display amounts. Tests pass a fake.
   */
  priceGateway?: PriceGateway;
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
  let chatExtractorOverride: PlanSpecExtractor | undefined;
  let wsRegistry: WsRegistry | undefined;
  let stripeGateway: StripeGateway | undefined;
  let checkoutGateway: CheckoutGateway | undefined;
  let checkoutPricing: CheckoutPriceConfig | undefined;
  let portalGateway: PortalGateway | undefined;
  let invoiceGateway: InvoiceGateway | undefined;
  let billingCustomerReader: BillingCustomerReaderPort | undefined;
  let priceGateway: PriceGateway | undefined;

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
    chatExtractorOverride = opts.chatExtractor;
    wsRegistry = opts.wsRegistry;
    stripeGateway = opts.stripeGateway;
    checkoutGateway = opts.checkoutGateway;
    checkoutPricing = opts.checkoutPricing;
    portalGateway = opts.portalGateway;
    invoiceGateway = opts.invoiceGateway;
    billingCustomerReader = opts.billingCustomerReader;
    priceGateway = opts.priceGateway;
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
  // 12-interactive-text-chat (S2b): Pro-only chat gate + the real extractor.
  // The gate reuses the SAME entitlement reader as every other billing decision
  // (server-side, authContext-scoped, fail-closed). The extractor is the real
  // LangChain-backed `PlanSpecExtractionAdapter` in production — it reads the
  // active provider/model config per turn (same `configRepo` as generation) and
  // owns the LangChain dependency so the route never imports it. Tests inject a
  // deterministic `MockPlanSpecExtractor` (or any fake) via `chatExtractor`; when
  // no override is given AND no LLM key is configured we still default to the
  // Mock so local/dev boots without a provider key behave predictably.
  const chatEntitlement = new ChatEntitlement(billingStateReader);
  const chatExtractor: PlanSpecExtractor =
    chatExtractorOverride ??
    new PlanSpecExtractionAdapter(configRepo, buildExtractionModelFactory());
  await app.register(planRoutes, {
    repo: planRouteRepo,
    generationService: planGenerationService,
    billing: {
      checkAndConsume: (scope, feature, operationKey) =>
        checkAndConsumeQuota.checkAndConsume(scope, feature, operationKey),
    },
    chatEntitlement,
    chatExtractor,
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

  // 11b Slice 3 — checkout. The real SDK adapter (built once from env)
  // implements BOTH the webhook and checkout ports; reuse it for both routes.
  // When Stripe env is unset it is null → checkout fails closed (5xx) via the
  // UnconfiguredCheckoutGateway. Tests inject a fake gateway + Price config.
  const realStripeGateway = createStripeGatewayFromEnv();
  const resolvedCheckoutGateway: CheckoutGateway =
    checkoutGateway ?? realStripeGateway ?? new UnconfiguredCheckoutGateway();
  const resolvedCheckoutPricing: CheckoutPriceConfig =
    checkoutPricing ?? resolveCheckoutPricing();
  const createCheckout = new CreateCheckout(resolvedCheckoutGateway, resolvedCheckoutPricing);

  // FIX 2 (display/charge drift guard): surface a pricing-config
  // inconsistency at boot. Pure + network-free — throws in production
  // (fail-fast on operator misconfiguration), warns otherwise. The displayed
  // price MUST stay in sync with the charged Stripe Price IDs.
  validateBillingPricingConfig(process.env, {
    production: process.env.NODE_ENV === "production",
    warn: (message) => app.log.warn(message),
  });

  // 11b Slice 4 — Customer Portal + invoices. The tenant's Stripe customer id is
  // resolved SERVER-SIDE from OUR DB (BillingCustomerRepository) keyed by the
  // authContext tenant, never from client input. The same real SDK adapter
  // implements the portal + invoice ports; when Stripe env is unset it is null →
  // portal/invoice fail closed via UnconfiguredPortalInvoiceGateway (the invoice
  // use case still returns [] for a never-subscribed tenant before reaching it).
  const resolvedPortalGateway: PortalGateway =
    portalGateway ?? realStripeGateway ?? new UnconfiguredPortalInvoiceGateway();
  const resolvedInvoiceGateway: InvoiceGateway =
    invoiceGateway ?? realStripeGateway ?? new UnconfiguredPortalInvoiceGateway();
  const resolvedBillingCustomerReader: BillingCustomerReaderPort =
    billingCustomerReader ?? new BillingCustomerRepository(database);
  const createPortalSession = new CreatePortalSession(
    resolvedBillingCustomerReader,
    resolvedPortalGateway,
  );
  const listInvoices = new ListInvoices(resolvedBillingCustomerReader, resolvedInvoiceGateway);

  // #195 — the displayed billing prices are sourced from the REAL Stripe Price
  // objects checkout charges (single source of truth), so the UI can never show
  // an amount that differs from what Stripe bills. Cached in-process (GET
  // /billing/pricing does not call Stripe per request); on a live-sourcing
  // failure the use case falls back to the config/env display amounts and warns.
  const resolvedPriceGateway: PriceGateway =
    priceGateway ?? realStripeGateway ?? new UnconfiguredPriceGateway();
  // Source the DISPLAY amounts from the SAME Price ids checkout charges.
  const displayPriceIds = resolveCheckoutPricing();
  const getBillingPricing = new ResolveBillingPricing(
    resolvedPriceGateway,
    { monthly: displayPriceIds.priceMonthly, annual: displayPriceIds.priceAnnual },
    { warn: (message) => app.log.warn(message) },
  );

  await app.register(billingRoutes, {
    setMemberAllocation: new SetMemberAllocation(billingAdminRepo),
    getTenantUsage: new GetTenantUsage(billingAdminRepo),
    getBillingVisibility: new GetBillingVisibility(billingVisibilityRepo),
    createCheckout,
    createPortalSession,
    listInvoices,
    getBillingPricing,
    // 11b Slice 4, 4R FIX 1 — Customer Portal + invoices are owner-only. Reuses
    // the SAME billingAdminRepo instance (and its loadActorMembership) already
    // wired above for setMemberAllocation/getTenantUsage — one owner check,
    // one repository, no duplicated authorization logic.
    checkBillingOwnership: billingAdminRepo,
  });

  // 11b Slice 2 — Stripe webhook (POST /billing/webhook). Registered as its own
  // ENCAPSULATED plugin so the raw-body content parser it installs is scoped to
  // that route only (every other JSON route keeps the default parser). The
  // route is UNAUTHENTICATED: the Stripe signature is the auth. The gateway is
  // injectable for tests (FakeStripeGateway); in production it is the real
  // SDK-backed gateway from env, or a fail-closed gateway when Stripe env is
  // unset (so an unconfigured deploy can never grant Pro from a webhook).
  const resolvedStripeGateway: StripeGateway =
    stripeGateway ?? realStripeGateway ?? new UnconfiguredStripeGateway();
  const stripeEventStore = new StripeEventStoreRepository(database);
  const processStripeWebhook = new ProcessStripeWebhook(resolvedStripeGateway, stripeEventStore);
  await app.register(stripeWebhookRoutes, { processWebhook: processStripeWebhook });

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
/**
 * Resolve the config-driven Stripe Price ids for checkout (11b Slice 3). Reads
 * `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` from env; missing values fall
 * back to empty strings so the app still boots (checkout then fails closed once
 * the gateway rejects the empty price). Prices are config, never hardcoded.
 */
export function resolveCheckoutPricing(
  env: NodeJS.ProcessEnv = process.env
): CheckoutPriceConfig {
  return {
    priceMonthly: env.STRIPE_PRICE_MONTHLY ?? "",
    priceAnnual: env.STRIPE_PRICE_ANNUAL ?? "",
  };
}

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
