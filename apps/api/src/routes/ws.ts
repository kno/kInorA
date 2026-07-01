/**
 * Authenticated WebSocket plan-status route.
 *
 * Route: GET /ws/plans
 *
 * Auth: two paths using the SAME validation chain (resolveAuthContextFromToken):
 *   1. Authorization: Bearer <token> header — set by authPlugin.onRequest hook.
 *      Works for non-browser clients (server-to-server, test harness).
 *   2. ?token=<token> query param — for browser WebSocket clients.
 *      Browsers' `new WebSocket(url)` cannot send custom headers, so the token
 *      is passed as a query param (the industry-standard pattern: Pusher/Ably/
 *      ActionCable). The route preValidation hook reads it and calls the shared
 *      resolveAuthContextFromToken — IDENTICAL validation chain as the Bearer path.
 *      Security note: token is short-lived and sent over TLS; this is WS-only.
 *
 * The preValidation is attached at route level (not plugin scope) so future
 * routes added to this plugin do NOT inherit the auth gate implicitly.
 *
 * WS payload: ONLY { planId, status } — NO program content, NO health data.
 *
 * Registry: the socket is registered under authContext.userId on open and
 * unregistered on close (clean resource management).
 *
 * Single-node: WsRegistry is in-memory (v1). See design.md for the trade-off.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { WsRegistry } from "../ws/registry.js";
import type { WebSocket } from "@fastify/websocket";
import { resolveAuthContextFromToken } from "../auth/plugin.js";
import { SessionRepository } from "../db/repositories/session.js";
import { MembershipRepository } from "../db/repositories/auth-context.js";
import type { Database } from "../db/client.js";

export interface WsRoutesOptions {
  registry: WsRegistry;
  /** DB instance for query-param token resolution. Injected from app.ts. */
  db: Database;
}

/**
 * Route-level preValidation hook — auth gate for GET /ws/plans only.
 *
 * Checks authContext (set by authPlugin from Bearer header). If null, falls
 * back to the ?token= query param and runs the shared validator. Rejects with
 * 401 if neither path succeeds. Attached at route level so only /ws/plans is
 * gated — not every future route in this plugin.
 */
async function wsAuthPreValidation(
  request: FastifyRequest<{ Querystring: { token?: string } }>,
  reply: FastifyReply,
  sessionRepo: Pick<SessionRepository, "findByTokenHash">,
  membershipRepo: Pick<MembershipRepository, "findByTenantAndUser">
): Promise<void> {
  // Path 1: Bearer header (set by authPlugin.onRequest hook, which already
  // performed the membership re-check).
  if (request.authContext) return;

  // Path 2: ?token= query param (browser WebSocket path).
  // Uses the SAME resolveAuthContextFromToken as the Bearer path, including the
  // fail-secure membership re-check, so a suspended user cannot connect here.
  const queryToken = request.query.token;
  if (queryToken) {
    const ctx = await resolveAuthContextFromToken(queryToken, {
      sessionRepo,
      membershipRepo,
    });
    if (ctx) {
      request.authContext = ctx;
      return;
    }
  }

  // Neither path succeeded → reject before the WS upgrade handshake.
  return reply.code(401).send({ error: "unauthorized" });
}

/**
 * WebSocket route plugin.
 *
 * Must be registered AFTER @fastify/websocket is registered on the same
 * Fastify instance.
 */
export const wsRoutes: FastifyPluginAsync<WsRoutesOptions> = async (
  fastify,
  options
) => {
  const { registry, db } = options;
  const sessionRepo = new SessionRepository(db);
  const membershipRepo = new MembershipRepository(db);

  fastify.get<{ Querystring: { token?: string } }>(
    "/ws/plans",
    {
      websocket: true,
      // Route-level preValidation — auth gate applies ONLY to /ws/plans.
      // Future routes added to this plugin are NOT implicitly auth-gated.
      preValidation: [
        async (request, reply) =>
          wsAuthPreValidation(
            request as FastifyRequest<{ Querystring: { token?: string } }>,
            reply,
            sessionRepo,
            membershipRepo
          ),
      ],
    },
    (socket: WebSocket, request) => {
      // authContext is guaranteed non-null here (preValidation rejected otherwise).
      const { userId } = request.authContext!;

      // Register socket so generation service can notify this user.
      registry.register(userId, socket);

      // Unregister on connection close to avoid memory leaks.
      socket.on("close", () => {
        registry.unregister(userId, socket);
      });
    }
  );
};
