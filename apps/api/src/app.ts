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
import { exerciseCatalogRoutes } from "./routes/exercise-catalog.js";
import { wsRoutes } from "./routes/ws.js";
import { WorkoutPlanRepository } from "./db/repositories/workout-plan.js";
import { PlanSpecRepository } from "./db/repositories/plan-spec.js";
import { PlanDraftRepository } from "./db/repositories/plan-draft.js";
import { AiProviderConfigRepository } from "./db/repositories/ai-provider-config.js";
import { PlanGenerationService } from "./ai/generation-service.js";
import { warnIfAiConfigMissing } from "./ai/openrouter-generator.js";
import { DynamicPlanGenerator } from "./ai/dynamic-generator.js";
import { buildAdapters } from "./ai/adapter-factory.js";
import {
  buildLangfuseCallbackHandler,
  flushLangfuseHandlerOnClose,
} from "./ai/langfuse-handler.js";
import { buildLangfusePromptGateway } from "./ai/langfuse-prompt-gateway.js";
import { ResolvePrompt, resolvePromptCacheTtlMs } from "./ai/prompt-provider.js";
import { adminAiConfigRoutes } from "./routes/admin-ai-config.js";
import { adminTierOverrideRoutes } from "./routes/admin-tier-override.js";
import { TierOverrideAdminRepository } from "./db/repositories/tier-override-admin.js";
import { adminTenantsRoutes } from "./routes/admin-tenants.js";
import { AdminTenantsRepository } from "./db/repositories/admin-tenants.js";
import { AdminStatsRepository } from "./db/repositories/admin-stats.js";
import { adminLogsRoutes } from "./routes/admin-logs.js";
import { adminStatsRoutes } from "./routes/admin-stats.js";
import { ObservabilityEventsRepository } from "./db/repositories/observability-events.js";
import {
  DefaultObservabilityLogger,
  type ObservabilityLogger,
} from "./observability/event-logger.js";
import { userProfileRoutes } from "./routes/user-profile.js";
import { userWeightEntryRoutes } from "./routes/user-weight-entry.js";
import { userMemoryRoutes } from "./routes/user-memories.js";
import { userPreferencesRoutes } from "./routes/user-preferences.js";
import { trainerRoutes } from "./routes/trainer.js";
import { TrainerAssignmentRepository } from "./db/repositories/trainer-assignment.js";
import { brandingRoutes } from "./routes/branding.js";
import { publicBrandingRoutes } from "./routes/public-branding.js";
import { TenantBrandingRepository } from "./db/repositories/tenant-branding.js";
import { LocalStorageAdapter } from "./storage/local-storage-adapter.js";
import type { ObjectStoragePort } from "./storage/object-storage-port.js";
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
import { UserWeightEntryRepository } from "./db/repositories/user-weight-entry.js";
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
import type { SpeechTranscriber } from "./ai/speech-transcriber-port.js";
import type { SpeechSynthesizer } from "./ai/speech-synthesizer-port.js";
import { buildTranscriber, buildSynthesizer } from "./ai/voice-provider-factory.js";
import { MockSpeechTranscriber } from "./ai/mock-speech-transcriber.js";
import { MockSpeechSynthesizer } from "./ai/mock-speech-synthesizer.js";
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
import { buildSeatSyncService } from "./billing/seat-sync-factory.js";
import { CreateCheckout, type CheckoutPriceConfig } from "./billing/create-checkout.js";
import { ResolveBillingPricing } from "./billing/billing-pricing.js";
import {
  CreatePortalSession,
  type BillingCustomerReaderPort,
} from "./billing/create-portal-session.js";
import { ListInvoices } from "./billing/list-invoices.js";
import {
  resolveTrainerSeatPriceIds,
  validateBillingPricingConfig,
} from "./billing/pricing-config.js";
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
   * Defaults to DynamicPlanGenerator (over the adapter-factory provider map)
   * in production.
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
   * Injectable SpeechTranscriber for the voice transcribe endpoint (13, A2).
   * Defaults to the real `OpenAIAudioAdapter` (whisper-1, dedicated OPENAI_API_KEY
   * read at call time) in production. Pass a `MockSpeechTranscriber` (or any fake)
   * to avoid network calls in tests.
   */
  transcriber?: SpeechTranscriber;
  /**
   * Injectable SpeechSynthesizer for the voice speech endpoint (13, A3).
   * Defaults to the real `OpenAIAudioAdapter` (gpt-4o-mini-tts, dedicated
   * OPENAI_API_KEY read at call time) in production. Pass a
   * `MockSpeechSynthesizer` (or any fake) to avoid network calls in tests.
   */
  synthesizer?: SpeechSynthesizer;
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
  /**
   * Injectable `ObjectStoragePort` for tests (16a-v3-gym-white-label, Slice
   * 2). Defaults to the real disk-backed `LocalStorageAdapter` (base path
   * from `STORAGE_LOCAL_DIR` env) in production. Tests pass a fake storage
   * double to avoid real filesystem writes.
   */
  objectStorage?: ObjectStoragePort;
  /**
   * Injectable observability logger for tests (#310). Defaults to the
   * DB-backed `DefaultObservabilityLogger` (persists to `observability_events`
   * AND emits a pino line) in production. Tests pass a spy/fake to assert
   * curated events without a real Postgres.
   */
  observabilityLogger?: ObservabilityLogger;
}

