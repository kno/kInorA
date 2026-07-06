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
import { wsRoutes } from "./routes/ws.js";
import { WorkoutPlanRepository } from "./db/repositories/workout-plan.js";
import { PlanSpecRepository } from "./db/repositories/plan-spec.js";
import { AiProviderConfigRepository } from "./db/repositories/ai-provider-config.js";
import { PlanGenerationService } from "./ai/generation-service.js";
import { warnIfAiConfigMissing } from "./ai/openrouter-generator.js";
import { DynamicPlanGenerator } from "./ai/dynamic-generator.js";
import { buildAdapters } from "./ai/adapter-factory.js";
import { adminAiConfigRoutes } from "./routes/admin-ai-config.js";
import { WsRegistry } from "./ws/registry.js";
import type { PlanGenerator } from "./ai/port.js";
import type { SocialAuthService } from "./auth/social.js";
import { WorkoutSessionRepository } from "./db/repositories/workout-session.js";

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

  // Auth routes (register + login)
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
  const planGenerationService = new PlanGenerationService(
    generator,
    planSpecRepo,
    workoutPlanRepo,
    registry
  );

  // Plan wizard + generation routes (draft, promote, confirm, regenerate, fetch)
  await app.register(planRoutes, {
    db: database,
    generationService: planGenerationService,
    planRepo: workoutPlanRepo,
    specRepo: planSpecRepo,
  });

  await app.register(workoutSessionRoutes, {
    db: database,
    repo: workoutSessionRepo,
  });

  // Admin AI config routes — GET/PUT /admin/ai-config (requireAuth + requireAdmin).
  // Uses the same configRepo instance that powers DynamicPlanGenerator.
  await app.register(adminAiConfigRoutes, { db: database, configRepo });

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
  await app.register(wsRoutes, {
    registry,
    db: database,
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
