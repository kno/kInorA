import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import type { Database } from "../db/client.js";
import { SessionRepository } from "../db/repositories/session.js";
import { computeTokenHash } from "./session.js";
import { isValidTokenFormat, isSessionExpired } from "@kinora/domain";
import type { SessionContext, UserId, TenantId, SessionId } from "@kinora/contracts";

export interface AuthPluginOptions {
  db: Database;
}

// Fastify request/reply type augmentations for auth context.
// These are global once this file is part of the compilation.
declare module "fastify" {
  interface FastifyRequest {
    authContext: SessionContext | null;
  }
  interface FastifyReply {
    authError: string | null;
  }
}

const rawPlugin: FastifyPluginAsync<AuthPluginOptions> = async (
  fastify: FastifyInstance,
  options: AuthPluginOptions
) => {
  const sessionRepo = new SessionRepository(options.db);

  fastify.decorateRequest("authContext", null);
  fastify.decorateReply("authError", null);

  // Session extraction — runs on every request, never blocks.
  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      request.authContext = null;
      return;
    }

    const token = authHeader.slice(7);
    if (!isValidTokenFormat(token)) {
      request.authContext = null;
      return;
    }

    const tokenHash = computeTokenHash(token);
    const session = await sessionRepo.findByTokenHash(tokenHash);
    if (!session || isSessionExpired(session.expiresAt)) {
      request.authContext = null;
      return;
    }

    request.authContext = {
      userId: session.userId as UserId,
      tenantId: session.tenantId as TenantId,
      sessionId: session.tokenHash as SessionId,
    };
  });

  // Global 401 enforcement — defense-in-depth safety net.
  //
  // If ANY hook running before this one (onRequest, preValidation, or an
  // earlier preHandler) sets reply.authError, this preHandler converts it
  // into a 401 response before the route handler runs.
  //
  // Note: requireAuth (added AFTER the plugin) sets reply.authError in its
  // own preHandler and sends the 401 directly — this hook cannot catch that
  // because Fastify runs instance-level hooks registered during plugin init
  // before hooks added later. This hook covers the remaining lifecycle phases.
  fastify.addHook("preHandler", async (_request: FastifyRequest, reply: FastifyReply) => {
    if (reply.authError && !reply.sent) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  // Expose reply.authError as a response header for observability.
  // Runs after the 401 is sent so the header is present on error responses.
  fastify.addHook("onSend", async (_request: FastifyRequest, reply: FastifyReply) => {
    if (reply.authError) {
      reply.header("x-auth-error", reply.authError);
    }
  });
};

// Skip Fastify's encapsulation so decorators and hooks are available
// to all routes registered on the parent instance (not just child scope).
// This is the documented equivalent of fastify-plugin wrapping without
// adding a runtime dependency.
Object.assign(rawPlugin, { [Symbol.for("skip-override")]: true });

export const authPlugin = rawPlugin;

/**
 * requireAuth preHandler — checks that request.authContext is present.
 *
 * Sets `reply.authError = 'missing_session'` for observability (the onSend
 * hook exposes it as the `x-auth-error` header) AND sends a 401 response
 * with `{ error: "unauthorized" }` so the route handler never runs.
 *
 * This is NOT a throw — it uses reply.send() so Fastify short-circuits the
 * request lifecycle cleanly and the onSend hook still fires for the header.
 *
 * The global preHandler in the plugin covers errors set in earlier lifecycle
 * phases (onRequest/preValidation); requireAuth covers the per-route opt-in
 * case since it runs after the plugin's instance-level hooks.
 */
export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authContext) {
      reply.authError = "missing_session";
      reply.code(401).send({ error: "unauthorized" });
    }
  };
}