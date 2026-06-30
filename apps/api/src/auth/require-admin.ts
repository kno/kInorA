import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Minimal shape of a user record needed by requireAdmin.
 * Avoids coupling to a specific repository implementation.
 */
export interface AdminCheckUser {
  id: string;
  isAdmin: boolean;
}

/**
 * Minimal repository shape needed by requireAdmin.
 * Keeps the guard decoupled from the full UserRepository.
 */
export interface AdminCheckUserRepo {
  findById(id: string): Promise<AdminCheckUser | null>;
}

/**
 * Build a `requireAdmin` Fastify preHandler that gates routes to admin users only.
 *
 * Security contract:
 *  - 403 (not 401) when authContext is null — the client knows authentication
 *    is required at this level, but the specific signal is "access denied".
 *    NOTE: per spec SC-01 the unauthenticated case returns 401 via requireAuth()
 *    which always runs BEFORE requireAdmin. requireAdmin therefore never sees
 *    an authContext-null request in the normal flow. The 403 guard here is a
 *    defence-in-depth backstop.
 *  - Reads is_admin from DB by authContext.userId — NEVER trusts the request body.
 *  - 403 `{ error: "forbidden" }` for non-admin users and missing user rows.
 *
 * Usage:
 *   fastify.addHook("preHandler", requireAuth());
 *   fastify.addHook("preHandler", buildRequireAdmin(userRepo));
 */
export function buildRequireAdmin(userRepo: AdminCheckUserRepo) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.authContext) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    const user = await userRepo.findById(request.authContext.userId);

    if (!user?.isAdmin) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }
  };
}
