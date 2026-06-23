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

  // Register routes on a child instance so the scoped error handler only covers
  // social routes, not the parent app. Errors that do not match the social-auth
  // patterns fall through to the app-level handler.
  await fastify.register(async (scoped) => {
    scoped.setErrorHandler((error: unknown, _request, reply) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "validation" in error &&
        Boolean((error as { validation: unknown }).validation)
      ) {
        return reply.code(422).send({ error: "Validation Error" });
      }
      if (error instanceof SocialAuthError || error instanceof UnknownProviderError) {
        fastify.log.error(error, "Social auth error");
        return reply.code(400).send({ error: error.message });
      }
      // Let unknown errors propagate to the parent (app-level) error handler.
      throw error;
    });

    scoped.get(
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

    scoped.post(
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
  });
};