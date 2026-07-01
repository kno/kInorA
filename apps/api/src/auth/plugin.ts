import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import type { Database } from "../db/client.js";
import { SessionRepository } from "../db/repositories/session.js";
import { MembershipRepository } from "../db/repositories/auth-context.js";
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
 * Validation chain: format → hash → session lookup → expiry → (optional)
 * membership status re-check.
 *
 * Membership re-check (fail-secure): when `membershipRepo` is provided, the
 * caller's membership is re-read on every request and access is denied unless
 * `status === "active"`. This closes the window where a user suspended AFTER
 * their session was issued would otherwise keep access until token expiry.
 *
 * The re-check is TENANT-SCOPED: it looks up the membership by BOTH the
 * session's `tenantId` and `userId` (the `(tenantId, userId)` unique index), so
 * it validates the membership FOR THE TENANT THE SESSION IS SCOPED TO. A user
 * can belong to multiple tenants with different statuses; a by-user-only lookup
 * would nondeterministically read another tenant's `active` row and re-open the
 * exact suspension bypass this guard closes.
 *
 * The check is fail-secure: a missing membership, any non-active status
 * (invited/suspended), or a repository error (the rejected promise propagates
 * to the caller, which denies) all result in no access. It is OPTIONAL so
 * unauthenticated / public paths that only extract context can skip the query.
 *
 * @param token  Raw token string (already stripped of "Bearer " prefix)
 * @param deps   SessionRepository for lookup; optional MembershipRepository
 *               to re-check that the tenant-scoped membership is still active.
 * @returns      Resolved SessionContext on success, null on any failure
 */
export async function resolveAuthContextFromToken(
  token: string,
  deps: {
    sessionRepo: Pick<SessionRepository, "findByTokenHash">;
    membershipRepo?: Pick<MembershipRepository, "findByTenantAndUser">;
  }
): Promise<SessionContext | null> {
  if (!isValidTokenFormat(token)) return null;

  const tokenHash = computeTokenHash(token);
  const session = await deps.sessionRepo.findByTokenHash(tokenHash);
  if (!session || isSessionExpired(session.expiresAt)) return null;

  // Fail-secure tenant-scoped membership re-check: deny if the membership for
  // THIS session's tenant is gone or no longer active, regardless of how long
  // the session token is still valid or of the user's status in other tenants.
  if (deps.membershipRepo) {
    const membership = await deps.membershipRepo.findByTenantAndUser(
      session.tenantId,
      session.userId
    );
    if (!membership || membership.status !== "active") return null;
  }

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
  const membershipRepo = new MembershipRepository(options.db);
  // membershipRepo is passed so every Bearer request re-checks that the
  // membership is still active (fail-secure suspension enforcement).
  const deps = { sessionRepo, membershipRepo };

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
): FastifyReply {
  reply.authError = reason;
  // Return the reply so callers can `return sendUnauthorized(...)` and Fastify
  // treats the request as handled, guaranteeing the guard short-circuits.
  return reply.code(401).send({ error: "unauthorized" });
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
 *
 * The guard RETURNS the sent reply so no statement after the unauthorized
 * send can ever run on an already-sent reply. This removes the footgun where
 * future code appended to this preHandler would execute post-send.
 */
export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authContext) {
      return sendUnauthorized(reply, "missing_session");
    }
  };
}