/**
 * Build the Fastify application with all plugins, routes, and error handlers.
 *
 * Accepts an optional db override for testing with mock or test databases,
 * an optional socialAuthService for social login routes, and an optional
 * planGenerator for injecting a mock in tests (avoids LLM calls).
 *
 * In production, called from index.ts which creates all dependencies.
 * Every provider adapter built by `buildAdapters()` is constructed lazily —
 * none require their API key at construction time (only at generate() call
 * time), so the API starts cleanly even when AI env vars are unset.
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
  let transcriberOverride: SpeechTranscriber | undefined;
  let synthesizerOverride: SpeechSynthesizer | undefined;
  let wsRegistry: WsRegistry | undefined;
  let stripeGateway: StripeGateway | undefined;
  let checkoutGateway: CheckoutGateway | undefined;
  let checkoutPricing: CheckoutPriceConfig | undefined;
  let portalGateway: PortalGateway | undefined;
  let invoiceGateway: InvoiceGateway | undefined;
  let billingCustomerReader: BillingCustomerReaderPort | undefined;
  let priceGateway: PriceGateway | undefined;
  let objectStorage: ObjectStoragePort | undefined;
  let observabilityLoggerOverride: ObservabilityLogger | undefined;

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
    transcriberOverride = opts.transcriber;
    synthesizerOverride = opts.synthesizer;
    wsRegistry = opts.wsRegistry;
    stripeGateway = opts.stripeGateway;
    checkoutGateway = opts.checkoutGateway;
    checkoutPricing = opts.checkoutPricing;
    portalGateway = opts.portalGateway;
    invoiceGateway = opts.invoiceGateway;
    billingCustomerReader = opts.billingCustomerReader;
    priceGateway = opts.priceGateway;
    objectStorage = opts.objectStorage;
    observabilityLoggerOverride = opts.observabilityLogger;
  } else {
    // Legacy 2-argument form: (db?, socialAuthService?)
    database = (dbOrOptions as Database | undefined) ?? createDbClient().db;
    socialAuthService = socialAuthServiceLegacy;
  }

  // Enable the request/error logger so route-level `request.log.warn/error`
  // (rate-limit throttling, transcription/synthesis failures, etc.) are actually
  // emitted — a bare `Fastify()` defaults to `logger: false`, silently dropping
  // every log and leaving prod failures invisible. Off under tests to keep the
  // vitest output clean; level overridable via API_LOG_LEVEL.
  const app = Fastify({
    logger:
      process.env.NODE_ENV === "test"
        ? false
        : { level: process.env.API_LOG_LEVEL ?? "info" },
  });

  // Observability logging (#310, Slice 1). The DB-backed default persists to
  // `observability_events` AND emits a matching pino line via `app.log` (the
  // hybrid — persistence never replaces stdout logs). Every recordEvent is
  // fire-and-forget + fail-safe, so a failed observability write can never break
  // a request. Tests inject a spy via BuildAppOptions.observabilityLogger.
  const observabilityRepo = new ObservabilityEventsRepository(database);
  const observabilityLogger: ObservabilityLogger =
    observabilityLoggerOverride ?? new DefaultObservabilityLogger(observabilityRepo, app.log);

  // Validation errors → 422, Auth errors → 401, social auth errors → 400,
  // everything else → 500. Must be set before registering route plugins so
  // child scopes inherit.
  app.setErrorHandler((error: unknown, request, reply) => {
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
    // #310: record the unhandled failure with request/tenant context — ids +
    // route + error NAME ONLY, never the message/stack or any body content.
    observabilityLogger.recordEvent({
      tenantId: request.authContext?.tenantId ?? null,
      actorUserId: request.authContext?.userId ?? null,
      level: "error",
      event: "request.error",
      metadata: {
        route: resolveErrorRoute(request.routeOptions?.url, request.url),
        statusCode: 500,
        errName: error instanceof Error ? error.name : "UnknownError",
      },
    });
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
  await app.register(authRoutes, {
    authService: new AuthService(database, observabilityLogger),
  });

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
  // langfuse-prompt-management (slice A1) — built ONCE per app instance and
  // injected into every attachment site (here, `invokeChain`'s choke point;
  // slice A2 extends this to the extraction adapter). `null` when Langfuse
  // credentials are absent or construction fails: the generate path stays
  // byte-identical to today, no `callbacks` key is ever added.
  const langfuseHandler = buildLangfuseCallbackHandler({
    warn: (message) => app.log.warn(message),
  });
  // langfuse-prompt-management (slice B2) — built ONCE alongside the tracing
  // handler and threaded through the SAME `aiTracingDeps` bag. `gateway` is
  // `null` when Langfuse credentials are absent or construction fails, in
  // which case `ResolvePrompt` always falls back to the compiled-in local
  // template with reason `no_credentials` — no remote fetch is ever
  // attempted, and generation/chat are unaffected either way.
  const langfusePromptGateway = buildLangfusePromptGateway();
  const resolvePrompt = new ResolvePrompt(langfusePromptGateway, {
    cacheTtlMs: resolvePromptCacheTtlMs(process.env),
    warn: (reason, promptName, errorName) =>
      app.log.warn(
        { reason, promptName, errorName },
        "[prompt-provider] falling back to the compiled-in local template",
      ),
  });
  const aiTracingDeps = { handler: langfuseHandler, prompts: resolvePrompt };
  const generator =
    planGenerator ?? new DynamicPlanGenerator(configRepo, buildAdapters(aiTracingDeps));
  // Best-effort flush on shutdown: never throws, never blocks Fastify's close
  // sequence. See `flushLangfuseHandlerOnClose` for the swallow semantics.
  app.addHook("onClose", async () => {
    await flushLangfuseHandlerOnClose(langfuseHandler, (payload, message) =>
      app.log.warn(payload, message),
    );
  });
  // Constructed here (ahead of their route-registration use further below and
  // of `WorkoutSessionRepository`) so `PlanGenerationService` can read the
  // current profile/weight state when attaching `bodyProfile` to the
  // generation prompt (17c-profile-body-metrics, PR 3), and so
  // `WorkoutSessionRepository` can resolve `resolvedBodyweightKg` for volume
  // (17c-profile-body-metrics, PR 4). Reused, not re-instantiated, at their
  // original registration sites.
  const userProfileRepo = new UserProfileRepository(database);
  const userWeightEntryRepo = new UserWeightEntryRepository(database);

  const workoutPlanRepo = new WorkoutPlanRepository(database);
  const workoutSessionRepo = new WorkoutSessionRepository(database, {
    listAllForUser: (userId: string) => userWeightEntryRepo.listAllForUser(userId),
  });
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
    memoryEntitlement,
    observabilityLogger,
    { findByUserId: (id: string) => userProfileRepo.findByUserId(id) },
    { list: (id: string) => userWeightEntryRepo.list(id) }
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
  // 15a-v2-trainer-account-access, Slice 4 — constructed here (ahead of
  // `planRoutes` registration below) so the SAME instance is reused by the
  // trainer invite/list routes further down; `entitlementReader` reuses the
  // SAME `BillingStateReaderRepository` instance every other billing decision
  // in this file uses.
  const trainerAssignmentRepo = new TrainerAssignmentRepository(database);
  // 12-interactive-text-chat (S2b): Pro-only chat gate + the real extractor.
  // The gate reuses the SAME entitlement reader as every other billing decision
  // (server-side, authContext-scoped, fail-closed). PRODUCTION ALWAYS uses the
  // real LangChain-backed `PlanSpecExtractionAdapter` — it reads the active
  // provider/model config per turn (same `configRepo` as generation) and owns
  // the LangChain dependency so the route never imports it. There is NO silent
  // Mock fallback: if no LLM provider key is configured, the adapter is still
  // constructed (keys are read at call time, matching every other adapter in
  // this file) and a live chat turn will fail at call time with the provider's
  // own error, surfaced to the client as the generic terminal `error` event.
  // Tests inject a deterministic `MockPlanSpecExtractor` (or any fake) via the
  // `chatExtractor` BuildAppOptions override.
  const chatEntitlement = new ChatEntitlement(billingStateReader);
  const chatExtractor: PlanSpecExtractor =
    chatExtractorOverride ??
    new PlanSpecExtractionAdapter(configRepo, buildExtractionModelFactory(), aiTracingDeps);
  // 13-v1.1-interactive-voice-chat (A2): speech-to-text for the voice companion.
  // PRODUCTION uses the real OpenAI-audio adapter (whisper-1); like every other
  // adapter it reads the dedicated OPENAI_API_KEY at CALL time, so the app boots
  // cleanly with the key unset and only a live transcribe call would fail (mapped
  // to a generic 502). Tests inject a deterministic `MockSpeechTranscriber` via
  // the `transcriber` BuildAppOptions override. The transcribe route is
  // registered only when this port is present (it always is here).
  // 13-v1.1-interactive-voice-chat (A2 STT + A3 TTS), now provider-abstracted
  // (feat/voice-provider-adapters): STT and TTS providers are selected
  // INDEPENDENTLY via env (`VOICE_STT_PROVIDER` = openai|google, default openai;
  // `VOICE_TTS_PROVIDER` = openai, default openai) through the voice provider
  // factory. Every adapter reads its dedicated API key at CALL time, so the app
  // boots cleanly with keys unset and only a live call fails (mapped to a
  // generic 502). Tests inject deterministic Mocks via the
  // `transcriber`/`synthesizer` BuildAppOptions overrides.
  //
  // Local-dev escape hatch: with no provider key available, `VOICE_USE_MOCK=1`
  // swaps in the deterministic Mock adapters so the voice UI flow (mic capture →
  // transcribe → extraction → draft) can be exercised without any provider. The
  // mock synthesizer returns non-mp3 marker bytes, so no real audio plays back.
  // Test overrides still win; production leaves the flag unset and uses the
  // factory-selected real adapters.
  const useVoiceMock = process.env["VOICE_USE_MOCK"] === "1";
  const transcriber: SpeechTranscriber =
    transcriberOverride ?? (useVoiceMock ? new MockSpeechTranscriber() : buildTranscriber());
  const synthesizer: SpeechSynthesizer =
    synthesizerOverride ?? (useVoiceMock ? new MockSpeechSynthesizer() : buildSynthesizer());
  // A3: resolve the caller's TTS opt-out from user_preferences. Built here (the
  // repo is reused below for the /user-preferences routes) and read ONLY for the
  // authenticated userId inside the route. `null` = enabled (opt-out default ON).
  const userPreferencesRepo = new UserPreferencesRepository(database);
  const voicePreferences = {
    findTtsEnabled: async (id: string) =>
      (await userPreferencesRepo.findByUserId(id))?.ttsEnabled ?? null,
  };
  await app.register(planRoutes, {
    repo: planRouteRepo,
    generationService: planGenerationService,
    billing: {
      checkAndConsume: (scope, feature, operationKey) =>
        checkAndConsumeQuota.checkAndConsume(scope, feature, operationKey),
    },
    // 14a-v1.1 Slice B1 — the adherence-adaptation confirm route re-derives the
    // caller's CURRENT recommendation via the SAME dashboard read that backs
    // GET /progress/dashboard (reusing the one WorkoutSessionRepository instance).
    adherenceReader: workoutSessionRepo,
    chatEntitlement,
    chatExtractor,
    transcriber,
    synthesizer,
    voicePreferences,
    // 15a-v2-trainer-account-access, Slice 4 — enables
    // `POST /clients/:clientUserId/plan-specs`. Reuses the exact same
    // `resolveAuthorizedOwner` deps every trainer-scoped route uses.
    trainerAccess: {
      assignmentRepo: trainerAssignmentRepo,
      entitlementReader: billingStateReader,
      observability: observabilityLogger,
    },
  });

  await app.register(workoutSessionRoutes, {
    repo: workoutSessionRepo,
  });

  // Dashboard progress summary (09c-v1-progress-dashboard-stats, Slice 2).
  // Reuses the same WorkoutSessionRepository instance (getDashboardSummary
  // is one more bounded read method alongside listSessionHistory).
  await app.register(progressRoutes, {
    repo: workoutSessionRepo,
  });

  // Exercise library — GET /exercises/catalog(/:id|/facets), requireAuth().
  // Static, read-only reference data bundled in `@kinora/exercise-catalog`:
  // no repository, no tenant scoping and no options to compose here.
  await app.register(exerciseCatalogRoutes);

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

  // Admin tier-override routes — POST /admin/tenants/:tenantId/tier-override
  // (+ /revoke), superadmin-gated grant/revoke of the trainer/gym tier
  // (16d-admin-tier-provisioning). Route port composes the SAME adminUserRepo
  // (findUserById) with a dedicated TierOverrideAdminRepository so the route
  // stays free of any DB-layer import.
  const tierOverrideAdminRepo = new TierOverrideAdminRepository(database, observabilityLogger);
  await app.register(adminTierOverrideRoutes, {
    repo: {
      findUserById: (id) => adminUserRepo.findById(id),
      loadTenant: (tenantId) => tierOverrideAdminRepo.loadTenant(tenantId),
      loadActiveOverride: (tenantId, now) => tierOverrideAdminRepo.loadActiveOverride(tenantId, now),
      grantTierOverride: (input) => tierOverrideAdminRepo.grantTierOverride(input),
      revokeTierOverride: (input) => tierOverrideAdminRepo.revokeTierOverride(input),
    },
  });

  // Read-only admin tenant directory routes — GET /admin/tenants (search) and
  // GET /admin/tenants/:tenantId/tier-override (current provisioning state)
  // (GH #307, superadmin-gated). Reuses the SAME adminUserRepo (findUserById)
  // plus a dedicated read-only AdminTenantsRepository, keeping the route free
  // of any DB-layer import.
  const adminTenantsRepo = new AdminTenantsRepository(database);
  await app.register(adminTenantsRoutes, {
    repo: {
      findUserById: (id) => adminUserRepo.findById(id),
      searchTenants: (query) => adminTenantsRepo.searchTenants(query),
      loadProvisioningState: (tenantId) => adminTenantsRepo.loadProvisioningState(tenantId),
    },
  });

  // Superadmin observability log query API — GET /admin/logs (#310, Slice 1,
  // requireAuth() + requireAdmin). Reuses the SAME adminUserRepo (findUserById)
  // for the admin gate plus the read side of the observability repository
  // constructed above (same instance the DEFAULT logger writes through), so the
  // route stays free of any DB-layer import.
  await app.register(adminLogsRoutes, {
    repo: {
      findUserById: (id) => adminUserRepo.findById(id),
      queryEvents: (filters) => observabilityRepo.queryEvents(filters),
    },
  });

  // Superadmin platform-statistics API — GET /admin/stats (#309, read-only,
  // requireAuth() + requireAdmin). Reuses the SAME adminUserRepo (findUserById)
  // for the admin gate plus a dedicated read-only AdminStatsRepository that
  // computes cross-tenant AGGREGATES ONLY (scalar counts / enum-keyed tallies —
  // never a per-tenant/per-user record), keeping the route free of any DB-layer
  // import.
  const adminStatsRepo = new AdminStatsRepository(database);
  await app.register(adminStatsRoutes, {
    repo: {
      findUserById: (id) => adminUserRepo.findById(id),
      getPlatformStats: () => adminStatsRepo.getPlatformStats(),
    },
  });

  // User profile + preferences routes (10a-user-memory-structured, Slice 2).
  // User-scoped tables (keyed by `userId`, no tenant column) — isolation is
  // enforced by the single-column predicate the repos already use. The route
  // ports are built here from the concrete repos + UserRepository (for the
  // lazy-provision email lookup) so the route files stay free of any DB-layer
  // import. `adminUserRepo` is reused for the email lookup.
  // `userProfileRepo` is constructed above (reused by PlanGenerationService's
  // body-profile attachment) — do not re-instantiate.
  // `userPreferencesRepo` is constructed above (reused by the voice speech
  // route's TTS opt-out reader) — do not re-instantiate.
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
  // Bodyweight series (17c-profile-body-metrics, PR 2). User-scoped, no
  // tenant column — reuses the same requireAuth() isolation guarantee as
  // userProfileRoutes. `userWeightEntryRepo` is constructed above (reused by
  // PlanGenerationService's body-profile attachment) — do not re-instantiate.
  await app.register(userWeightEntryRoutes, { repo: userWeightEntryRepo });
  await app.register(userPreferencesRoutes, {
    repo: userPreferencesRouteRepo,
  });
  await app.register(userMemoryRoutes, { service: userMemoryService });

  // Trainer invite/assignment/list-clients routes (15a-v2-trainer-account-
  // access, Slice 3). `entitlementReader` reuses the SAME
  // `BillingStateReaderRepository` instance every other billing decision in
  // this file uses — one entitlement reader, no duplicated wiring.
  const trainerMembershipRepo = new MembershipRepository(database);

  // 16c-v3-b2b-seat-billing Slice C — seat-sync wiring. The trigger fires on
  // the accept/revoke transitions in `trainerRoutes` below, so the service is
  // constructed here (ahead of that registration). `realStripeGateway` is the
  // single SDK adapter built once from env (reused by the checkout/portal/
  // webhook wiring further down); when Stripe env is unset it is null and the
  // factory's fail-closed fallback gateway is used — never actually reached,
  // because no tenant holds a `stripe_subscription_id` on an unconfigured
  // deploy, so `syncSeats` short-circuits to a no-op before any outbound call.
  //
  // Built via the SAME `buildSeatSyncService` factory the standalone cron
  // entrypoint (`scripts/reconcile-seats.mjs`) uses, so the running server and
  // the scheduled reconcile sweep can never drift from each other's wiring
  // (flag read, seat-price guard, fail-closed fallback). `trainerAssignmentRepo`
  // and `realStripeGateway` are reused (both constructed once, elsewhere in
  // this file, for other routes) rather than rebuilt.
  const realStripeGateway = createStripeGatewayFromEnv();
  const seatSyncService = buildSeatSyncService({
    database,
    trainerAssignmentRepo,
    stripeGateway: realStripeGateway ?? undefined,
    onError: (tenantId, error) =>
      app.log.warn(
        { tenantId, err: error instanceof Error ? error.message : String(error) },
        "seat-sync outbound Stripe update failed; drift will be healed by the reconcile sweep",
      ),
  });

  // `trainerAssignmentRepo` is constructed above (reused by `planRoutes`'
  // `trainerAccess` option) — do not re-instantiate.
  await app.register(trainerRoutes, {
    assignmentRepo: trainerAssignmentRepo,
    membershipRepo: trainerMembershipRepo,
    userRepo: adminUserRepo,
    entitlementReader: billingStateReader,
    // 16c Slice C — fire seat-sync on accept (invited→active) + revoke
    // (active→revoked), never on invite/create.
    seatSync: seatSyncService,
    // 15b-v2-trainer-dashboard-branding, Phase S1 — enables
    // `GET /trainer/clients/:clientUserId/dashboard`. Reuses the SAME
    // `WorkoutSessionRepository` instance every other progress read uses.
    dashboardRepo: workoutSessionRepo,
    // 15b-v2-trainer-dashboard-branding, Phase S2 (#283) — enables
    // `GET /me/trainer-plan`. Reuses the SAME `WorkoutPlanRepository`
    // instance every other plan read uses.
    planRepo: workoutPlanRepo,
    // 15b-v2-trainer-dashboard-branding, Phase S5 — threads `branding` onto
    // the `GET /me/trainer-plan` response. Reuses the SAME
    // `PlanSpecRepository` instance every other confirmed-spec read uses.
    specRepo: planSpecRepo,
    // #310 — records `owner_access.denied` on trainer-authorization denials.
    observability: observabilityLogger,
  });

  // Gym white-label branding — logo upload + serve routes
  // (16a-v3-gym-white-label, Slice 2). `POST /branding/logo` is gated by
  // `requireAuth()` + `assertGymEntitled`, reusing the SAME
  // `billingStateReader` instance every other billing decision in this file
  // uses. `LocalStorageAdapter` is the production `ObjectStoragePort`
  // implementation (disk-backed, base path from `STORAGE_LOCAL_DIR` env);
  // tests inject a fake via the `objectStorage` BuildAppOptions override.
  const resolvedObjectStorage: ObjectStoragePort = objectStorage ?? new LocalStorageAdapter();
  const tenantBrandingRepo = new TenantBrandingRepository(database);
  await app.register(brandingRoutes, {
    repo: tenantBrandingRepo,
    storage: resolvedObjectStorage,
    entitlementReader: billingStateReader,
  });

  // Gym white-label PUBLIC branding read-by-slug (16a-v3-gym-white-label,
  // Slice 3). Deliberately registered as a SEPARATE plugin from
  // `brandingRoutes` above (no auth preHandler anywhere on its path) and
  // reuses the SAME `TenantBrandingRepository` instance constructed above —
  // no second repository instantiation needed.
  await app.register(publicBrandingRoutes, { repo: tenantBrandingRepo });

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
  // `realStripeGateway` is constructed once above (seat-sync wiring) and reused
  // here — the single SDK adapter implements every Stripe port.
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
  const processStripeWebhook = new ProcessStripeWebhook(
    resolvedStripeGateway,
    stripeEventStore,
    observabilityLogger,
  );
  await app.register(stripeWebhookRoutes, { processWebhook: processStripeWebhook });
  // Public reachability (prod): the web reverse-proxy only forwards `/api/:path*`
  // to the api (apps/web/next.config.ts rewrite), while the api mounts every
  // route unprefixed — so Stripe could NOT reach `/billing/webhook` from outside
  // the internal network. Register the webhook ALSO under `/api` so
  // `https://<host>/api/billing/webhook` reaches it (mirrors the `/api/health`
  // dual-registration in health.ts). Each registration is its own encapsulated
  // scope with its own raw-body content-type parser.
  await app.register(stripeWebhookRoutes, {
    prefix: "/api",
    processWebhook: processStripeWebhook,
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
/**
 * Resolve the config-driven Stripe Price ids for checkout (11b Slice 3). Reads
 * `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` from env; missing values fall
 * back to empty strings so the app still boots (checkout then fails closed once
 * the gateway rejects the empty price). Prices are config, never hardcoded.
 */
/**
 * Resolve the route label recorded on `request.error` observability events
 * (global error handler). Prefers the matched route PATTERN
 * (`request.routeOptions.url`, e.g. `/plans/:id`) which never carries a query
 * string. Falls back to the raw request URL only when no route matched
 * (`routeOptions` undefined) — in that case the query string is stripped so a
 * token/id passed via `?...` is never persisted in `observability_events`.
 */
export function resolveErrorRoute(routeOptionsUrl: string | undefined, requestUrl: string): string {
  return routeOptionsUrl ?? requestUrl.split("?")[0]!;
}

export function resolveCheckoutPricing(
  env: NodeJS.ProcessEnv = process.env
): CheckoutPriceConfig {
  return {
    priceMonthly: env.STRIPE_PRICE_MONTHLY ?? "",
    priceAnnual: env.STRIPE_PRICE_ANNUAL ?? "",
    // 16c v3 Slice E — additive, optional "Trainer Seat" prices. `undefined`
    // when `STRIPE_PRICE_TRAINER_SEAT_MONTHLY`/`_ANNUAL` are unset (today, in
    // every deployed env), so the Pro checkout path above is unaffected.
    ...resolveTrainerSeatPriceIds(env),
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
