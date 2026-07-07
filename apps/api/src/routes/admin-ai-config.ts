import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { buildRequireAdmin } from "../auth/require-admin.js";

/**
 * Valid provider identifiers — must match the aiProviderEnum in schema.ts.
 */
const VALID_PROVIDERS = ["openrouter", "openai", "anthropic", "google", "opencode-go"] as const;

/**
 * Zod schema for the PUT /admin/ai-config body.
 * `provider` must be a known enum value. `model` must be a non-empty string.
 * Zod produces a ZodError on failure which Fastify maps → 422 via the error handler.
 */
const upsertBodySchema = z.object({
  provider: z.enum(VALID_PROVIDERS),
  model: z.string().min(1),
});

/**
 * Route port for the admin AI-config endpoints. Exposes what buildRequireAdmin
 * needs (findUserById) plus the config read/write operations. The concrete
 * adapter (UserRepository + AiProviderConfigRepository) is built in app.ts so
 * this route never imports the DB layer.
 */
export interface AdminAiConfigRouteRepo {
  /** Feeds buildRequireAdmin via { findById: repo.findUserById }. */
  findUserById(id: string): Promise<{ id: string; isAdmin: boolean } | null>;
  getActiveConfig(): Promise<{ provider: string; model: string; updatedAt: Date } | null>;
  upsertConfig(
    provider: string,
    model: string
  ): Promise<{ provider: string; model: string; updatedAt: Date }>;
}

export interface AdminAiConfigRoutesOptions {
  repo: AdminAiConfigRouteRepo;
}

/**
 * Admin AI config routes.
 *
 * All routes require:
 *   1. requireAuth()    — rejects with 401 if no session is present
 *   2. requireAdmin     — rejects with 403 if the user is not is_admin=true
 *
 * Security: is_admin is read from the DB by userId; never from the request body or token.
 *
 * Routes:
 *   GET  /admin/ai-config  → return active config (or null)
 *   PUT  /admin/ai-config  → validate + upsert config
 */
export const adminAiConfigRoutes: FastifyPluginAsync<AdminAiConfigRoutesOptions> = async (
  fastify,
  options
) => {
  const { repo } = options;

  const requireAdmin = buildRequireAdmin({ findById: repo.findUserById });

  // GET /admin/ai-config
  // SC-01: no token → 401 (via requireAuth)
  // SC-02: non-admin → 403 (via requireAdmin)
  // SC-03: admin → 200 { provider, model, updatedAt }
  fastify.get(
    "/admin/ai-config",
    { preHandler: [requireAuth(), requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const config = await repo.getActiveConfig();
      if (!config) {
        return reply.code(200).send(null);
      }
      return reply.code(200).send({
        provider: config.provider,
        model: config.model,
        updatedAt: config.updatedAt.toISOString(),
      });
    }
  );

  // PUT /admin/ai-config
  // SC-04: unknown provider → 422
  // SC-05: valid payload → 200 { provider, model, updatedAt }
  // SC-06: non-admin → 403
  fastify.put(
    "/admin/ai-config",
    { preHandler: [requireAuth(), requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Validate body with zod — throws ZodError → Fastify error handler → 422
      const result = upsertBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(422).send({ error: "Validation Error" });
      }

      const { provider, model } = result.data;
      const updated = await repo.upsertConfig(provider, model);

      return reply.code(200).send({
        provider: updated.provider,
        model: updated.model,
        updatedAt: updated.updatedAt.toISOString(),
      });
    }
  );
};
