import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import { createDbClient } from "./db/client.js";
import { AuthService, AuthError } from "./auth/service.js";
import { authPlugin } from "./auth/plugin.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoute } from "./routes/health.js";
import { socialRoutes } from "./routes/social.js";
import { planRoutes } from "./routes/plan.js";
import { WorkoutPlanRepository } from "./db/repositories/workout-plan.js";
import { PlanSpecRepository } from "./db/repositories/plan-spec.js";
import { PlanGenerationService } from "./ai/generation-service.js";
import { OpenRouterPlanGenerator } from "./ai/openrouter-generator.js";
import type { PlanGenerator } from "./ai/port.js";
import type { SocialAuthService } from "./auth/social.js";

export interface BuildAppOptions {
  db?: Database;
  socialAuthService?: SocialAuthService;
  /**
   * Injectable PlanGenerator for tests.
   * Defaults to OpenRouterPlanGenerator in production.
   * Pass a MockPlanGenerator to avoid LLM calls in tests.
   */
  planGenerator?: PlanGenerator;
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

  if (
    dbOrOptions &&
    typeof dbOrOptions === "object" &&
    !("select" in dbOrOptions) &&
    !("insert" in dbOrOptions)
  ) {
    // Options-bag form
    const opts = dbOrOptions as BuildAppOptions;
    database = opts.db ?? createDbClient().db;
    socialAuthService = opts.socialAuthService;
    planGenerator = opts.planGenerator;
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

  // Health routes
  await app.register(healthRoute);

  // Auth routes (register + login)
  await app.register(authRoutes, { authService: new AuthService(database) });

  // Social login routes (OIDC provider abstraction + Google)
  if (socialAuthService) {
    await app.register(socialRoutes, { socialAuthService });
  }

  // Build generation DI graph.
  // OpenRouterPlanGenerator is constructed here (lazy — no key required at build time).
  // In tests, callers pass planGenerator: new MockPlanGenerator() via BuildAppOptions.
  const generator = planGenerator ?? new OpenRouterPlanGenerator();
  const workoutPlanRepo = new WorkoutPlanRepository(database);
  const planSpecRepo = new PlanSpecRepository(database);
  const planGenerationService = new PlanGenerationService(generator, planSpecRepo, workoutPlanRepo);

  // Plan wizard + generation routes (draft, promote, confirm, regenerate, fetch)
  await app.register(planRoutes, {
    db: database,
    generationService: planGenerationService,
    planRepo: workoutPlanRepo,
    specRepo: planSpecRepo,
  });

  return app;
}