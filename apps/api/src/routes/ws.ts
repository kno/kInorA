/**
 * Authenticated WebSocket plan-status route.
 *
 * Route: GET /ws/plans
 *
 * Auth: three paths using the SAME validation chain (resolveAuthContextFromToken),
 * every one of which performs the tenant-scoped membership re-check (#23):
 *   1. Authorization: Bearer <token> header — set by authPlugin.onRequest hook
 *      (which already ran the membership re-check). Works for non-browser
 *      clients (server-to-server, test harness).
 *   2. kinora_session cookie — the PREFERRED browser path (issue #42). On a
 *      same-origin WS upgrade the browser auto-sends the httpOnly, sameSite=lax
 *      session cookie, so the token never has to be exposed to client JS (which
 *      would weaken httpOnly) or placed in the WS URL (devtools/proxy/LB logs).
 *      Requires @fastify/cookie to be registered so request.cookies is parsed.
 *      Checked BEFORE the ?token= fallback. Runs the SAME resolver with the
 *      membershipRepo so a suspended/missing-membership user is rejected here too.
 *   3. ?token=<token> query param — RETAINED fallback for non-browser clients
 *      and cross-origin local dev (web:3000 / api:4000), where the cookie is
 *      NOT sent on the WS upgrade. Browsers' `new WebSocket(url)` cannot send
 *      custom headers, so the token is passed as a query param (the industry-
 *      standard pattern: Pusher/Ably/ActionCable). The route preValidation hook
 *      reads it and calls the shared resolveAuthContextFromToken — IDENTICAL
 *      validation chain (incl. membership re-check) as the Bearer path.
 *      Security note: token is short-lived and sent over TLS; this is WS-only.
 *
 * CSWSH defense (issue #42 hardening review): the cookie path authenticates
 * from the ambient session cookie, which is NOT protected by CORS on a WS
 * upgrade and is only weakly protected by SameSite=lax. So BEFORE authenticating,
 * any request that carries an `Origin` header (i.e. a browser) MUST have that
 * Origin in the allowlist, else it is rejected 403. Non-browser clients
 * (Bearer / ?token= from server-to-server or CLIs) send NO Origin and are not
 * gated — they authenticate with a token the attacker cannot forge/read.
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

/**
 * Session row shape the auth resolver reads. Declared inline (structural) so the
 * route layer never imports the DB layer directly; app.ts injects a concrete
 * SessionRepository-backed adapter whose result is structurally compatible.
 */
export interface WsSessionRecord {
  tokenHash: string;
  userId: string;
  tenantId: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Membership row shape used by the tenant-scoped fail-secure re-check.
 */
export interface WsMembershipRecord {
  id: string;
  tenantId: string;
  userId: string;
  role: "owner" | "member";
  status: "invited" | "active" | "suspended";
  createdAt: Date;
}

/**
 * Route port for the WS auth flow. Encapsulates the two lookups the cookie/
 * ?token= paths need — the session by token hash and the tenant-scoped
 * membership — so the route never touches the DB layer. Structurally
 * compatible with the resolveAuthContextFromToken dependency shape.
 */
export interface WsRouteRepo {
  findByTokenHash(tokenHash: string): Promise<WsSessionRecord | null>;
  findByTenantAndUser(
    tenantId: string,
    userId: string
  ): Promise<WsMembershipRecord | null>;
}

/**
 * Session cookie name — MUST match the web app's SESSION_COOKIE
 * (apps/web/src/auth/session-cookie.ts). The web app stores the opaque bearer
 * token verbatim (unsigned) in this httpOnly, sameSite=lax cookie, so the value
 * read from request.cookies can be passed straight to resolveAuthContextFromToken.
 */
const SESSION_COOKIE = "kinora_session";

export interface WsRoutesOptions {
  registry: WsRegistry;
  /**
   * Route port backing cookie/?token= auth resolution. Injected from app.ts
   * (constructed from SessionRepository + MembershipRepository). The route never
   * touches the DB layer directly.
   */
  repo: WsRouteRepo;
  /**
   * Origin allowlist for the CSWSH gate. A browser WS upgrade (one carrying an
   * `Origin` header) is accepted ONLY when its Origin is in this list. Sourced
   * in app.ts from WEB_PUBLIC_ORIGIN (the same origin used for social redirect
   * URIs / OpenRouter HTTP-Referer). Empty/omitted → NO browser Origin is
   * allowed (fail-closed): the cookie path is effectively disabled, so browsers
   * fall back to polling and non-browser (no-Origin) clients are unaffected.
   */
  allowedOrigins?: readonly string[];
}

/**
 * Normalize an origin for comparison: trim, lowercase, drop any trailing slash.
 * Origins are compared as exact strings after normalization (no substring/regex
 * matching, which would be forgeable, e.g. https://app.kinora.io.evil.com).
 */
function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * CSWSH gate. Returns true when the request is allowed to proceed to auth.
 *
 * - No Origin header → non-browser client (Bearer/?token=): allowed (not gated).
 * - Origin present → must exactly match a normalized allowlist entry, else denied.
 */
function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (origin === undefined) return true; // non-browser client — not gated
  const normalized = normalizeOrigin(origin);
  return allowedOrigins.some((allowed) => normalizeOrigin(allowed) === normalized);
}

