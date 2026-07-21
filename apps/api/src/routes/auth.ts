import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { AuthService, AuthError } from "../auth/service.js";
import { requireAuth } from "../auth/plugin.js";
import type { RegisterRequest, LoginRequest } from "@kinora/contracts";

/**
 * Plugin options: the auth service instance to delegate auth operations to.
 */
export interface AuthRoutesOptions {
  authService: AuthService;
}

/**
 * JSON schema for RegisterRequest body validation.
 * Fastify uses ajv under the hood; missing required fields trigger
 * a validation error that the app error handler converts to 422.
 */
const registerSchema = {
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 8 },
    },
    additionalProperties: false,
  },
};

/**
 * JSON schema for LoginRequest body validation.
 */
const loginSchema = {
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string" },
    },
    additionalProperties: false,
  },
};

/**
 * Auth route plugin — registers POST /auth/register and POST /auth/login.
 *
 * Each route validates the body via JSON schema, delegates to AuthService,
 * and returns a SessionResponse. AuthErrors propagate to the app-level
 * error handler which maps them to 401.
 */
export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  fastify,
  options
) => {
  const { authService } = options;

  fastify.post(
    "/auth/register",
    { schema: registerSchema },
    async (request: FastifyRequest<{ Body: RegisterRequest }>) => {
      return authService.register(request.body);
    }
  );

  fastify.post(
    "/auth/login",
    { schema: loginSchema },
    async (request: FastifyRequest<{ Body: LoginRequest }>) => {
      return authService.login(request.body);
    }
  );

  /**
   * GET /auth/identity — resolves the caller's `(tenantId, userId)` from the
   * authenticated session (Phase 4 web offline, 09b-v1).
   *
   * The web app's Server Actions run server-side but have NO direct DB
   * access (they call this API over HTTP, like every other web→api path);
   * they cannot call `resolveAuthContextFromToken` themselves. This
   * endpoint is the minimal authenticated surface that lets
   * `getOfflineIdentityKeyAction` derive a STABLE, per-account identity key
   * from `(tenantId, userId)` instead of hashing the session token (which
   * rotates every login and would otherwise cause the offline module to
   * treat every re-login as a brand-new identity, silently purging the
   * user's own unsynced queue — see `identity.ts`).
   *
   * Never returns the raw `tenantId`/`userId` to be persisted client-side
   * as-is by the offline module — the caller hashes them into an opaque,
   * context-prefixed key before using them to namespace IndexedDB.
   */
  fastify.get(
    "/auth/identity",
    { preHandler: requireAuth() },
    async (request: FastifyRequest) => {
      const { tenantId, userId } = request.authContext!;
      return { tenantId, userId };
    }
  );

  /**
   * POST /auth/logout — invalidate the caller's session.
   *
   * Requires authentication. Reads the session token from the Authorization
   * header, resolves the session id (tokenHash), and deletes the session row.
   * The caller (web Server Action) is expected to also clear the httpOnly
   * cookie after the API call succeeds.
   */
  fastify.post(
    "/auth/logout",
    { preHandler: requireAuth() },
    async (request: FastifyRequest) => {
      const { sessionId } = request.authContext!;
      await authService.logout(sessionId);
      return { ok: true };
    }
  );

  /**
   * GET /auth/profile — returns minimal user profile for sidebar display.
   *
   * Requires authentication. Returns the user's email (from which the web
   * app derives initials) and the tenant name. Until the users table has a
   * dedicated `name` or `displayName` field, the email serves as both the
   * display name and the source for initials (first character of the local
   * part, uppercased). The plan badge defaults to "Free" until billing is
   * implemented.
   */
  fastify.get(
    "/auth/profile",
    { preHandler: requireAuth() },
    async (request: FastifyRequest) => {
      const { userId } = request.authContext!;
      const profile = await authService.getProfile(userId);
      if (!profile) {
        throw new AuthError("User not found");
      }
      return profile;
    }
  );
};

// Re-export AuthError so the app error handler can check the name
export { AuthError };