/**
 * Authenticated WebSocket plan-status route.
 *
 * Route: GET /ws/plans
 *
 * Auth: reuses the session mechanism from authPlugin.
 * The authPlugin adds an onRequest hook that sets request.authContext from
 * the Authorization: Bearer <token> header. If authContext is null (missing or
 * invalid token), this handler rejects the upgrade with 401 Unauthorized.
 *
 * WS payload: ONLY { planId, status } — NO program content, NO health data.
 *
 * Registry: the socket is registered under authContext.userId on open and
 * unregistered on close (clean resource management).
 *
 * Single-node: WsRegistry is in-memory (v1). See design.md for the trade-off.
 */

import type {
  FastifyPluginAsync,
} from "fastify";
import type { WsRegistry } from "../ws/registry.js";
import type { WebSocket } from "@fastify/websocket";

export interface WsRoutesOptions {
  registry: WsRegistry;
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
  const { registry } = options;

  // Auth gate: authPlugin sets request.authContext via onRequest hook from
  // the Authorization: Bearer <token> header. The preValidation hook runs
  // BEFORE the WebSocket upgrade handshake completes, so returning a 401
  // here causes @fastify/websocket to reject injectWS() in tests and
  // prevents the browser from receiving a 101 Switching Protocols response.
  fastify.addHook("preValidation", async (request, reply) => {
    if (!request.authContext) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  fastify.get(
    "/ws/plans",
    { websocket: true },
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
