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

/**
 * Shared token-string → SessionContext|null resolution logic.
 *
 * Used by BOTH the HTTP Bearer-header path (authPlugin onRequest hook) AND
 * the WebSocket query-param path (wsRoutes preValidation hook) so the validation
 * chain is IDENTICAL: format check → hash → session lookup → expiry check →
 * tenant+user resolution.
 *
 * This is the ONLY place that performs session validation. Do NOT duplicate
 * this logic — always call this function.
 *
 * @param token  Raw token string (already stripped of "Bearer " prefix)
 * @param deps   Dependencies: SessionRepository for DB lookup
 * @returns      Resolved SessionContext on success, null on any failure
 */
export async function resolveAuthContextFromToken(
  token: string,
  deps: { sessionRepo: Pick<SessionRepository, "findByTokenHash"> }
): Promise<SessionContext | null> {
  if (!isValidTokenFormat(token)) return null;

  const tokenHash = computeTokenHash(token);
  const session = await deps.sessionRepo.findByTokenHash(tokenHash);
  if (!session || isSessionExpired(session.expiresAt)) return null;

  return {
    userId: session.userId as UserId,
    tenantId: session.tenantId as TenantId,
    sessionId: session.tokenHash as SessionId,
  };
}

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
  const deps = { sessionRepo };

  fastify.decorateRequest("authContext", null);
  fastify.decorateReply("authError", null);

  // Session extraction — runs on every request, never blocks.
  // Reads the Bearer token from the Authorization header only.
  // WebSocket connections that cannot set headers use the query-param path
  // in wsRoutes (same resolveAuthContextFromToken — identical validation chain).
  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      request.authContext = null;
      return;
    }

    const token = authHeader.slice(7);
    request.authContext = await resolveAuthContextFromToken(token, deps);
  });

  // Expose reply.authError as a response header for observability.
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
 * Send a 401 response and tag reply.authError for observability.
 *
 * This is the single place that translates auth failures into HTTP 401.
 * The onSend hook in the plugin reads reply.authError to set the
 * `x-auth-error` response header.
 */
function sendUnauthorized(
  reply: FastifyReply,
  reason: string
): void {
  reply.authError = reason;
  reply.code(401).send({ error: "unauthorized" });
}

/**
 * requireAuth preHandler — checks that request.authContext is present.
 *
 * Uses `sendUnauthorized` so there is exactly one place that emits 401
 * responses. The onSend hook in the plugin reads `reply.authError` to
 * expose it as the `x-auth-error` header for observability.
 *
 * This is NOT a throw — it uses reply.send() so Fastify short-circuits
 * the request lifecycle cleanly and the onSend hook still fires.
 */
export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authContext) {
      sendUnauthorized(reply, "missing_session");
    }
  };
}