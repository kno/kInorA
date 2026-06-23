import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import { createDbClient } from "./db/client.js";
import { AuthService, AuthError } from "./auth/service.js";
import { authPlugin } from "./auth/plugin.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoute } from "./routes/health.js";

/**
 * Build the Fastify application with all plugins, routes, and error handlers.
 *
 * Accepts an optional db override for testing with mock or test databases.
 * In production, called without arguments — a real db client is created from
 * environment variables.
 */
export async function buildApp(db?: Database): Promise<FastifyInstance> {
  const database = db ?? createDbClient().db;
  const app = Fastify();

  // Validation errors → 422, Auth errors → 401, everything else → 500.
  // Must be set before registering route plugins so child scopes inherit.
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

  return app;
}