/**
 * Route-level preValidation hook — CSWSH gate + auth gate for GET /ws/plans only.
 *
 * FIRST enforces the Origin allowlist (CSWSH defense): a request carrying an
 * Origin header (browser) whose Origin is not allowlisted is rejected 403 BEFORE
 * any authentication runs — so a cross-site page cannot ride the ambient cookie.
 *
 * Then checks authContext (set by authPlugin from Bearer header). If null, tries
 * the kinora_session cookie (preferred same-origin browser path), then falls back
 * to the ?token= query param, running the shared validator each time. Every path
 * runs the SAME resolver with the tenant-scoped membershipRepo, so a suspended /
 * missing-membership user is rejected on Bearer, cookie, AND ?token= (#23).
 * Rejects with 401 if no path succeeds. Attached at route level so only /ws/plans
 * is gated — not every future route in this plugin.
 */
async function wsAuthPreValidation(
  request: FastifyRequest<{ Querystring: { token?: string } }>,
  reply: FastifyReply,
  repo: WsRouteRepo,
  allowedOrigins: readonly string[]
): Promise<void> {
  // CSWSH gate — runs BEFORE auth so a cross-site Origin never reaches the
  // cookie/token validation. Only requests with an Origin header are gated;
  // non-browser clients (no Origin) proceed to token/Bearer auth as before.
  const origin = request.headers.origin;
  if (!isOriginAllowed(origin, allowedOrigins)) {
    return reply.code(403).send({ error: "forbidden_origin" });
  }

  // Path 1: Bearer header (set by authPlugin.onRequest hook, which already
  // performed the membership re-check).
  if (request.authContext) return;

  // Path 2: kinora_session cookie — preferred same-origin browser path (#42).
  // The browser auto-sends the httpOnly cookie on the WS upgrade, so the token
  // is never exposed to client JS or the WS URL. Runs the SAME resolver as the
  // Bearer path, INCLUDING the tenant-scoped membership re-check (#23), so a
  // suspended/missing-membership user cannot connect via the cookie either.
  // request.cookies is populated by @fastify/cookie; guard in case it is absent.
  const cookieToken = request.cookies?.[SESSION_COOKIE];
  if (cookieToken) {
    const ctx = await resolveAuthContextFromToken(cookieToken, {
      sessionRepo: repo,
      membershipRepo: repo,
    });
    if (ctx) {
      request.authContext = ctx;
      return;
    }
  }

  // Path 3: ?token= query param — retained fallback for non-browser clients and
  // cross-origin local dev where the cookie is not sent on the WS upgrade.
  // Uses the SAME resolveAuthContextFromToken as the Bearer path, including the
  // fail-secure membership re-check, so a suspended user cannot connect here.
  const queryToken = request.query.token;
  if (queryToken) {
    const ctx = await resolveAuthContextFromToken(queryToken, {
      sessionRepo: repo,
      membershipRepo: repo,
    });
    if (ctx) {
      request.authContext = ctx;
      return;
    }
  }

  // No path succeeded → reject before the WS upgrade handshake.
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
  const { registry, repo } = options;
  // Normalize once at registration. Empty list → fail-closed for browsers
  // (any Origin header is rejected); non-browser no-Origin clients still work.
  const allowedOrigins = options.allowedOrigins ?? [];

  fastify.get<{ Querystring: { token?: string } }>(
    "/ws/plans",
    {
      websocket: true,
      // Route-level preValidation — CSWSH + auth gate applies ONLY to /ws/plans.
      // Future routes added to this plugin are NOT implicitly gated.
      preValidation: [
        async (request, reply) =>
          wsAuthPreValidation(
            request as FastifyRequest<{ Querystring: { token?: string } }>,
            reply,
            repo,
            allowedOrigins
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
