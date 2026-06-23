import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type {
  OidcCallbackParams,
  SessionResponse,
  SocialLoginResponse,
} from "@kinora/contracts";
import {
  SocialAuthService,
  SocialAuthError,
} from "../auth/social.js";
import { UnknownProviderError } from "../auth/providers.js";

/**
 * Plugin options: the social auth service instance to delegate login + callback to.
 */
export interface SocialRoutesOptions {
  socialAuthService: SocialAuthService;
}

const loginSchema = {
  querystring: {
    type: "object",
    required: ["provider"],
    properties: {
      provider: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
};

const callbackSchema = {
  body: {
    type: "object",
    required: ["code", "state"],
    properties: {
      code: { type: "string", minLength: 1 },
      state: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
};

/**
 * Social login route plugin — registers the two OIDC endpoints:
 *
 * - `GET /auth/social/login?provider=<id>` — initiates an OIDC flow, returning
 *   the provider authorization URL (with PKCE + state).
 * - `POST /auth/social/callback` — exchanges a `code` + `state` for tokens,
 *   resolves/links/provisions the account, and issues a session.
 *
 * `SocialAuthError` (unknown provider, unverified email, unknown state,
 * provider mismatch) and `UnknownProviderError` map to HTTP 400. Missing or
 * invalid fields map to 422 via Fastify validation.
 */
export const socialRoutes: FastifyPluginAsync<SocialRoutesOptions> = async (
  fastify,
  options
) => {
  const { socialAuthService } = options;

  // Scoped error handler: validation failures (missing/invalid fields) → 422,
  // social auth errors → 400, anything else → 500. Self-scope keeps the routes
  // plugin testable without an app-level error handler dependency.
  fastify.setErrorHandler((error: unknown, _request, reply) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Boolean((error as { validation: unknown }).validation)
    ) {
      return reply.code(422).send({ error: "Validation Error" });
    }
    if (error instanceof SocialAuthError || error instanceof UnknownProviderError) {
      return reply.code(400).send({ error: error.message });
    }
    fastify.log.error(error as Error);
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  fastify.get(
    "/auth/social/login",
    { schema: loginSchema },
    async (
      request: FastifyRequest<{ Querystring: { provider: string } }>,
    ) => {
      const result: SocialLoginResponse = await socialAuthService.login(
        request.query.provider
      );
      return result;
    }
  );

  fastify.post(
    "/auth/social/callback",
    { schema: callbackSchema },
    async (
      request: FastifyRequest<{ Body: OidcCallbackParams }>,
    ) => {
      const result: SessionResponse = await socialAuthService.callback(
        request.body
      );
      return result;
    }
  );
};